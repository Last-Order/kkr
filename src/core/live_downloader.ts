import * as fs from "fs";
import * as path from "path";
import axios from "axios";
import escapeFilename from "../utils/escape_filename";
import download from "../utils/download_file";
import Logger, { ConsoleLogger } from "./services/logger";
import YouTubeObserver from "./services/api/youtube_observer";
import { VideoMuxer, VideoTrack, AudioTrack, VideoSequence, AudioSequence } from "../utils/video_muxer";
import deleteDirectory from "../utils/delete_directory";
import { isFFmpegAvailable, isFFprobeAvailable } from "../utils/system";
import mergeFiles from "../utils/merge_files";
import analyseConcatMethod, { ConcatMethod } from "../utils/analyse_concat_method";
interface Task {
    type: "video" | "audio";
    url: string;
    id: number;
    retry: number;
    outputPath: string;
}

export interface LiveDownloaderOptions {
    videoUrl: string;
    format?: string;
    verbose?: boolean;
    keep?: boolean;
    threads?: number;
    concatMethod?: ConcatMethod;
    forceMerge?: boolean;
    cooldown?: number;
    headers?: string;
}

export interface OutputItem {
    description: string;
    path: string;
}

class LiveDownloader {
    keepTemporaryFiles: boolean;

    observer: YouTubeObserver;
    logger: ConsoleLogger;
    workDirectoryName: string;
    outputFilename: string;
    unfinishedTasks: Task[] = [];
    finishedTasks: Task[] = [];
    droppedTasks: Task[] = [];
    outputFiles: OutputItem[] = [];
    maxRunningThreads = 10;
    nowRunningThreads = 0;
    concatMethod: ConcatMethod;
    forceMerge: boolean = false;
    cooldown: number = 0;
    headers: Record<string, string> = {};
    stopFlag = false;
    finishFlag = false;

    isLowLatencyLiveStream: boolean;
    isLiveDvrEnabled: boolean;
    isPremiumVideo: boolean;
    latencyClass: string;
    isFFmpegAvailable: boolean;
    isFFprobeAvailable: boolean;
    constructor(
        videoUrl,
        { format, verbose, keep, threads, concatMethod, forceMerge, cooldown, headers }: Partial<LiveDownloaderOptions>
    ) {
        this.logger = Logger;
        if (verbose) {
            this.logger.enableDebug();
        }
        if (keep) {
            this.keepTemporaryFiles = true;
        }
        if (threads) {
            this.maxRunningThreads = threads;
        }
        if (concatMethod) {
            this.concatMethod = concatMethod;
        }
        if (forceMerge) {
            this.forceMerge = forceMerge;
        }
        if (cooldown) {
            this.cooldown = cooldown;
        }
        if (headers) {
            for (const h of headers.toString().split("\n")) {
                const header = h.split(":");
                if (header.length < 2) {
                    throw new Error(`HTTP Headers invalid.`);
                }
                this.headers[header[0]] = header.slice(1).join(":");
            }
            axios.defaults.headers.common = {
                ...axios.defaults.headers.common,
                ...this.headers,
            };
        }
        this.observer = new YouTubeObserver({
            videoUrl,
            format,
        });
    }

