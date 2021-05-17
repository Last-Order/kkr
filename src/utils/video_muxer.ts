import * as fs from "fs";
import * as path from "path";
import { EventEmitter } from "events";
import logger from "../core/services/logger";
import CommandExecuter from "./command_executer";

class VideoTrack {
    type = "video";
    path: string;
    constructor({ path }) {
        this.path = path;
    }
}

class VideoSequence {
    type = "video_sequence";
    path: string;
    constructor({ path }) {
        this.path = path;
    }
}

class AudioTrack {
    type = "audio";
    path: string;
    constructor({ path }) {
        this.path = path;
    }
}

class AudioSequence {
    type = "audio_sequence";
    path: string;
    constructor({ path }) {
        this.path = path;
    }
}

class VideoMuxer extends EventEmitter {
    outputPathName: string;
    outputPathExt: string;
    outputPath: string;
    videoTracks: VideoTrack[] = [];
    audioTracks: AudioTrack[] = [];
    videoSequences: VideoSequence[] = [];
    audioSequences: AudioSequence[] = [];
    commandExecuter: CommandExecuter;
    constructor(outputPath) {
        super();
        if (!outputPath) {
            throw new Error("请指定输出路径");
        }
        const parsedPath = path.parse(outputPath);
        this.outputPathName = parsedPath.name;
        this.outputPathExt = parsedPath.ext;
        this.outputPath = outputPath;
        this.commandExecuter = new CommandExecuter();
    }
    addVideoTracks(...tracks: VideoTrack[]) {
        this.videoTracks.push(...tracks);
    }
    addAudioTracks(...tracks: AudioTrack[]) {
        this.audioTracks.push(...tracks);
    }
    addVideoSequences(...sequences: VideoSequence[]) {
        this.videoSequences.push(...sequences);
    }
    addAudioSequences(...sequences: AudioSequence[]) {
        this.audioSequences.push(...sequences);
    }
    async run() {
        const allTracks = [...this.videoTracks, ...this.audioTracks, ...this.videoSequences, ...this.audioSequences];
        let command = "ffmpeg ";
        // Add input
        for (const track of allTracks) {
            if (track.type === "video_sequence" || track.type === "audio_sequence") {
                command += `-f concat -safe 0 -i "${track.path}" `;
            } else {
                command += `-i "${track.path}" `;
            }
        }
        // Add map settings
        for (let i = 0; i <= allTracks.length - 1; i++) {
            const nowTrack = allTracks[i];
            if (nowTrack.type.startsWith("video")) {
                command += `-map ${i}:v `;
            }
            if (nowTrack.type.startsWith("audio")) {
                command += `-map ${i}:a `;
            }
        }
        if (fs.existsSync(`${this.outputPathName}${this.outputPathExt}`)) {
            this.outputPathName = this.outputPathName + `_${new Date().valueOf().toString()}`;
        }
        command += "-loglevel error -stats ";
        if (this.outputPath.endsWith(".mkv")) {
            command += `-c copy -reserve_index_space 200k "${this.outputPathName}${this.outputPathExt}"`;
        } else if (this.outputPath.endsWith(".mp4")) {
            command += `-c copy -movflags faststart "${this.outputPathName}${this.outputPathExt}"`;
        }
        this.commandExecuter.on("stderr", (data) => {
            logger.info(data);
            this.emit("stderr", data);
        });
        this.commandExecuter.on("fail", (child) => {
            this.emit("fail", child);
        });
        this.commandExecuter.on("success", () => {
            this.emit("success", `${this.outputPathName}${this.outputPathExt}`);
        });
        this.commandExecuter.on("start", (child) => {
            this.emit("start");
        });
        this.commandExecuter.run(command, {
            output: ["stderr"],
        });
    }
}

export { VideoTrack, AudioTrack, VideoSequence, AudioSequence, VideoMuxer };
