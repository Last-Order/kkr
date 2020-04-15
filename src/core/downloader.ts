import { EventEmitter } from "events";
import * as ErrorMessages from './messages/error';
import * as fs from 'fs';
import * as path from 'path';
import YouTubeService from "./services/youtube";
import axios from 'axios';
import parseMpd from "./mpd_parser";
import download from "../utils/download_files";
import { VideoMuxer, VideoTrack, AudioTrack } from "../utils/video_muxer";
import mergeFiles from "../utils/merge_files";

export class DownloadError extends Error { }

export interface DownloaderOptions {
    videoUrl: string;
    format?: string;
}

class Downloader extends EventEmitter {
    videoUrl: string;
    videoId: string;
    videoChunkUrls: string[];
    audioChunkUrls: string[];
    downloadedVideoChunkFiles: string[];
    downloadedAudioChunkFiles: string[];
    workDirectoryName: string;
    outputFilename: string;
    constructor({ videoUrl, format }: DownloaderOptions) {
        super();
        this.videoUrl = videoUrl;
    }

    async download() {
        // 解析视频信息
        if (!this.videoUrl) {
            throw new DownloadError(ErrorMessages.CANT_PARSE_VIDEO_URL);
        }
        if (this.videoUrl.includes('youtube.com')) {
            this.videoId = this.videoUrl.match(/v=(.+?)(&|$)/im)[1];
        } else if (this.videoUrl.includes('youtu.be')) {
            this.videoId = this.videoUrl.match(/\/(.+?)(&|$)/im)[1];
        } else {
            throw new DownloadError(ErrorMessages.CANT_PARSE_VIDEO_URL);
        }
        const videoInfo = await YouTubeService.getVideoInfo(this.videoId);
        const playerResponse = JSON.parse(
            decodeURIComponent(videoInfo.match(/player_response=(.+?)&/)[1])
        );
        this.outputFilename = playerResponse.videoDetails.title.replace(/[\/\*\\\:|\?<>]/ig, "") + '.mp4';
        const mpdUrl = playerResponse.streamingData.dashManifestUrl;
        const mpdStr = (await axios.get(mpdUrl)).data;
        const parseResult = parseMpd(mpdStr);
        // 创建工作目录
        this.workDirectoryName = `kkr_download_${new Date().valueOf()}`;
        fs.mkdirSync(this.workDirectoryName);
        fs.mkdirSync(path.resolve(this.workDirectoryName, './video_download'));
        fs.mkdirSync(path.resolve(this.workDirectoryName, './audio_download'));
        this.videoChunkUrls = parseResult.videoTracks[0].urls;
        this.audioChunkUrls = parseResult.audioTracks[0].urls;
        await download(this.videoChunkUrls, path.resolve(this.workDirectoryName, './video_download'));
        await download(this.audioChunkUrls, path.resolve(this.workDirectoryName, './audio_download'));
        this.downloadedVideoChunkFiles = fs.readdirSync(path.resolve(this.workDirectoryName, './video_download'));
        this.downloadedAudioChunkFiles = fs.readdirSync(path.resolve(this.workDirectoryName, './audio_download'));
        await mergeFiles(this.downloadedVideoChunkFiles, path.resolve(this.workDirectoryName, './video_download/video.mp4'));
        await mergeFiles(this.downloadedAudioChunkFiles, path.resolve(this.workDirectoryName, './audio_download/audio.mp4'));
        const videoMuxer = new VideoMuxer(this.outputFilename);
        videoMuxer.addVideoTracks(new VideoTrack({ path: path.resolve(this.workDirectoryName, './video_download/video.mp4') }));
        videoMuxer.addAudioTracks(new AudioTrack({ path: path.resolve(this.workDirectoryName, './audio_download/audio.mp4') }));
        videoMuxer.on('success', () => {
            process.exit();
        });
        videoMuxer.run();
    }
}

export default Downloader;