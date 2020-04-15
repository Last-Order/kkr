import { Downloader as ShuaDownloader } from 'shua';
const download = (urls: string[], output: string, config?) => {
    return new Promise((resolve, reject) => {
        const downloader = new ShuaDownloader({
            threads: 16,
            output,
            ascending: true,
            ...config
        });
        downloader.loadUrlsFromArray(urls);
        downloader.start();
        downloader.once('finish', () => {
            resolve();
        });
    });
}

export default download;