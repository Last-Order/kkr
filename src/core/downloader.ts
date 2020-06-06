import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import YouTubeService from "./services/api/youtube";
import axios from "axios";
import parseMpd from "./mpd_parser";
import download from "../utils/download_files";
import {
    VideoMuxer,
    VideoSequence,
    AudioSequence,
    VideoTrack,
    AudioTrack,
} from "../utils/video_muxer";
import mergeFiles from "../utils/merge_files";
import deleteDirectory from "../utils/delete_directory";
import selectFormat from "../utils/select_format";
import escapeFilename from "../utils/escape_filename";
import logger, { ConsoleLogger } from "./services/logger";
import { isFFmpegAvailable } from "../utils/system";

export class DownloadError extends Error {}

export interface DownloaderOptions {
    videoUrl: string;
    format?: string;
    verbose?: boolean;
    keep?: boolean;
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
    logger: ConsoleLogger;

    isLowLatencyLiveStream: boolean;
    isPremiumVideo: boolean;
    isFFmpegAvailable: boolean;

    constructor({
        videoUrl,
        format,
        verbose,
        keep,
    }: Partial<DownloaderOptions>) {
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
    }

    async download() {
        this.isFFmpegAvailable = await isFFmpegAvailable();
        if (!this.isFFmpegAvailable) {
            this.logger.warning("FFmpeg不可用 视频不会自动合并");
        }
        // 解析视频信息
        this.logger.info("正在获取视频信息");
        const {
            title,
            mpdUrl,
            isLowLatencyLiveStream,
            isPremiumVideo,
        } = await YouTubeService.getVideoInfo(this.videoUrl);
        this.isLowLatencyLiveStream = isLowLatencyLiveStream;
        this.isPremiumVideo = isPremiumVideo;
        this.outputFilename = escapeFilename(`${title}.mp4`);
        this.logger.info("正在获取播放列表");
        const mpdStr = (await axios.get(mpdUrl)).data;
        const parseResult = parseMpd(mpdStr);
        // 创建工作目录
        this.workDirectoryName = `kkr_download_${new Date().valueOf()}`;
        fs.mkdirSync(this.workDirectoryName);
        fs.mkdirSync(path.resolve(this.workDirectoryName, "./video_download"));
        fs.mkdirSync(path.resolve(this.workDirectoryName, "./audio_download"));
        const { selectedVideoTrack, selectedAudioTrack } = selectFormat(
            this.format,
            parseResult
        );
        this.videoChunkUrls = selectedVideoTrack.urls;
        this.audioChunkUrls = selectedAudioTrack.urls;
        await download(
            this.videoChunkUrls,
            path.resolve(this.workDirectoryName, "./video_download")
        );
        await download(
            this.audioChunkUrls,
            path.resolve(this.workDirectoryName, "./audio_download")
        );
        this.downloadedVideoChunkFiles = fs.readdirSync(
            path.resolve(this.workDirectoryName, "./video_download")
        );
        this.downloadedAudioChunkFiles = fs.readdirSync(
            path.resolve(this.workDirectoryName, "./audio_download")
        );
        if (!this.isFFmpegAvailable) {
            this.logger.error("FFmpeg不可用 请手动合并文件");
            this.logger.error(
                `临时文件目录位于 ${path.resolve(this.workDirectoryName)}`
            );
            process.exit();
        }
        this.logger.info(`准备混流输出文件`);
        const videoMuxer = new VideoMuxer(this.outputFilename);
        if (!this.isPremiumVideo) {
            this.logger.info(`合并视频文件`);
            await mergeFiles(
                this.downloadedVideoChunkFiles.map((f) =>
                    path.resolve(this.workDirectoryName, "./video_download", f)
                ),
                path.resolve(
                    this.workDirectoryName,
                    "./video_download/video.mp4"
                )
            );
            this.logger.info(`合并音频文件`);
            await mergeFiles(
                this.downloadedAudioChunkFiles.map((f) =>
                    path.resolve(this.workDirectoryName, "./audio_download", f)
                ),
                path.resolve(
                    this.workDirectoryName,
                    "./audio_download/audio.mp4"
                )
            );
            videoMuxer.addVideoTracks(
                new VideoTrack({
                    path: path.resolve(
                        this.workDirectoryName,
                        "./video_download/video.mp4"
                    ),
                })
            );
            videoMuxer.addAudioTracks(
                new AudioTrack({
                    path: path.resolve(
                        this.workDirectoryName,
                        "./audio_download/audio.mp4"
                    ),
                })
            );
        } else {
            fs.writeFileSync(
                path.resolve(this.workDirectoryName, "video_files.txt"),
                this.downloadedVideoChunkFiles
                    .map(
                        (f) =>
                            `file '${path.resolve(
                                this.workDirectoryName,
                                "./video_download",
                                f
                            )}'`
                    )
                    .join("\n")
            );
            fs.writeFileSync(
                path.resolve(this.workDirectoryName, "audio_files.txt"),
                this.downloadedVideoChunkFiles
                    .map(
                        (f) =>
                            `file '${path.resolve(
                                this.workDirectoryName,
                                "./audio_download",
                                f
                            )}'`
                    )
                    .join("\n")
            );
            videoMuxer.addVideoSequences(
                new VideoSequence({
                    path: path.resolve(
                        this.workDirectoryName,
                        "video_files.txt"
                    ),
                })
            );
            videoMuxer.addAudioSequences(
                new AudioSequence({
                    path: path.resolve(
                        this.workDirectoryName,
                        "audio_files.txt"
                    ),
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
