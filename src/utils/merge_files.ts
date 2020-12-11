import * as fs from "fs";
export default function mergeFiles(fileList = [], output = "./output.ts") {
    const cliProgress = require("cli-progress");
    return new Promise<void>(async (resolve) => {
        if (fileList.length === 0) {
            resolve();
        }

        const writeStream = fs.createWriteStream(output);
        const lastIndex = fileList.length - 1;
        const bar = new cliProgress.SingleBar(
            {
                format: "[合并文件] [{bar}] {percentage}% | ETA: {eta}s | {value}/{total}",
            },
            cliProgress.Presets.shades_classic
        );
        bar.start(fileList.length, 0);
        let i = 0;
        let writable = true;
        write();
        function write() {
            writable = true;
            while (i <= lastIndex && writable) {
                writable = writeStream.write(fs.readFileSync(fileList[i]), () => {
                    if (i > lastIndex) {
                        bar.update(i);
                        bar.stop();
                        writeStream.end();
                        resolve();
                    }
                });
                bar.update(i);
                i++;
            }
            if (i <= lastIndex) {
                writeStream.once("drain", () => {
                    write();
                });
            }
        }
    });
}
