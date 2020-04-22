import YouTubeObserver from "@/core/services/api/youtube_observer";
import * as fs from 'fs';
import * as path from 'path';
import escapeFilename from "@/utils/escape_filename";

interface Task {
    type: 'video' | 'audio';
    url: string;
    id: number;
    retry: number;
    outputPath: string;
}

class LiveDownloader {
    observer: YouTubeObserver;
    workDirectoryName: string;
    outputFilename: string;
    unfinishedTasks: Task[];
    finishedTasks: Task[];
    maxRunningThreads = 16;
    nowRunningThreads = 0;
    stopFlag = false;
    constructor({ videoUrl, format }) {
        this.observer = new YouTubeObserver({
            videoUrl,
            format
        });
    }

    async start() {
        this.workDirectoryName = `kkr_download_${new Date().valueOf()}`;
        fs.mkdirSync(this.workDirectoryName);
        fs.mkdirSync(path.resolve(this.workDirectoryName, './video_download'));
        fs.mkdirSync(path.resolve(this.workDirectoryName, './audio_download'));
        const connectResult = await this.observer.connect();
        this.outputFilename = escapeFilename(`${connectResult.title}.mp4`);
        this.observer.on('new-video-chunks', (urls) => {
            this.unfinishedTasks.push(...urls.map((u: Pick<Task, 'id' | 'url'>): Task => {
                return {
                    url: u.url,
                    id: u.id,
                    retry: 0,
                    type: 'video',
                    outputPath: path.resolve(this.workDirectoryName, `./video_download/${u.id}`)
                }
            }))
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
            }))
        });
    }

    async checkQueue() {
        if (this.stopFlag) {
            // 转向
            return;
        }
        if (this.nowRunningThreads >= this.maxRunningThreads) {
            return;
        }
        if (this.unfinishedTasks.length === 0) {
            return;
        }
        this.nowRunningThreads++;
        const task = this.unfinishedTasks.shift();
        // handle task
        try {
            await this.handleTask(task);
            this.finishedTasks.push(task);
            this.nowRunningThreads--;
            this.checkQueue();
        } catch (e) {
            this.nowRunningThreads--;
            this.unfinishedTasks.push(task);
            this.checkQueue();
        }
    }

    async handleTask(task: Task) {

    }
}