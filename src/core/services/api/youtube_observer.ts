import { EventEmitter } from "events";
import YouTubeService from "./youtube";
import axios from 'axios';
import parseMpd, { ParseResult } from "@/core/mpd_parser";
import selectFormat from "@/utils/select_format";
import sleep from "@/utils/sleep";

export class NetworkError extends Error {}

class YouTubeObserver extends EventEmitter {
    videoUrl: string;
    mpdUrl: string;
    format: string;
    timer: NodeJS.Timeout;
    audioUrlFlags: boolean[];
    videoUrlFlags: boolean[];
    stopFlag: boolean = false;
    constructor({ videoUrl, format }) {
        super();
        this.videoUrl = videoUrl;
        if (format) {
            this.format = format;
        }
    }

    async connect() {
        // Get Video Info
        const { mpdUrl, title } = await YouTubeService.getVideoInfo(this.videoUrl);
        this.mpdUrl = mpdUrl;
        return { mpdUrl, title };
    }

    async disconnect() {
        this.stopFlag = true;
    }

    async cycling() {
        this.on('end', () => {
            this.stopFlag = true;
        })
        while (!this.stopFlag) {
            try {
                await this.getVideoChunks();
                await sleep(8000);
            } catch (e) {
                console.log("获取MPD列表失败");
                await sleep(1500);
            }
        }
    }

    async getVideoChunks() {
        let parseResult: ParseResult;
        try {
            const CancelToken = axios.CancelToken;
            const source = CancelToken.source();
            setTimeout(() => {
                source.cancel('Timeout');
            }, 15000);
            const mpdStr = (await axios.get(this.mpdUrl, {
                cancelToken: source.token
            })).data;
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