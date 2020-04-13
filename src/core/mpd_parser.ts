const xmlParser = require('fast-xml-parser');

export interface Track {
    id: number;
    bitrate: number;
    urls: string[];
}

export interface ParseResult {
    videoTracks: Track[];
    audioTracks: Track[];
}

const parseMpd = (mpdStr): ParseResult => {
    const mpd = xmlParser.parse(mpdStr, {
        parseAttributeValue: true,
        attrNodeName: "attr",
        ignoreAttributes: false,
    });
    const result: ParseResult = {
        videoTracks: [],
        audioTracks: []
    }
    const adaptationSets = mpd.MPD.Period.AdaptationSet;
    const videoAdaptation = adaptationSets.find(
        (adaptation => adaptation.attr['@_mimeType'].startsWith('video'))
    );
    const audioAdaptation = adaptationSets.find(
        (adaptation => adaptation.attr['@_mimeType'].startsWith('audio'))
    );
    const videoRepresentations = Array.isArray(videoAdaptation.Representation) ? videoAdaptation.Representation : [videoAdaptation.Representation];
    for (const videoRepresentation of videoRepresentations) {
        const track: Track = {
            id: parseInt(videoRepresentation.attr['@_id']),
            bitrate: parseInt(videoRepresentation.attr['@_bitrate']),
            urls: []
        };
        const baseUrl = videoRepresentation.BaseURL;
        for (const segmentUrl of videoRepresentation.SegmentList.SegmentURL) {
            track.urls.push(
                baseUrl + segmentUrl.attr['@_media']
            );
        }
        result.videoTracks.push(track);
    }
    const audioRepresentations = Array.isArray(audioAdaptation.Representation) ? audioAdaptation.Representation : [audioAdaptation.Representation];
    for (const audioRepresentation of audioRepresentations) {
        const track: Track = {
            id: parseInt(audioRepresentation.attr['@_id']),
            bitrate: parseInt(audioRepresentation.attr['@_bitrate']),
            urls: []
        };
        const baseUrl = audioRepresentation.BaseURL;
        for (const segmentUrl of audioRepresentation.SegmentList.SegmentURL) {
            track.urls.push(
                baseUrl + segmentUrl.attr['@_media']
            );
        }
        result.audioTracks.push(track);
    }
    return result;
}

export default parseMpd;