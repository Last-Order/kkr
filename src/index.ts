#!/usr/bin/env node
import Erii from "erii";
import * as fs from "fs";
import * as path from "path";
import Downloader from "./core/downloader";
import LiveDownloader from "./core/live_downloader";

Erii.setMetaInfo({
    name: "KKR",
    version: JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json")).toString()).version,
});

Erii.bind(
    {
        name: ["download", "d"],
        description: "Download video",
        argument: {
            name: "url",
            description: "Video URL",
        },
    },
    async (ctx, options: any) => {
        if (options.live) {
            const videoUrl = ctx.getArgument().toString();
            const downloader = new LiveDownloader(videoUrl, options);
            downloader.start();
        } else {
            const videoUrl = ctx.getArgument().toString();
            const downloader = new Downloader(videoUrl, options);
            downloader.download();
        }
    }
);

Erii.addOption({
    name: ["live"],
    command: "download",
    description: "Download live",
});

Erii.addOption({
    name: ["keep", "k"],
    command: "download",
    description: "Keep temporary files",
});

Erii.addOption({
    name: ["threads"],
    command: "download",
    description: "Max download threads",
    argument: {
        name: "n",
        description: "Number of threads",
    },
});

Erii.addOption({
    name: ["concat-method"],
    command: "download",
    description: "Concat method",
});

Erii.addOption({
    name: ["force-merge"],
    command: "download",
    description: "Ignore missing chunks and merge all downloaded chunks to a single file (Live mode only)",
});

Erii.addOption({
    name: ["cooldown"],
    command: "download",
    argument: {
        name: "time",
        description: "Cooldown time in milliseconds",
    },
    description: "Add cooldown between chunk downloads (Live mode only)",
});

Erii.addOption({
    name: ["headers"],
    command: "download",
    description: "Custom HTTP headers",
    argument: {
        name: "headers",
        description: '(Optional) Custom HTTP headers. Multi headers should be splitted with "\\n"',
    },
});

Erii.addOption({
    name: ["verbose", "debug"],
    description: "Debug output",
});

Erii.bind(
    {
        name: ["help", "h"],
        description: "Show help documentation",
    },
    (ctx) => {
        ctx.showHelp();
    }
);

Erii.bind(
    {
        name: ["version"],
        description: "Show version",
    },
    (ctx) => {
        ctx.showVersion();
    }
);

Erii.default(() => {
    Erii.showHelp();
});

Erii.okite();
