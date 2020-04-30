const fs = require('fs');
const path = require('path');
import CommandExecuter from './command_executer';
import { EventEmitter } from 'events';
import logger from '../core/services/logger';

class VideoTrack {
    type = 'video';
    path: string;
    constructor({ path }) {
        this.path = path;
    }
}

class AudioTrack {
    type = 'audio';
    path: string;
    constructor({ path }) {
        this.path = path;
    }
}

class VideoMuxer extends EventEmitter {
    outputPathName: string;
    outputPathExt: string;
    outputPath: string;
    videoTracks: VideoTrack[];
    audioTracks: AudioTrack[];
    commandExecuter: CommandExecuter;
    constructor(outputPath) {
        super();
        if (!outputPath) {
            throw new Error('请指定输出路径');
        }
        const parsedPath = path.parse(outputPath);
        this.outputPathName = parsedPath.name;
        this.outputPathExt = parsedPath.ext;
        this.outputPath = outputPath;
        this.videoTracks = [];
        this.audioTracks = [];
        this.commandExecuter = new CommandExecuter();
    }
    addVideoTracks(...tracks) {
        this.videoTracks.push(...tracks);
    }
    addAudioTracks(...tracks) {
        this.audioTracks.push(...tracks);
    }
    async run() {
        const allTracks = [...this.videoTracks, ...this.audioTracks];
        let command = 'ffmpeg ';
        // Add input
        for (const track of allTracks) {
            command += `-i "${track.path}" `;
        }
        // Add map settings
        for (let i = 0; i <= allTracks.length - 1; i++) {
            const nowTrack = allTracks[i];
            if (nowTrack.type === 'video') {
                command += `-map ${i}:v `;
            }
            if (nowTrack.type === 'audio') {
                command += `-map ${i}:a `;
            }
        }
        if (fs.existsSync(`${this.outputPathName}${this.outputPathExt}`)) {
            this.outputPathName = this.outputPathName + `_${new Date().valueOf().toString()}`;
        }
        if (this.outputPath.endsWith('.mkv')) {
            command += `-c copy -reserve_index_space 200k "${this.outputPathName}${this.outputPathExt}"`;
        } else if (this.outputPath.endsWith('.mp4')) {
            command += `-c copy -movflags faststart "${this.outputPathName}${this.outputPathExt}"`;
        }
        this.commandExecuter.on('stderr', (data) => {
            logger.info(data);
            this.emit('stderr', data);
        });
        this.commandExecuter.on('fail', (child) => {
            this.emit('fail', child);
        });
        this.commandExecuter.on('success', () => {
            this.emit('success');
        });
        this.commandExecuter.on('start', (child) => {
            this.emit('start', child);
        });
        this.commandExecuter.run(command, {
            output: ['stderr']
        });
    }
}

export {
    VideoTrack,
    AudioTrack,
    VideoMuxer
}