import { Track } from "../core/mpd_parser";

export interface Tracks {
    videoTracks: Track[];
    audioTracks: Track[];
}

const selectFormat = (format: string, tracks: Tracks) => {
    // Format selection
    let selectedVideoTrack: Track, selectedAudioTrack: Track;
    if (!format) {
        selectedVideoTrack = tracks.videoTracks[0];
        selectedAudioTrack = tracks.audioTracks[0];
    } else {
        const formatArr = format.split("+").map((f) => parseInt(f));
        selectedVideoTrack = tracks.videoTracks.find((track) => formatArr.includes(track.id));
        selectedAudioTrack = tracks.audioTracks.find((track) => formatArr.includes(track.id));
        // If not selected, fallback to the best
        if (!selectedVideoTrack) {
            selectedVideoTrack = tracks.videoTracks[0];
        }
        if (!selectedAudioTrack) {
            selectedAudioTrack = tracks.audioTracks[0];
        }
    }
    return {
        selectedVideoTrack,
        selectedAudioTrack,
    };
};

export default selectFormat;
