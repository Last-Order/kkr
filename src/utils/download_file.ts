import * as fs from "fs";
import axios from "axios";
export class BadResponseError extends Error {}
const download = async (url, dest, { timeout }): Promise<void> => {
    const CancelToken = axios.CancelToken;
    const source = CancelToken.source();
    let timer = setTimeout(() => {
        source.cancel();
    }, timeout || 60000);
    const response = await axios({
        url,
        method: "GET",
        responseType: "arraybuffer",
        cancelToken: source.token,
    });
    if (response.headers["content-length"] && +response.headers["content-length"] !== response.data.length) {
        throw new BadResponseError("下载内容不完整");
    }
    clearTimeout(timer);
    return fs.writeFileSync(dest, response.data);
};

export default download;
