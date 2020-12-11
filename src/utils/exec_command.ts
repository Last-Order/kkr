const exec = require("child_process").exec;
const execCommand = (command: string, silent: boolean = false) => {
    return new Promise<void>((resolve, reject) => {
        let child = exec(command);
        child.stdout.on("data", (data) => {
            !silent && console.log(data);
        });
        child.stderr.on("data", (data) => {
            !silent && console.log(data);
        });
        child.on("close", (code, signal) => {
            if (code === 0) {
                resolve();
            } else {
                !silent && console.error(code, signal);
                reject();
            }
        });
    });
};

export default execCommand;
