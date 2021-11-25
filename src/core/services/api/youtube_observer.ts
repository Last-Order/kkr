import { EventEmitter } from "events";
import YouTubeService from "./youtube";
import axios from "axios";
import parseMpd, { ParseResult } from "../../mpd_parser";
import selectFormat from "../../../utils/select_format";
import sleep from "../../../utils/sleep";
import logger from "../logger";

export class NetworkError extends Error {}

export interface ConnectResult {
    mpdUrl: string;
    title: string;
    isLowLatencyLiveStream: boolean;
    latencyClass: string;
    isLiveDvrEnabled: boolean;
    isPremiumVideo: boolean;
}

export interface YouTubeObserverParams {
    videoUrl: string;
    format: string;
}

class YouTubeObserver extends EventEmitter {
    videoUrl: string;
    mpdUrl: string;
    format: string;

    playlistFetchInterval: number = 3500;
    playlistFetchTimer: NodeJS.Timeout;
    mpdUrlFetchTimer: NodeJS.Timeout;
    audioUrlFlags: boolean[] = [];
    videoUrlFlags: boolean[] = [];
    constructor({ videoUrl, format }: YouTubeObserverParams) {
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
                logger.info(`正在获取视频信息`);
                const response = await YouTubeService.getHeartbeat(this.videoUrl);
                if (response.status === "LIVE_STREAM_OFFLINE") {
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
                const {
                    mpdUrl,
                    title,
                    isLowLatencyLiveStream,
                    latencyClass,
                    isLiveDvrEnabled,
                    isPremiumVideo,
                } = await YouTubeService.getVideoInfo(this.videoUrl);
                this.mpdUrl = mpdUrl;
                if (isLowLatencyLiveStream) {
                    this.playlistFetchInterval = 2000;
                }
                this.cycling();
                return {
                    mpdUrl,
                    title,
                    isLowLatencyLiveStream,
                    latencyClass,
                    isLiveDvrEnabled,
                    isPremiumVideo,
                };
            } catch (e) {
                logger.debug(e);
                logger.warning(`获取视频信息失败${retries < 3 ? ` 第 ${3 - retries} 次重试` : ""}`);
                retries--;
            }
        }
    }

    async disconnect(): Promise<void> {
        clearInterval(this.playlistFetchTimer);
        clearInterval(this.mpdUrlFetchTimer);
    }

    async cycling() {
        this.playlistFetchTimer = setInterval(async () => {
            try {
                logger.debug("正获取MPD列表");
                await this.getVideoChunks();
                logger.debug("获取MPD列表成功");
            } catch (e) {
                logger.debug(e);
                logger.info("获取MPD列表失败");
            }
        }, this.playlistFetchInterval);
        // Fresh MPD URL every hour
        this.mpdUrlFetchTimer = setInterval(async () => {
            try {
                const { mpdUrl } = await YouTubeService.getVideoInfo(this.videoUrl);
                this.mpdUrl = mpdUrl;
            } catch (e) {}
        }, 3600 * 1000);
        this.on("end", () => {
            clearInterval(this.playlistFetchTimer);
        });
    }

    async getVideoChunks() {
        const CancelToken = axios.CancelToken;
        const source = CancelToken.source();
        const timer = setTimeout(() => {
            source.cancel("Timeout");
        }, 8000);
        const mpdStr = (
            await axios.get(this.mpdUrl, {
                cancelToken: source.token,
            })
        ).data;
        clearTimeout(timer);
        const parseResult = parseMpd(mpdStr);
        const { selectedVideoTrack, selectedAudioTrack } = selectFormat(this.format, parseResult);
        const newVideoUrls = [];
        for (const url of selectedVideoTrack.urls) {
            const id = parseInt(url.match(/\/sq\/(\d+)\//)[1]);
            if (isNaN(id)) {
                logger.warning(`遇到了奇怪的URL 请截图给开发者：${url}`);
                continue;
            }
            if (!this.videoUrlFlags[id]) {
                newVideoUrls.push({
                    id,
                    url,
                });
                this.videoUrlFlags[id] = true;
            }
        }
        if (newVideoUrls.length > 0) {
            this.emit("new-video-chunks", newVideoUrls);
        }
        const newAudioUrls = [];
        for (const url of selectedAudioTrack.urls) {
            const id = parseInt(url.match(/\/sq\/(\d+)\//)[1]);
            if (isNaN(id)) {
                logger.warning(`遇到了奇怪的URL 请截图给开发者：${url}`);
                continue;
            }
            if (!this.audioUrlFlags[id]) {
                newAudioUrls.push({
                    id,
                    url,
                });
                this.audioUrlFlags[id] = true;
            }
        }
        if (newAudioUrls.length > 0) {
            this.emit("new-audio-chunks", newAudioUrls);
        }
        if (parseResult.rawMpd?.MPD?.attr["@_type"] === "static") {
            // 直播结束
            this.emit("end");
        }
    }
}

export default YouTubeObserver;
