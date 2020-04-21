import { EventEmitter } from "events";
import * as fs from 'fs';
import * as path from 'path';
import YouTubeService from "./services/api/youtube";
import axios from 'axios';
import parseMpd from "./mpd_parser";
import download from "../utils/download_files";
import { VideoMuxer, VideoTrack, AudioTrack } from "../utils/video_muxer";
import mergeFiles from "../utils/merge_files";
import deleteDirectory from "../utils/delete_directory";
import selectFormat from "../utils/select_format";
import escapeFilename from "../utils/escape_filename";

export class DownloadError extends Error { }

export interface DownloaderOptions {
    videoUrl: string;
    format?: string;
}

class Downloader extends EventEmitter {
    videoUrl: string;
    format: string;
    videoChunkUrls: string[];
    audioChunkUrls: string[];
    downloadedVideoChunkFiles: string[];
    downloadedAudioChunkFiles: string[];
    workDirectoryName: string;
    outputFilename: string;
    constructor({ videoUrl, format }: DownloaderOptions) {
        super();
        this.videoUrl = videoUrl;
        if (format) {
            this.format = format;
        }
    }

    async download() {
        // 解析视频信息
        const {
            title,
            mpdUrl
        } = await YouTubeService.getVideoInfo(this.videoUrl);
        this.outputFilename = escapeFilename(`${title}.mp4`);
        const mpdStr = (await axios.get(mpdUrl)).data;
        const parseResult = parseMpd(mpdStr);
        // 创建工作目录
        this.workDirectoryName = `kkr_download_${new Date().valueOf()}`;
        fs.mkdirSync(this.workDirectoryName);
        fs.mkdirSync(path.resolve(this.workDirectoryName, './video_download'));
        fs.mkdirSync(path.resolve(this.workDirectoryName, './audio_download'));
        const { selectedVideoTrack, selectedAudioTrack } = selectFormat(this.format, parseResult);
        this.videoChunkUrls = selectedVideoTrack.urls;
        this.audioChunkUrls = selectedAudioTrack.urls;
        await download(this.videoChunkUrls, path.resolve(this.workDirectoryName, './video_download'));
        await download(this.audioChunkUrls, path.resolve(this.workDirectoryName, './audio_download'));
        this.downloadedVideoChunkFiles = fs.readdirSync(path.resolve(this.workDirectoryName, './video_download'));
        this.downloadedAudioChunkFiles = fs.readdirSync(path.resolve(this.workDirectoryName, './audio_download'));
        await mergeFiles(
            this.downloadedVideoChunkFiles.map(f => path.resolve(this.workDirectoryName, './video_download', f)),
            path.resolve(this.workDirectoryName, './video_download/video.mp4')
        );
        await mergeFiles(
            this.downloadedAudioChunkFiles.map(f => path.resolve(this.workDirectoryName, './audio_download', f)),
            path.resolve(this.workDirectoryName, './audio_download/audio.mp4')
        );
        const videoMuxer = new VideoMuxer(this.outputFilename);
        videoMuxer.addVideoTracks(new VideoTrack({ path: path.resolve(this.workDirectoryName, './video_download/video.mp4') }));
        videoMuxer.addAudioTracks(new AudioTrack({ path: path.resolve(this.workDirectoryName, './audio_download/audio.mp4') }));
        videoMuxer.on('success', async () => {
            await deleteDirectory(this.workDirectoryName);
            process.exit();
        });
        videoMuxer.run();
    }
}

export default Downloader;