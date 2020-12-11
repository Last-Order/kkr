import { EventEmitter } from "events";

const exec = require("child_process").exec;
/**
 * 命令执行
 * @param {string} command
 */
export default class CommandExecuter extends EventEmitter {
    run(command, { output = ["stdout", "stderr"] } = {}) {
        const child = exec(command, {
            encoding: "binary",
            maxBuffer: 4000 * 1024,
        });
        this.emit("start", child);
        if (output.includes("stdout")) {
            child.stdout.on("data", (data) => {
                // eslint-disable-next-line no-control-regex
                this.emit("stdout", data.replace(/\x08/gi, ""));
            });
        }
        if (output.includes("stderr")) {
            child.stderr.on("data", (data) => {
                // eslint-disable-next-line no-control-regex
                this.emit("stderr", data.replace(/\x08/gi, ""));
            });
        }
        child.on("close", (code) => {
            if (code === 0) {
                this.emit("success");
            } else {
                this.emit("fail", child);
            }
            child.unref();
        });
    }
}
