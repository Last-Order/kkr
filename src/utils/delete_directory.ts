import execCommand from "./exec_command";
const deleteDirectory = async (path: string) => {
    if (process.platform === "win32") {
        return await execCommand(`rd /s /q "${path}"`);
    } else {
        return await execCommand(`rm -rf "${path}"`);
    }
};

export default deleteDirectory;
