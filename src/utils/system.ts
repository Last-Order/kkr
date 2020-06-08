import execCommand from "./exec_command";

export async function isFFmpegAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
        execCommand("ffmpeg -version", true)
            .then(() => {
                resolve(true);
            })
            .catch((_: never) => {
                resolve(false);
            });
    });
}

export async function isFFprobeAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
        execCommand("ffprobe -version", true)
            .then(() => {
                resolve(true);
            })
            .catch((_: never) => {
                resolve(false);
            });
    });
}
