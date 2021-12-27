import * as fs from "fs";
import * as path from "path";
import { EventEmitter } from "events";
import axios from "axios";
import YouTubeService from "./services/api/youtube";
import parseMpd from "./mpd_parser";
import download from "../utils/download_files";
import { VideoMuxer, VideoSequence, AudioSequence, VideoTrack, AudioTrack } from "../utils/video_muxer";
import mergeFiles from "../utils/merge_files";
import deleteDirectory from "../utils/delete_directory";
import selectFormat from "../utils/select_format";
import escapeFilename from "../utils/escape_filename";
import { isFFmpegAvailable, isFFprobeAvailable } from "../utils/system";
import analyseConcatMethod, { ConcatMethod } from "../utils/analyse_concat_method";
import logger, { ConsoleLogger } from "./services/logger";

export class DownloadError extends Error {}

export interface DownloaderOptions {
    videoUrl: string;
    format?: string;
    verbose?: boolean;
    keep?: boolean;
    threads?: number;
    concatMethod?: ConcatMethod;
    headers?: string;
}

class Downloader extends EventEmitter {
    videoUrl: string;
    format: string;
    keepTemporaryFiles: boolean;

    videoChunkUrls: string[];
    audioChunkUrls: string[];
    downloadedVideoChunkFiles: string[];
    downloadedAudioChunkFiles: string[];
    workDirectoryName: string;
    outputFilename: string;
    verbose: boolean = false;
    logger: ConsoleLogger;
    maxThreads = 10;
    rawHeaders: string;
    enableCustomHeaders = false;
    concatMethod: ConcatMethod;
    sqStart: number;
    sqEnd: number;

    isLowLatencyLiveStream: boolean;
    isPremiumVideo: boolean;
    isFFmpegAvailable: boolean;
    isFFprobeAvailable: boolean;

    constructor(videoUrl, { format, verbose, keep, threads, concatMethod, headers }: Partial<DownloaderOptions>) {
        super();
        this.videoUrl = videoUrl;
        if (format) {
            this.format = format;
        }
        this.logger = logger;
        if (verbose) {
            this.logger.enableDebug();
        }
        if (keep) {
            this.keepTemporaryFiles = true;
        }
        if (threads) {
            this.maxThreads = threads;
        }
        if (concatMethod) {
            this.concatMethod = +concatMethod;
        }
        if (headers) {
            this.enableCustomHeaders = true;
            this.rawHeaders = headers;
        }
    }

