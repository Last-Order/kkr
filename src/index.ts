#!/usr/bin/env node
import Erii from 'erii';
import * as fs from 'fs';
import * as path from 'path';
import Downloader from './core/downloader';
import LiveDownloader, { LiveDownloaderOptions } from './core/live_downloader';

Erii.setMetaInfo({
    name: 'KKR',
    version: JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json')).toString()).version
});

Erii.bind({
    name: ['download', 'd'],
    description: 'Download video',
    argument: {
        name: 'url',
        description: 'Video URL',
    }
}, async (ctx, options: any) => {
    if (options.live) {
        console.log(options);
        const videoUrl = ctx.getArgument().toString();
        const downloader = new LiveDownloader({
            videoUrl,
            ...options
        });
        downloader.start();
    } else {
        const videoUrl = ctx.getArgument().toString();
        const downloader = new Downloader({ videoUrl });
        downloader.download();
    }
});

Erii.addOption({
    name: ['live'],
    command: 'download',
    description: 'Download live'
});

Erii.addOption({
    name: ['verbose', 'debug'],
    description: 'Debug output'
});

Erii.default(() => {
    Erii.showHelp();
});

Erii.okite();