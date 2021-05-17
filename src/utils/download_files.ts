import { Downloader as ShuaDownloader } from "shua";
const download = (urls: string[], output: string, threads: number = 10, config?) => {
    return new Promise<void>((resolve) => {
        const downloader = new ShuaDownloader({
            threads,
            output,
            ascending: true,
            ...config,
        });
        downloader.loadUrlsFromArray(urls);
        downloader.start();
        downloader.once("finish", () => {
            resolve();
        });
    });
};

export default download;
