#!/usr/bin/env node
import Erii from 'erii';
import * as fs from 'fs';
import * as path from 'path';
import Downloader from './core/downloader';

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
}, async (ctx, options) => {
    const videoUrl = ctx.getArgument().toString();
    const downloader = new Downloader({ videoUrl });
    downloader.download();
});

Erii.default(() => {
    Erii.showHelp();
});

Erii.okite();