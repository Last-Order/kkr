const xmlParser = require("fast-xml-parser");

export interface Track {
    id: number;
    bitrate: number;
    urls: string[];
}

export interface ParseResult {
    videoTracks: Track[];
    audioTracks: Track[];
    rawMpd: any;
}

const parseMpd = (mpdStr): ParseResult => {
    const mpd = xmlParser.parse(mpdStr, {
        parseAttributeValue: true,
        attrNodeName: "attr",
        ignoreAttributes: false,
    });
    const result: ParseResult = {
        videoTracks: [],
        audioTracks: [],
        rawMpd: mpd,
    };
    const adaptationSets = mpd.MPD.Period.AdaptationSet;
    const videoAdaptation = adaptationSets.find((adaptation) => adaptation.attr["@_mimeType"].startsWith("video"));
    const audioAdaptation = adaptationSets.find((adaptation) => adaptation.attr["@_mimeType"].startsWith("audio"));
    const videoRepresentations = Array.isArray(videoAdaptation.Representation)
        ? videoAdaptation.Representation
        : [videoAdaptation.Representation];
    for (const videoRepresentation of videoRepresentations) {
        const track: Track = {
            id: parseInt(videoRepresentation.attr["@_id"]),
            bitrate: parseInt(videoRepresentation.attr["@_bandwidth"]),
            urls: [],
        };
        const baseUrl = videoRepresentation.BaseURL;
        const segmentList = videoRepresentation.SegmentList;
        if (segmentList.Initialization) {
            track.urls.push(baseUrl + segmentList.Initialization.attr["@_sourceURL"]);
        }
        for (const segmentUrl of segmentList.SegmentURL) {
            track.urls.push(baseUrl + segmentUrl.attr["@_media"]);
        }
        result.videoTracks.push(track);
    }
    const audioRepresentations = Array.isArray(audioAdaptation.Representation)
        ? audioAdaptation.Representation
        : [audioAdaptation.Representation];
    for (const audioRepresentation of audioRepresentations) {
        const track: Track = {
            id: parseInt(audioRepresentation.attr["@_id"]),
            bitrate: parseInt(audioRepresentation.attr["@_bandwidth"]),
            urls: [],
        };
        const baseUrl = audioRepresentation.BaseURL;
        const segmentList = audioRepresentation.SegmentList;
        if (segmentList.Initialization) {
            track.urls.push(baseUrl + segmentList.Initialization.attr["@_sourceURL"]);
        }
        for (const segmentUrl of segmentList.SegmentURL) {
            track.urls.push(baseUrl + segmentUrl.attr["@_media"]);
        }
        result.audioTracks.push(track);
    }
    result.videoTracks = result.videoTracks.sort((a, b) => b.bitrate - a.bitrate);
    result.audioTracks = result.audioTracks.sort((a, b) => b.bitrate - a.bitrate);
    return result;
};

export default parseMpd;
