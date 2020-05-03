import execCommand from "./exec_command";

export async function isFFmpegAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
        execCommand("ffmpeg", true).then(() => {
            resolve(true);
        }).catch((_: never) => {
            resolve(false);
        });
    });
}