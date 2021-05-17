import execCommand from "./exec_command";
import * as fs from "fs";

export enum ConcatMethod {
    "UNKNOWN",
    "DIRECT_CONCAT",
    "FFMPEG_CONCAT",
}

const analyseConcatMethod = (file1: string, file2: string): Promise<ConcatMethod> => {
    return new Promise(async (resolve) => {
        let isTimeout = false;
        setTimeout(() => {
            if (!isTimeout) {
                isTimeout = true;
                resolve(ConcatMethod.UNKNOWN);
            }
        }, 25000);
        // Call FFprobe
        const command = `ffprobe -i "${file2}" -hide_banner -show_packets -print_format json>${file2}.packets`;
        try {
            await execCommand(command, true);
            const output = JSON.parse(fs.readFileSync(`${file2}.packets`).toString());
            if (output.packets[0].pts === 0) {
                resolve(ConcatMethod.FFMPEG_CONCAT);
            } else {
                resolve(ConcatMethod.DIRECT_CONCAT);
            }
        } catch (e) {
            resolve(ConcatMethod.UNKNOWN);
        }
    });
};

export default analyseConcatMethod;
