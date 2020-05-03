const exec = require('child_process').exec;
const execCommand = (command: string, slient: boolean = false) => {
    return new Promise((resolve, reject) => {
        let child = exec(command);
        child.stdout.on('data', (data) => {
            !slient && console.log(data);
        });
        child.stderr.on('data', (data) => {
            !slient && console.log(data);
        });
        child.on('close', (code, signal) => {
            if (code === 0) {
                resolve();
            } else {
                !slient && console.error(code, signal);
                reject();
            }
        }); 
    })
}

export default execCommand;