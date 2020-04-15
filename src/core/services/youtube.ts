import axios from 'axios';
class YouTubeService {
    static async getVideoInfo(videoId: string) {
        const API_URL = `https://youtube.com/get_video_info?video_id=${videoId}`;
        const videoInfoResponse = await axios.get(API_URL);
        return videoInfoResponse.data;
    }
}

export default YouTubeService;