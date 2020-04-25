import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
const download = async (url, dest, { timeout }): Promise<void> => {
    const CancelToken = axios.CancelToken;
    const source = CancelToken.source();
    setTimeout(() => {
        source.cancel();
    }, timeout || 60000);
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'arraybuffer',
        cancelToken: source.token,
    });
    return fs.writeFileSync(dest, response.data);
}

export default download;