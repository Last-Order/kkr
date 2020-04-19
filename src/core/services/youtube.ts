import axios from 'axios';
import * as ErrorMessages from '../messages/error';

export class ParseError extends Error { }
class YouTubeService {
    /**
     * 解析视频信息
     * @param videoUrl 
     */
    static async getVideoInfo(videoUrl: string) {
        let videoId;
        if (!videoUrl) {
            throw new ParseError(ErrorMessages.CANT_PARSE_VIDEO_URL);
        }
        if (videoUrl.includes('youtube.com')) {
            videoId = videoUrl.match(/v=(.+?)(&|$)/im)[1];
        } else if (videoUrl.includes('youtu.be')) {
            videoId = videoUrl.match(/\/(.+?)(&|$)/im)[1];
        } else {
            throw new ParseError(ErrorMessages.CANT_PARSE_VIDEO_URL);
        }
        const API_URL = `https://youtube.com/get_video_info?video_id=${videoId}`;
        const videoInfoResponse = await axios.get(API_URL);
        const playerResponse = JSON.parse(
            decodeURIComponent(videoInfoResponse.data.match(/player_response=(.+?)&/)[1])
        );
        const title = playerResponse.videoDetails.title;
        if (!playerResponse.streamingData) {
            throw new ParseError(ErrorMessages.NOT_A_LIVE_STREAM);
        }
        const mpdUrl = playerResponse.streamingData.dashManifestUrl;
        return {
            title,
            mpdUrl
        };
    }
}

export default YouTubeService;