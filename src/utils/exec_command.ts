const exec = require('child_process').exec;
const execCommand = (command: string) => {
    return new Promise((resolve, reject) => {
        const child = exec(command);
        child.stdout.on('data', (data) => {
            console.log(data);
        });
        child.stderr.on('data', (data) => {
            console.log(data);
        });
        child.on('close', (code, signal) => {
            if (code === 0) {
                resolve();
            } else {
                console.error(code, signal);
                reject();
            }
        }); 
    })
}

export default execCommand;