    async start() {
        this.logger.debug(`使用至多 ${this.maxRunningThreads} 线程下载`);
        this.isFFmpegAvailable = await isFFmpegAvailable();
        this.isFFprobeAvailable = await isFFprobeAvailable();
        if (!this.isFFmpegAvailable) {
            this.logger.warning("FFmpeg不可用 视频不会自动合并");
        }
        if (!this.isFFprobeAvailable && !this.concatMethod) {
            this.logger.warning("FFprobe不可用 无法准确确定合并方式 临时文件将会被保留");
            this.keepTemporaryFiles = true;
        }
        if (this.concatMethod) {
            this.logger.warning(`手动指定了合并方式${this.concatMethod} 希望你清楚这么做的效果`);
        }
        this.workDirectoryName = `kkr_download_${Date.now()}`;
        fs.mkdirSync(this.workDirectoryName);
        fs.mkdirSync(path.resolve(this.workDirectoryName, "./video_download"));
        fs.mkdirSync(path.resolve(this.workDirectoryName, "./audio_download"));
        process.on("SIGINT", async () => {
            if (!this.stopFlag) {
                this.logger.info("Ctrl+C 被按下 等待当前任务下载完毕");
                this.observer.disconnect();
                this.stopFlag = true;
                this.checkQueue();
            } else {
                this.logger.info("强制结束");
                process.exit();
            }
        });
        const connectResult = await this.observer.connect();
        this.logger.info(`视频标题: ${connectResult.title}`);
        this.logger.info(
            `是否启用DVR: ${connectResult.isLiveDvrEnabled}; 低延迟视频: ${connectResult.isLowLatencyLiveStream}; 视频延迟模式: ${connectResult.latencyClass}; 是否为首播: ${connectResult.isPremiumVideo}`
        );
        this.logger.debug(`MPD URL: ${connectResult.mpdUrl}`);
        this.isLiveDvrEnabled = connectResult.isLiveDvrEnabled;
        this.isLowLatencyLiveStream = connectResult.isLowLatencyLiveStream;
        this.latencyClass = connectResult.latencyClass;
        this.isPremiumVideo = connectResult.isPremiumVideo;
        this.outputFilename = escapeFilename(`${connectResult.title}`);
        this.observer.on("new-video-chunks", (urls) => {
            this.unfinishedTasks.push(
                ...urls.map((u: Pick<Task, "id" | "url">): Task => {
                    return {
                        url: u.url,
                        id: u.id,
                        retry: 0,
                        type: "video",
                        outputPath: path.resolve(this.workDirectoryName, `./video_download/${u.id}`),
                    };
                })
            );
            this.checkQueue();
        });
        this.observer.on("new-audio-chunks", (urls) => {
            this.unfinishedTasks.push(
                ...urls.map((u: Pick<Task, "id" | "url">): Task => {
                    return {
                        url: u.url,
                        id: u.id,
                        retry: 0,
                        type: "audio",
                        outputPath: path.resolve(this.workDirectoryName, `./audio_download/${u.id}`),
                    };
                })
            );
            this.checkQueue();
        });
        this.observer.on("end", () => {
            this.stopFlag = true;
            this.checkQueue();
        });
    }

    async checkQueue() {
        if (this.nowRunningThreads === 0 && this.unfinishedTasks.length === 0 && this.stopFlag) {
            if (!this.finishFlag) {
                this.finishFlag = true;
                this.beforeExit();
            }
        }
        if (this.nowRunningThreads >= this.maxRunningThreads) {
            return;
        }
        if (this.unfinishedTasks.length === 0) {
            return;
        }
        this.nowRunningThreads++;
        const task = this.unfinishedTasks.shift();
        this.checkQueue();
        // handle task
        try {
            await this.handleTask(task);
            this.logger.info(`${task.type}#${task.id} 已下载`);
            this.finishedTasks.push(task);
            this.nowRunningThreads--;
            this.checkQueue();
        } catch (e) {
            this.logger.debug(e);
            task.retry++;
            this.nowRunningThreads--;
            this.logger.warning(`${task.type}#${task.id} 下载失败 稍后重试`);
            if (task.retry <= 10) {
                this.unfinishedTasks.push(task);
            } else {
                this.logger.error(`${task.type}#${task.id} 重试次数达到上限 被放弃`);
                this.droppedTasks.push(task);
            }
            this.checkQueue();
        }
    }

