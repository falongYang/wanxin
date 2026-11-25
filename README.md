# 晚信

一款以单身年轻女性为核心用户的移动端 AI 角色陪伴产品。用户发现原创角色，与其自由聊天，把在意的片段保存为共同经历，并从卡片续聊。

- [交互原型](prototype/index.html)
- [详细产品与技术设计](docs/design.md)
- [三天实施计划](docs/superpowers/plans/2026-11-25-mvp.md)

在浏览器中打开原型即可体验。原型使用示例回复，收藏仅在当前页面会话内有效。

## D1 本地运行

使用 Node 22.13 或更新版本。执行 `npm install` 后，在两个终端分别运行
`MODEL_MODE=stub npm run api` 和 `npm run dev`，再打开 Vite 打印的本地地址。
`npm test` 运行 SQLite 聊天集成用例，`npm run build` 检查类型并构建前端。

测试模式会标记为「测试回复」。接入真实模型时，在服务端设置
`MODEL_API_URL`（完整 Chat Completions 地址）、`MODEL_API_KEY` 和 `MODEL_NAME`，
并移除 `MODEL_MODE=stub`。SQLite 默认写入 `data/wanxin.sqlite`，
可用 `SQLITE_PATH` 指定路径。
