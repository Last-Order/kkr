import execCommand from './exec_command';
const deleteDirectory = (path: string) => {
    if (process.platform === "win32") {
        return execCommand(`rd /s /q "${path}"`);
    } else {
        return execCommand(`rm -rf "${path}"`);
    }
}

export default deleteDirectory;