    async download() {
        this.logger.debug(`使用至多 ${this.maxThreads} 线程下载`);
        this.isFFmpegAvailable = await isFFmpegAvailable();
        this.isFFprobeAvailable = await isFFprobeAvailable();
        if (!this.isFFmpegAvailable) {
            this.logger.warning("FFmpeg不可用 视频不会自动合并");
        }
        if (!this.isFFprobeAvailable) {
            this.logger.warning("FFprobe不可用 无法准确确定合并方式 临时文件将会被保留");
            this.keepTemporaryFiles = true;
        }
        // 解析视频信息
        this.logger.info("正在获取视频信息");
        const { title, mpdUrl, isLowLatencyLiveStream, isPremiumVideo } = await YouTubeService.getVideoInfo(
            this.videoUrl
        );
        if (!mpdUrl) {
            throw new DownloadError("无法获得可用的直播地址 这可能不是一个直播视频");
        }
        this.logger.debug(`MPD URL: ${mpdUrl}`);
        this.isLowLatencyLiveStream = isLowLatencyLiveStream;
        this.isPremiumVideo = isPremiumVideo;
        this.outputFilename = escapeFilename(`${title}.mp4`);
        this.logger.info("正在获取播放列表");
        const mpdStr = (await axios.get(mpdUrl)).data;
        const parseResult = parseMpd(mpdStr);
        // 创建工作目录
        this.workDirectoryName = `kkr_download_${Date.now()}`;
        fs.mkdirSync(this.workDirectoryName);
        fs.mkdirSync(path.resolve(this.workDirectoryName, "./video_download"));
        fs.mkdirSync(path.resolve(this.workDirectoryName, "./audio_download"));
        const { selectedVideoTrack, selectedAudioTrack } = selectFormat(this.format, parseResult);
        this.videoChunkUrls = selectedVideoTrack.urls;
        this.audioChunkUrls = selectedAudioTrack.urls;
        await download(this.videoChunkUrls, path.resolve(this.workDirectoryName, "./video_download"), this.maxThreads, {
            verbose: this.verbose,
            ...(this.enableCustomHeaders ? { headers: this.rawHeaders } : {}),
        });
        await download(this.audioChunkUrls, path.resolve(this.workDirectoryName, "./audio_download"), this.maxThreads, {
            verbose: this.verbose,
            ...(this.enableCustomHeaders ? { headers: this.rawHeaders } : {}),
        });
        this.downloadedVideoChunkFiles = fs.readdirSync(path.resolve(this.workDirectoryName, "./video_download"));
        this.downloadedAudioChunkFiles = fs.readdirSync(path.resolve(this.workDirectoryName, "./audio_download"));

        if (!this.isFFmpegAvailable) {
            this.logger.error("FFmpeg不可用 请手动合并文件");
            this.logger.error(`临时文件目录位于 ${path.resolve(this.workDirectoryName)}`);
            process.exit();
        }
        this.logger.info(`准备混流输出文件`);
        let useDirectConcat = true;
        let concatMethodGuessing = false;

        if (this.concatMethod) {
            this.logger.info(`手动指定了合并模式${this.concatMethod}`);
            useDirectConcat = this.concatMethod === ConcatMethod.DIRECT_CONCAT;
            concatMethodGuessing = false;
        } else {
            if (!this.isFFprobeAvailable) {
                this.logger.warning(
                    "FFprobe不可用 无法从视频信息分析合并模式 将进行自动分析 自动分析结果可能错误 临时文件将不会被删除"
                );
                concatMethodGuessing = true;
            } else {
                if (this.downloadedVideoChunkFiles.length === 1) {
                    // pass
                } else {
                    const result = await analyseConcatMethod(
                        path.resolve(this.workDirectoryName, "./video_download", this.downloadedVideoChunkFiles[0]),
                        path.resolve(this.workDirectoryName, "./video_download", this.downloadedVideoChunkFiles[1])
                    );
                    if (result === ConcatMethod.FFMPEG_CONCAT) {
                        useDirectConcat = false;
                    }
                    if (result === ConcatMethod.UNKNOWN) {
                        this.logger.warning(`FFprobe分析视频内容失败 自动分析结果可能错误 临时文件将不会被删除`);
                        concatMethodGuessing = true;
                    }
                }
            }
        }

        if (concatMethodGuessing) {
            this.keepTemporaryFiles = true;
            this.logger.info(`kkr决定猜一下合并方法`);
            // 自动猜测合并方式
            if (this.isPremiumVideo) {
                this.logger.info(`由于本视频为首播视频 kkr觉得应该使用合并模式${ConcatMethod.FFMPEG_CONCAT}`);
                useDirectConcat = false;
            } else {
                if (!this.isLowLatencyLiveStream) {
                    this.logger.info(`由于本视频为非低延迟视频 kkr觉得应该使用合并模式${ConcatMethod.FFMPEG_CONCAT}`);
                    useDirectConcat = false;
                } else {
                    this.logger.info(`kkr觉得这个视频可以使用合并模式${ConcatMethod.DIRECT_CONCAT}`);
                }
            }
        }

        const videoMuxer = new VideoMuxer(this.outputFilename);
        if (useDirectConcat) {
            this.logger.info(`合并视频文件`);
            await mergeFiles(
                this.downloadedVideoChunkFiles.map((f) => path.resolve(this.workDirectoryName, "./video_download", f)),
                path.resolve(this.workDirectoryName, "./video_download/video.mp4")
            );
            this.logger.info(`合并音频文件`);
            await mergeFiles(
                this.downloadedAudioChunkFiles.map((f) => path.resolve(this.workDirectoryName, "./audio_download", f)),
                path.resolve(this.workDirectoryName, "./audio_download/audio.mp4")
            );
            videoMuxer.addVideoTracks(
                new VideoTrack({
                    path: path.resolve(this.workDirectoryName, "./video_download/video.mp4"),
                })
            );
            videoMuxer.addAudioTracks(
                new AudioTrack({
                    path: path.resolve(this.workDirectoryName, "./audio_download/audio.mp4"),
                })
            );
        } else {
            fs.writeFileSync(
                path.resolve(this.workDirectoryName, "video_files.txt"),
                this.downloadedVideoChunkFiles
                    .map((f) => `file '${path.resolve(this.workDirectoryName, "./video_download", f)}'`)
                    .join("\n")
            );
            fs.writeFileSync(
                path.resolve(this.workDirectoryName, "audio_files.txt"),
                this.downloadedVideoChunkFiles
                    .map((f) => `file '${path.resolve(this.workDirectoryName, "./audio_download", f)}'`)
                    .join("\n")
            );
            videoMuxer.addVideoSequences(
                new VideoSequence({
                    path: path.resolve(this.workDirectoryName, "video_files.txt"),
                })
            );
            videoMuxer.addAudioSequences(
                new AudioSequence({
                    path: path.resolve(this.workDirectoryName, "audio_files.txt"),
                })
            );
        }
        videoMuxer.on("success", async () => {
            if (!this.keepTemporaryFiles) {
                this.logger.info(`混流完成 正删除临时文件`);
                await deleteDirectory(this.workDirectoryName);
            }
            this.logger.info(`输出文件位于${this.outputFilename}`);
            process.exit();
        });
        videoMuxer.run();
    }
}

export default Downloader;
