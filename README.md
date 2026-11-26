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

## 支持能力（本地已验证）

- **多角色**：发现页可选开场角色（林舟/顾川/孙晚），按所选角色创建线程并沿用其开场与开聊建议。
- **真实模型卡片预览**：`card-preview` 走受控 `reserve/settle` 网关（`operation='preview'`），失败降级到本地摘句，可编辑后保存。
- **语音输入**：聊天框「语音」按钮使用浏览器 Web Speech API 语音转文字（无外部付费 ASR）；不支持时提示手动输入。
- **羁绊体系**：发消息 +2（带卡 +3）、收藏 +5、打卡 +4、动态 +3、点赞 +1、评论 +2、读信 +2、许愿 +2（每天前 3 次）、礼物 +8（每天 2 份）；等级从「初识」到「灵魂共振」。
- **每日心情打卡**：八种心情 + 一句补充，角色经 letter 网关共情回应（失败降级模板），连续天数统计。
- **朋友圈**：用户与角色各自的动态、点赞、评论；角色每天最多发一条（moment 网关 + 模板降级）。
- **捏捏形象**：原创分层 SVG 捏人（肤色/发型/发色/眼睛/嘴巴/腮红/服装/服色/配饰），按线程保存覆盖配置，角色默认形象在客户端；头像展示于聊天头部、玄关弧顶、我的页与朋友圈。
- **生活服务**：11 个常用服务目录（外卖/购物/视频/小说/音乐/出行），首次点击授权确认，深链唤起 App、约 900ms 未离开自动回退网页版；只做匿名点击统计，不接入平台 API、不代操作账号。
- **仪式互动**：每日信箱（letter 网关 + 模板降级、读信 +2）、河灯许愿（角色祝福）、纪念日倒数（每年重复）、小礼物（每天两份、角色回应）。
- **聊天快捷入口**：输入涉及外卖/购物/看剧/小说/音乐/出行时，输入区出现提示条可直接打开对应服务或进入面板。

## 生产部署

[部署指南与模板](docs/deploy/production.md)含 nginx HTTPS、systemd、健康检查、环境变量、owner 清单。上线前运行 `node scripts/deploy/healthcheck.mjs` 应 0 项 FAIL；三闸门（PM 双视口+候选哈希、owner 真机、owner 群内点名）齐备前不开放入口。

**当前线上（2026-11-26 起受控试用，HTTP 临时通道）**：`http://101.42.26.83/wanxin/`，受控邀请 + DeepSeek（deepseek-chat）真实模型，[部署记录](docs/deploy/deployment-2026-11-26.md)。服务器端私密配置：`/etc/wanxin/env`（root 0600）、`/var/www/wanxin/private/invites.json`；服务 `wanxin.service`；重启命令 `sudo service wanxin restart`。上域名+TLS 后移除 `ACCESS_ALLOW_INSECURE_ORIGIN`。

线上部署环境：远端 101.42.26.83，分两处：•前端（nginx 实际服务路径）：/var/www/ant-epoch/wanxin/•后  
端：/var/www/wanxin/server/（现 6 个 .mjs）nginx root 是 /var/www/ant-epoch  
github地址：<https://github.com/falongYang/wanxin>

> AI生成
