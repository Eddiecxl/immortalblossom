# 配乐制作源码

`audio-render.mjs` 使用 Microsoft Edge 的 OfflineAudioContext 渲染六首原创立体声配乐。需要 Node.js 22、Playwright 和本机 Edge；在此目录安装 `playwright` 后执行 `node audio-render.mjs`。它会覆盖本发行包 `game/assets/audio` 中的六个 WAV 文件，并在本目录写入测量报告。修改音频后须重新生成游戏 manifest 与修复包才能发行。

`audio-notes.md` 记录测试说明与编曲方法。正常游玩不需要 Node.js 或上述制作工具。
