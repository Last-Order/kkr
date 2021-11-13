import axios from "axios";
import * as ErrorMessages from "../../messages/error";

export class ParseError extends Error {}
export class VideoPlayabilityStatusError extends Error {}
class YouTubeService {
    static getVideoIdByUrl(videoUrl: string) {
        let videoId;
        if (!videoUrl) {
            throw new ParseError(ErrorMessages.CANT_PARSE_VIDEO_URL);
        }
        if (videoUrl.includes("youtube.com")) {
            videoId = videoUrl.match(/v=(.+?)(&|$)/im)[1];
        } else if (videoUrl.includes("youtu.be")) {
            videoId = videoUrl.match(/youtu.be\/(.+?)(&|$)/im)[1];
        } else {
            throw new ParseError(ErrorMessages.CANT_PARSE_VIDEO_URL);
        }
        return videoId;
    }
    /**
     * 解析视频信息
     * @param videoUrl
     */
    static async getVideoInfo(videoUrl: string) {
        const videoId = YouTubeService.getVideoIdByUrl(videoUrl);
        const API_URL = `https://youtube.com/watch?v=${videoId}`;
        const videoInfoResponse = await axios.get(API_URL, {
            headers: {
                Referer: "https://www.youtube.com/",
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.129 Safari/537.36",
            },
        });
        let playerResponse;
        if (videoInfoResponse.data.match(/ytplayer\.config = ({.+?});/)) {
            const playerConfig = JSON.parse(videoInfoResponse.data.match(/ytplayer\.config = ({.+?});/)[1]);
            playerResponse = JSON.parse(playerConfig.args.player_response);
        } else if (videoInfoResponse.data.match(/ytInitialPlayerResponse = ({.+?});/)) {
            playerResponse = JSON.parse(videoInfoResponse.data.match(/ytInitialPlayerResponse = ({.+?});/)[1]);
        } else {
            throw new ParseError("解析视频信息失败");
        }
        const title = playerResponse?.videoDetails?.title as string;
        if (!playerResponse.streamingData) {
            const errorReason =
                playerResponse?.playabilityStatus?.errorScreen?.playerErrorMessageRenderer?.subreason?.simpleText ||
                playerResponse?.playabilityStatus?.errorScreen?.playerErrorMessageRenderer?.subreason?.runs?.[0]?.text;
            if (errorReason) {
                throw new VideoPlayabilityStatusError(errorReason);
            }
            throw new ParseError(ErrorMessages.NOT_A_LIVE_STREAM);
        }
        const mpdUrl = playerResponse.streamingData.dashManifestUrl as string;
        const isLowLatencyLiveStream = !!playerResponse?.videoDetails?.isLowLatencyLiveStream;
        const latencyClass = playerResponse?.videoDetails?.latencyClass as string;
        const isLiveDvrEnabled = !!playerResponse?.videoDetails?.isLiveDvrEnabled;
        const isPremiumVideo = !!playerResponse?.videoDetails?.isLive && !playerResponse?.videoDetails?.isLiveContent;
        return {
            title,
            mpdUrl,
            isLowLatencyLiveStream,
            latencyClass,
            isLiveDvrEnabled,
            isPremiumVideo,
        };
    }

    static async getHeartbeat(videoUrl) {
        const videoId = YouTubeService.getVideoIdByUrl(videoUrl);
        const API_URL = `https://www.youtube.com/youtubei/v1/player/heartbeat?alt=json&key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8`;
        const videoInfoResponse = await axios.post(API_URL, {
            videoId: videoId,
            context: {
                client: {
                    clientName: "WEB",
                    clientVersion: "2.20200618.01.01",
                },
            },
            heartbeatRequestParams: {
                heartbeatChecks: ["HEARTBEAT_CHECK_TYPE_LIVE_STREAM_STATUS"],
            },
        });
        return videoInfoResponse.data.playabilityStatus;
    }
}

export default YouTubeService;
