# 晚信

一款以单身年轻女性为核心用户的移动端 AI 角色陪伴产品。用户发现原创角色，与其自由聊天，把在意的片段保存为共同经历，并从卡片续聊。

- [交互原型](prototype/index.html)
- [详细产品与技术设计](docs/design.md)
- [三天实施计划](docs/superpowers/plans/2026-11-25-mvp.md)

在浏览器中打开原型即可体验。原型使用示例回复，收藏仅在当前页面会话内有效。

## D1 本地运行

使用 Node 22.13 或更新版本。执行 `npm install` 后，在两个终端分别运行
`APP_ACCESS_MODE=development MODEL_MODE=stub npm run api` 和 `npm run dev`，再打开 Vite 打印的本地地址。
`npm test` 运行 SQLite 聊天集成用例，`npm run build` 检查类型并构建前端。

测试模式会标记为「测试回复」。接入真实模型时，在服务端设置
`MODEL_API_URL`（完整 Chat Completions 地址）、`MODEL_API_KEY` 和 `MODEL_NAME`，
并移除 `MODEL_MODE=stub`。SQLite 默认写入 `data/wanxin.sqlite`，
可用 `SQLITE_PATH` 指定路径。

### 本机 Ollama 实测

```sh
# 真实调用（含本机 Ollama）现在必须先完成受控邀请配置，见下方准入说明。
MODEL_MODE=ollama MODEL_API_URL=http://127.0.0.1:11434/api/chat MODEL_NAME=qwen3.5:4b npm run api
```

本机 Ollama 可省略 `MODEL_API_KEY`。该模式关闭思考和流式输出，仅返回正文，首次加载模型时最多等待 200 秒。

## 匿名试用指标

[本地运行、七天窗口与指标口径](docs/analytics.md)说明只读聚合命令、分子分母、次日成熟条件、隐私与历史限制。

## 受控邀请与调用次数保护

[核定设计与本地操作说明](docs/access-control.md)说明一次兑换、失去Cookie后的补发、显式开发stub模式、额度/停止与单实例锁。生产或邀请配置缺失时拒绝开放；模型尝试次数并非实际费用。现有开发命令需显式增加 `APP_ACCESS_MODE=development` 且 `MODEL_MODE=stub`，命令面板和运行中服务不由此次代码修改自动替换或重启。

## 可复现候选构建

使用 `.nvmrc` 固定的 Node22.23.5。依赖锁及[临时副本构建、源码清单和校验说明](docs/build-candidate.md)用于隔离验证；工作树摘要标识未提交候选，HEAD仅作基点。

共同经历支持[内存搜索与上海月份分组](docs/card-library.md)，详情返回保留查询和列表位置。

线上部署环境：远端 101.42.26.83，分两处：•前端（nginx 实际服务路径）：/var/www/ant-epoch/wanxin/•后
端：/var/www/wanxin/server/（现 6 个 .mjs）nginx root 是 /var/www/ant-epoch
github地址：https://github.com/falongYang/wanxin
