import YouTubeObserver from "./services/api/youtube_observer";
import * as fs from 'fs';
import * as path from 'path';
import escapeFilename from "../utils/escape_filename";
import download from "../utils/download_file";
import Logger, { ConsoleLogger } from "./services/logger";
import mergeFiles from "../utils/merge_files";
import { VideoMuxer, VideoTrack, AudioTrack } from "../utils/video_muxer";
import deleteDirectory from "../utils/delete_directory";
const wtf = require('wtfnode');
interface Task {
    type: 'video' | 'audio';
    url: string;
    id: number;
    retry: number;
    outputPath: string;
}

export interface LiveDownloaderOptions {
    videoUrl: string;
    format: string;
    verbose: boolean;
}

class LiveDownloader {
    observer: YouTubeObserver;
    logger: ConsoleLogger;
    workDirectoryName: string;
    outputFilename: string;
    unfinishedTasks: Task[] = [];
    finishedTasks: Task[] = [];
    dropedTasks: Task[] = [];
    maxRunningThreads = 16;
    nowRunningThreads = 0;
    stopFlag = false;
    finishFlag = false;
    constructor({ videoUrl, format, verbose }: Partial<LiveDownloaderOptions>) {
        this.observer = new YouTubeObserver({
            videoUrl,
            format
        });
        this.logger = Logger;
        if (verbose) {
            this.logger.enableDebug();
        }
    }

    async start() {
        this.workDirectoryName = `kkr_download_${new Date().valueOf()}`;
        fs.mkdirSync(this.workDirectoryName);
        fs.mkdirSync(path.resolve(this.workDirectoryName, './video_download'));
        fs.mkdirSync(path.resolve(this.workDirectoryName, './audio_download'));
        process.on("SIGINT", async () => {
            if (!this.stopFlag) {
                this.logger.info('Ctrl+C 被按下 等待当前任务下载完毕');
                this.observer.disconnect();
                this.stopFlag = true;
                this.checkQueue();
            } else {
                this.logger.info('强制结束');
                process.exit();
            }
        });
        const connectResult = await this.observer.connect();
        this.outputFilename = escapeFilename(`${connectResult.title}`);
        this.observer.on('new-video-chunks', (urls) => {
            this.unfinishedTasks.push(...urls.map((u: Pick<Task, 'id' | 'url'>): Task => {
                return {
                    url: u.url,
                    id: u.id,
                    retry: 0,
                    type: 'video',
                    outputPath: path.resolve(this.workDirectoryName, `./video_download/${u.id}`)
                }
            }));
            this.checkQueue();
        });
        this.observer.on('new-audio-chunks', (urls) => {
            this.unfinishedTasks.push(...urls.map((u: Pick<Task, 'id' | 'url'>): Task => {
                return {
                    url: u.url,
                    id: u.id,
                    retry: 0,
                    type: 'audio',
                    outputPath: path.resolve(this.workDirectoryName, `./audio_download/${u.id}`)
                }
            }));
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
            this.logger.debug(`${task.type}#${task.id} 已下载`);
            this.finishedTasks.push(task);
            this.nowRunningThreads--;
            this.checkQueue();
        } catch (e) {
            task.retry++;
            this.nowRunningThreads--;
            this.logger.debug(`${task.type}#${task.id} 下载失败 稍后重试`);
            if (task.retry <= 10) {
                this.unfinishedTasks.push(task);
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
        let finishedVideoTasks = this.finishedTasks.filter(t => t.type === 'video');
        const finishedAudioTasks = this.finishedTasks.filter(t => t.type === 'audio');
        if (finishedVideoTasks.length !== finishedAudioTasks.length) {
            // TODO: 处理音视频块数量不一致的情况
            this.logger.error('下载的音视频块数量不一致 请手动合并');
            this.logger.error(`临时文件位于：${path.resolve(this.workDirectoryName)}`);
            process.exit();
        }
        // 检查视频块是否都有对应音频块 没有对应音频块的视频块将会被丢弃
        const audioIdFlags = [];
        let dropCounter = 0;
        for (const audioTask of finishedAudioTasks) {
            audioIdFlags[audioTask.id] = true;
        }
        finishedVideoTasks = finishedVideoTasks.filter(t => {
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
        const seqs: Task[][] = [];
        if (finishedVideoTasks.length === 1) {
            seqs.push([
                finishedVideoTasks[0]
            ])
        } else {
            seqs.push([]);
            for (let i = 1; i <= finishedVideoTasks.length - 1; i++) {
                if (finishedVideoTasks[i].id - finishedVideoTasks[i - 1].id !== 1) {
                    seqs.push([]);
                }
                seqs[seqs.length - 1].push(finishedVideoTasks[i]);
            }
        }
        // 当形成了大于1个输出组的时候 打印输出列表
        if (seqs.length > 1) {
            this.logger.info('序列不连续 将输出多个文件');
            for (let i = 0; i <= seqs.length - 1; i++) {
                this.logger.info(`输出文件${i + 1}: #${seqs[i][0].id}-#${seqs[i][seqs[i].length - 1].id}`);
            }
        }
        for (let i = 0; i <= seqs.length - 1; i++) {
            this.logger.info(`为第 ${i + 1} 个输出文件合并视频`);
            const videoOutputPath = path.resolve(this.workDirectoryName, `./video_download/video_merge_${i}.mp4`);
            const audioOutputPath = path.resolve(this.workDirectoryName, `./audio_download/video_merge_${i}.mp4`);
            await mergeFiles(Array.from(seqs[i], t => t.id).map(id => `${path.resolve(this.workDirectoryName, './video_download/', id.toString())}`), videoOutputPath);
            this.logger.info(`为第 ${i + 1} 个输出文件合并音频`);
            await mergeFiles(Array.from(seqs[i], t => t.id).map(id => `${path.resolve(this.workDirectoryName, './audio_download/', id.toString())}`), audioOutputPath);
            this.logger.info(`混流第 ${i + 1} 个输出文件`)
            try {
                await this.merge(videoOutputPath, audioOutputPath, i + 1);
            } catch (e) {
                this.logger.error(`混流第 ${i + 1} 个输出文件失败`);
            }
        }
        this.clean();
    }

    async clean() {
        this.logger.info(`清理临时文件`);
        await deleteDirectory(path.resolve(this.workDirectoryName));
        this.observer.disconnect();
        this.logger.info(`输出文件位于：${path.resolve('.', this.outputFilename)}`)
        process.exit();
    }

    async handleTask(task: Task) {
        return await download(task.url, task.outputPath, {
            timeout: Math.min(45000, 15000 + 15000 * task.retry)
        });
    }

    async merge(videoPath, audioPath, suffix) {
        return new Promise((resolve, reject) => {
            const videoMuxer = new VideoMuxer(`${this.outputFilename}${suffix ? `_${suffix}` : ''}.mp4`);
            videoMuxer.addVideoTracks(new VideoTrack({
                path: videoPath
            }));
            videoMuxer.addAudioTracks(new AudioTrack({
                path: audioPath
            }));
            videoMuxer.on('success', resolve);
            videoMuxer.on('fail', () => {
                reject();
            });
            videoMuxer.run();
        });
    }
}

export default LiveDownloader;