    async beforeExit() {
        if (this.finishedTasks.length === 0) {
            // 什么也没做 直接退出吧
            this.clean();
            return;
        }
        this.finishedTasks = this.finishedTasks.sort((a, b) => a.id - b.id);
        let finishedVideoTasks = this.finishedTasks.filter((t) => t.type === "video");
        const finishedAudioTasks = this.finishedTasks.filter((t) => t.type === "audio");
        if (finishedVideoTasks.length !== finishedAudioTasks.length) {
            // TODO: 处理音视频块数量不一致的情况
            this.logger.error("下载的音视频块数量不一致 请手动合并");
            this.logger.error(`临时文件位于：${path.resolve(this.workDirectoryName)}`);
            process.exit();
        }
        // 检查视频块是否都有对应音频块 没有对应音频块的视频块将会被丢弃
        const audioIdFlags = [];
        let dropCounter = 0;
        for (const audioTask of finishedAudioTasks) {
            audioIdFlags[audioTask.id] = true;
        }
        finishedVideoTasks = finishedVideoTasks.filter((t) => {
            if (!audioIdFlags) {
                dropCounter++;
            }
            return audioIdFlags[t.id];
        });
        if (dropCounter > 0) {
            this.logger.warning(`丢弃了 ${dropCounter} 个没有对应音频的视频块`);
        }
        // 遍历已下载的视频块
        // 将连续的归为一组 最终将形成大于等于一个输出组
        let seqs: Task[][] = [];
        seqs.push([finishedVideoTasks[0]]);
        if (finishedVideoTasks.length !== 1) {
            for (let i = 1; i <= finishedVideoTasks.length - 1; i++) {
                if (finishedVideoTasks[i].id - finishedVideoTasks[i - 1].id !== 1) {
                    seqs.push([]);
                }
                seqs[seqs.length - 1].push(finishedVideoTasks[i]);
            }
        }
        // 当形成了大于1个输出组的时候 打印输出列表
        if (seqs.length > 1) {
            if (this.forceMerge) {
                seqs = [seqs.flat()];
            } else {
                this.logger.info("序列不连续 将输出多个文件");
                for (let i = 0; i <= seqs.length - 1; i++) {
                    this.logger.info(`输出文件${i + 1}: #${seqs[i][0].id}-#${seqs[i][seqs[i].length - 1].id}`);
                }
            }
        }
        // 决定合并模式
        let useDirectConcat = true;
        let concatMethodGuessing = false;

        if (this.concatMethod) {
            useDirectConcat = this.concatMethod === ConcatMethod.DIRECT_CONCAT;
            concatMethodGuessing = false;
        } else {
            if (!this.isFFprobeAvailable) {
                this.logger.warning(
                    "FFprobe不可用 无法从视频信息分析合并模式 将进行自动分析 自动分析结果可能错误 临时文件将不会被删除"
                );
                concatMethodGuessing = true;
            } else {
                if (seqs.flat().length === 1) {
                    // 仅有一个块 不分析直接pass
                } else {
                    const result = await analyseConcatMethod(
                        path.resolve(this.workDirectoryName, "./video_download", seqs.flat()[0].id.toString()),
                        path.resolve(this.workDirectoryName, "./video_download", seqs.flat()[1].id.toString())
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
        const useSuffix = seqs.length > 1;
        for (let i = 0; i <= seqs.length - 1; i++) {
            if (useDirectConcat) {
                const videoOutputPath = path.resolve(this.workDirectoryName, `./video_download/video_merge_${i}.mp4`);
                const audioOutputPath = path.resolve(this.workDirectoryName, `./audio_download/video_merge_${i}.mp4`);
                this.logger.info(`为第 ${i + 1} 个输出文件合并视频`);
                await mergeFiles(
                    Array.from(seqs[i], (t) => t.id).map(
                        (id) => `${path.resolve(this.workDirectoryName, "./video_download/", id.toString())}`
                    ),
                    videoOutputPath
                );
                this.logger.info(`为第 ${i + 1} 个输出文件合并音频`);
                await mergeFiles(
                    Array.from(seqs[i], (t) => t.id).map(
                        (id) => `${path.resolve(this.workDirectoryName, "./audio_download/", id.toString())}`
                    ),
                    audioOutputPath
                );
                this.logger.info(`混流第 ${i + 1} 个输出文件`);
                try {
                    const filename = await this.merge(videoOutputPath, audioOutputPath, useSuffix ? i + 1 : undefined);
                    this.outputFiles.push({
                        path: filename,
                        description: `#${seqs[i][0].id} - #${seqs[i][seqs[i].length - 1].id}`,
                    });
                } catch (e) {
                    this.logger.debug(e);
                    this.logger.error(`混流第 ${i + 1} 个输出文件失败`);
                }
            } else {
                const videoListFilename = path.resolve(
                    this.workDirectoryName,
                    `video_files_${new Date().valueOf()}.txt`
                );
                const audioListFilename = path.resolve(
                    this.workDirectoryName,
                    `audio_files_${new Date().valueOf()}.txt`
                );
                fs.writeFileSync(
                    path.resolve(this.workDirectoryName, videoListFilename),
                    Array.from(seqs[i], (t) => t.id)
                        .map((f) => `file '${path.resolve(this.workDirectoryName, "./video_download", f.toString())}'`)
                        .join("\n")
                );
                fs.writeFileSync(
                    path.resolve(this.workDirectoryName, audioListFilename),
                    Array.from(seqs[i], (t) => t.id)
                        .map((f) => `file '${path.resolve(this.workDirectoryName, "./audio_download", f.toString())}'`)
                        .join("\n")
                );
                try {
                    const filename = await this.mergeSequences(
                        videoListFilename,
                        audioListFilename,
                        useSuffix ? i + 1 : undefined
                    );
                    this.outputFiles.push({
                        path: filename,
                        description: `#${seqs[i][0].id} - #${seqs[i][seqs[i].length - 1].id}`,
                    });
                } catch (e) {
                    this.logger.debug(e);
                    this.logger.error(`混流第 ${i + 1} 个输出文件失败`);
                    this.keepTemporaryFiles = true;
                }
            }
        }
        this.clean();
    }

    async clean() {
        if (!this.keepTemporaryFiles) {
            this.logger.info(`清理临时文件`);
            await deleteDirectory(path.resolve(this.workDirectoryName));
        }
        this.observer.disconnect();
        if (this.outputFiles.length > 0) {
            if (this.outputFiles.length === 1) {
                this.logger.info(`输出文件位于：${path.resolve(".", this.outputFiles[0].path)}`);
            } else {
                this.logger.info(`输出了多个文件 列表如下`);
                for (const item of this.outputFiles) {
                    this.logger.info(`${item.description} -> ${item.path}`);
                }
                if (this.droppedTasks.length > 0) {
                    this.logger.info(`有${this.droppedTasks.length}个分块因为重试次数达到上限而被放弃`);
                }
            }
        }
        process.exit();
    }

    async handleTask(task: Task) {
        return await download(task.url, task.outputPath, {
            timeout: Math.min(45000, 15000 + 15000 * task.retry),
            cooldown: this.cooldown,
        });
    }

    async merge(videoPath: string, audioPath: string, suffix: string | number): Promise<string> {
        return new Promise((resolve, reject) => {
            const videoMuxer = new VideoMuxer(`${this.outputFilename}${suffix ? `_${suffix}` : ""}.mp4`);
            videoMuxer.addVideoTracks(
                new VideoTrack({
                    path: videoPath,
                })
            );
            videoMuxer.addAudioTracks(
                new AudioTrack({
                    path: audioPath,
                })
            );
            videoMuxer.on("success", (outputFilename) => resolve(outputFilename));
            videoMuxer.on("fail", () => {
                reject();
            });
            videoMuxer.run();
        });
    }

    async mergeSequences(
        videoFileListPath: string,
        audioFileListPath: string,
        suffix: string | number
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const videoMuxer = new VideoMuxer(`${this.outputFilename}${suffix ? `_${suffix}` : ""}.mp4`);
            videoMuxer.addVideoTracks(
                new VideoSequence({
                    path: videoFileListPath,
                })
            );
            videoMuxer.addAudioTracks(
                new AudioSequence({
                    path: audioFileListPath,
                })
            );
            videoMuxer.on("success", (outputFilename) => resolve(outputFilename));
            videoMuxer.on("fail", () => {
                reject();
            });
            videoMuxer.run();
        });
    }
}

export default LiveDownloader;
