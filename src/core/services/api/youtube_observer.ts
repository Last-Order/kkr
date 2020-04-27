import { EventEmitter } from "events";
import YouTubeService from "./youtube";
import axios from 'axios';
import parseMpd, { ParseResult } from "../../mpd_parser";
import selectFormat from "../../../utils/select_format";
import sleep from "../../../utils/sleep";
import logger from "../logger";

export class NetworkError extends Error {}

export interface ConnectResult {
    mpdUrl: string;
    title: string;
}

class YouTubeObserver extends EventEmitter {
    videoUrl: string;
    mpdUrl: string;
    format: string;
    timer: NodeJS.Timeout;
    audioUrlFlags: boolean[] = [];
    videoUrlFlags: boolean[] = [];
    stopFlag: boolean = false;
    constructor({ videoUrl, format }) {
        super();
        this.videoUrl = videoUrl;
        if (format) {
            this.format = format;
        }
    }

    async connect(): Promise<ConnectResult> {
        // Get Heartbeat
        while (true) {
            try {
                const response = await YouTubeService.getHeartbeat(this.videoUrl);
                if (response.status === "live_stream_offline") {
                    logger.info(`直播尚未开始：${response.reason}`);
                } else {
                    break;
                }
                await sleep(15000);
            } catch (e) {
                logger.debug(e);
                logger.warning(`获取直播信息失败 稍后重试`);
                await sleep(3000);
            }
        }
        // Get Video Info
        let retries = 3;
        while (retries > 0) {
            try {
                const { mpdUrl, title } = await YouTubeService.getVideoInfo(this.videoUrl);
                this.mpdUrl = mpdUrl;
                this.cycling();
                return { mpdUrl, title };
            } catch (e) {
                logger.debug(e);
                logger.warning(`获取视频信息失败${retries < 3 ? ` 第 ${3 - retries} 次重试`: ''}`);
                retries--;
            }
        }
    }

    async disconnect(): Promise<void> {
        this.stopFlag = true;
    }

    async cycling() {
        this.on('end', () => {
            this.stopFlag = true;
        });
        while (!this.stopFlag) {
            try {
                await this.getVideoChunks();
                await sleep(8000);
            } catch (e) {
                logger.debug(e);
                logger.info("获取MPD列表失败");
                await sleep(1500);
            }
        }
    }

    async getVideoChunks() {
        let parseResult: ParseResult;
        try {
            const CancelToken = axios.CancelToken;
            const source = CancelToken.source();
            const timer = setTimeout(() => {
                source.cancel('Timeout');
            }, 15000);
            const mpdStr = (await axios.get(this.mpdUrl, {
                cancelToken: source.token
            })).data;
            clearTimeout(timer);
            parseResult = parseMpd(mpdStr);
        } catch (e) {
            throw new NetworkError("获取MPD列表失败");
        }
        const { selectedVideoTrack, selectedAudioTrack } = selectFormat(this.format, parseResult);
        const newVideoUrls = [];
        for (const url of selectedVideoTrack.urls) {
            const id = parseInt(url.match(/sq\/(.+)\//)[1]);
            if (!this.videoUrlFlags[id]) {
                newVideoUrls.push({
                    id,
                    url
                });
                this.videoUrlFlags[id] = true;
            }
        }
        if (newVideoUrls.length > 0) {
            this.emit('new-video-chunks', newVideoUrls);
        }
        const newAudioUrls = [];
        for (const url of selectedAudioTrack.urls) {
            const id = parseInt(url.match(/sq\/(.+)\//)[1]);
            if (!this.audioUrlFlags[id]) {
                newAudioUrls.push({
                    id,
                    url
                });
                this.audioUrlFlags[id] = true;
            }
        }
        if (newAudioUrls.length > 0) {
            this.emit('new-audio-chunks', newAudioUrls);
        }
        if (parseResult.rawMpd.MPD.attr['@_type'] === 'static') {
            // 直播结束
            this.emit('end');
        }
    }
}

export default YouTubeObserver;