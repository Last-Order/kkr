# README

Yet another YouTube DVR downloader!

## 依赖

本工具需要 ffmpeg、ffprobe 才能运行。

缺少 ffmpeg 将不会自动合并，缺少 ffprobe 将无法准确确定视频合并方式。

KKR 需要 Node 11+。

## 安装

`npm i -g kkr`

## 支持范围

-   直播视频

对于直播视频，使用 `--live` 选项可以实时录制。

-   带有实时回放的直播视频

对于带有实时回放的直播视频，使用 `--live` 选项可以下载可回放内容并继续跟进录制，不使用 `--live` 选项可以下载可回放内容。

-   刚刚结束的直播/首播视频

## 主要特性

-   使用 DASH 播放列表进行下载
-   下载与播放列表下载互不干扰
-   并发高速下载
-   对于每一分块进行默认 10 次的重试
-   最终结束录制时如获得的视频流不连续可自动输出多个输出文件
-   开播监视
-   自动刷新播放列表地址以规避六小时链接失效问题

## 用法

`kkr -d "https://www.youtube.com/watch?v=BTTq175DJOY" --live`

```
KKR / 1.2.2

Help:
     Commands                      Description                   Alias

     --download <url>              Download video                -d
         <url>                     Video URL
         --live                    Download live
         --keep, k                 Keep temporary files
         --threads <n>             Max download threads
             <n>                   Number of threads
         --concat-method           Concat method
         --force-merge             Ignore missing chunks and merge all downloaded chunks to a single file (Live mode only)
         --cooldown <time>         Add cooldown between chunk downloads (Live mode only)
             <time>                Cooldown time in milliseconds
     --help                        Show help documentation       -h
     --version                     Show version

Options:

     Options                       Description
     --verbose, debug              Debug output
```

### 手动指定合并方法

可以通过`--concat-method`强制指定合并方法，该选项的可选值为`1`或`2`，其中`1`表示二进制连接分块，`2`表示使用`ffmpeg`的`concat`模式连接各分块。