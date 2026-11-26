# 晚信生产部署指南

> 目标：把已完成本地验收（40 项测试 + 构建 + 三视口）的版本部署为**受控邀请 + HTTPS** 的可试用环境。
> 前提：`PUBLIC_ORIGIN` 必须是完整 HTTPS Origin；`443` 必须可用（当前远端 `101.42.26.83` 的 443 未开放，需先配域名/证书/反代）。未满足前不得开放入口。

## 1. 拓扑

```
Internet --443--> nginx(HTTPS) --反代 /api--> Node API(127.0.0.1:3001, secure cookie)
                        |
                        --静态--> /var/www/ant-epoch/wanxin/ (前端 dist)
SQLite 持久卷: 服务账号可写的受限绝对路径（受控模式要求非 :memory:）
单实例: acquireInstanceLock 强制单进程；异常退出后需人工确认旧进程终止才接管
```

## 2. 服务器目录（按 README 现状）

- 前端静态：`/var/www/ant-epoch/wanxin/`（Vite `dist/` 产物）；nginx `root /var/www/ant-epoch`。
- 后端：`/var/www/wanxin/server/`（当前 6 个 `.mjs`，接入本项目 `server/` 与 `scripts/`）。
- 远端：`101.42.26.83`，GitHub 镜像 `github.com/falongYang/wanxin`。

## 3. 环境变量（生产，全部必填；示例值不是批准值）

| 变量 | 要求 | 说明 |
| --- | --- | --- |
| `APP_ACCESS_MODE` | `invitation` | 生产必须受控；不得用 development |
| `NODE_ENV` | `production` | 启用 Secure Cookie；development+production 拒绝启动 |
| `MODEL_MODE` | 非 `stub`（`ollama` 或真实 API） | 生产真实回复 |
| `MODEL_API_URL` | 完整 Chat Completions 地址 | ollama 用 `http://127.0.0.1:11434/api/chat` |
| `MODEL_API_KEY` | 真实密钥（ollama 可省略） | 仅服务端环境变量，不入前端/仓库/日志 |
| `MODEL_NAME` | 模型名 | 如 `qwen3.5:4b` |
| `PUBLIC_ORIGIN` | `https://<你的域名>` | 单一完整 HTTPS Origin，无路径/查询/斜杠 |
| `SQLITE_PATH` | 受限绝对路径 | 持久目录内，服务用户可写；缺失拒绝启动 |
| `ACCESS_INVITES_FILE` | 私密清单绝对路径 | 只存 SHA-256 摘要，不存原始令牌 |
| `ACCESS_HMAC_SECRET` | ≥32 字符随机秘密 | 安全渠道注入，不进前端/仓库/日志 |
| `ACCESS_PROXY_MODE` | `none` 或 `single-proxy` | 必须显式选择；single-proxy 需额外 `ACCESS_PROXY_ADDRESS` |
| `ACCESS_LIMITS` | JSON，键全显式 | `subjectDaily/globalDaily/subjectMinute/globalMinute/inFlight/redeemSource/redeemGlobal/endpointMinute/timeZone`，次数正整数 |

> 健康检查：部署前运行 `node scripts/deploy/healthcheck.mjs`（在配置了生产 env 的目录下），应为 0 项 FAIL。

## 4. systemd 服务单元（`docs/deploy/wanxin.service.example`）

单实例托管 API，`Restart=on-failure`，数据目录与服务账号由 owner 指定。**升级/重启前先确认旧进程已终止**，不依赖自动删陈旧锁。

## 5. nginx 反代（`docs/deploy/nginx.conf.example`）

- `server` 监听 443，`ssl_certificate` 指向合法证书（Let's Encrypt 或既有 CA）。
- `location /api/` → `proxy_pass http://127.0.0.1:3001`，携带 `Host`，不自行注入 `X-Real-IP`（除非启用已批准的 `single-proxy` 且 owner 确认唯一反代）。
- 静态文件：`root /var/www/ant-epoch`，对 `/wanxin/` 走 SPA 回退到 `index.html`。
- 用 `PUBLIC_ORIGIN` 与浏览器 `Origin` 一致校验（应用侧已强制）。
- **未批准前**不设置不可信 `X-Forwarded-For`，默认取 socket 地址做限流。

## 6. 邀请清单（离线，`scripts/access-control.mjs`）

```sh
# 在私密受限目录生成：原始令牌写 invite-secret.txt(0600)，摘要写 invite.json
node scripts/access-control.mjs generate /绝对/私密/new-issue trial-001 1 token-001 2026-11-26T00:00:00Z 2026-12-01T00:00:00Z
# 把 invite.json 摘要条目合并进 ACCESS_INVITES_FILE（临时文件 + 原子重命名），
# 原始令牌通过批准的安全渠道发给受邀者。一枚令牌仅兑换一次；清 Cookie 需同主体补发。
```

## 6. 上线顺序与闸门

1. owner 提供域名/证书 → 开 443 → 配置 nginx HTTPS + systemd。
2. owner 提供生产阈值、HMAC secret、模型密钥（安全渠道）。
3. 生成受控邀请清单，显式 `callsEnabled` 前保持默认停止（`runtime_control.callsEnabled=0`）。
4. 跑 `npm test`、`npm run build`、健康检查，真机（含软键盘/安全区）完整走流程。
5. **三闸门齐备才发版**：PM 双视口+候选哈希；owner 真机同版本；owner 群内点名同一具体版本。GitHub 推送 ≠ 生产部署批准。

## 7. 已就绪 / 仍缺

- 已就绪：全部代码（40 测试、构建通过）、受控准入/额度/脱敏日志、多角色、模型预览、语音、健康检查脚本、本部署模板。
- 仍缺（需 owner 提供）：SSH 登录身份（当前本机密钥 root 被拒，agent 无身份）、HTTPS 域名与证书（443 未开）、真实模型密钥与生产阈值、持久卷路径与备份 RPO/RTO 责任人。

> AI生成
