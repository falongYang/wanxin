# 部署记录 · 2026-11-26 受控试用上线（HTTP 临时通道）

> 本文记录一次实际部署的结果与证据。发版三闸门（PM 双视口+候选哈希、owner 真机、owner 群内点名）中，owner 已在会话中给出部署环境与凭据并要求部署，视为对本次部署的授权；正式 HTTPS 与阈值批准仍待补充（见文末）。

## 环境

| 项 | 值 |
| --- | --- |
| 服务器 | 远端 `101.42.26.83`（Ubuntu, Node v22.23.5, nginx 1.18.0） |
| 入口 | `http://101.42.26.83/wanxin/`（HTTP **临时通道**，无域名/TLS） |
| API | systemd `wanxin.service` → `node /var/www/wanxin/server/index.mjs`（仅监听 127.0.0.1:3001） |
| 反代 | nginx `/api/` 与 `/wanxin/api/` → 127.0.0.1:3001；`/wanxin/` SPA 回退 |
| 模型 | DeepSeek `deepseek-chat`（OpenAI 兼容，`MODEL_MODE` 未设即走通用分支），超时 60s |
| 存储 | `/var/www/wanxin/data/wanxin.sqlite`（保留旧数据，仅增量建表；旧访客需邀请码重新准入） |
| 私密配置 | `/etc/wanxin/env`（root 0600）；`/var/www/wanxin/private/invites.json`（0600） |

## 本轮新增的代码能力（48/48 测试、构建通过后部署）

- `ACCESS_ALLOW_INSECURE_ORIGIN=true`：显式授权的临时开关，允许 http:// PUBLIC_ORIGIN（`server/access.mjs`）；上域名+TLS 后必须移除。健康检查对 HTTP Origin 给 WARN，与 `NODE_ENV=production` 组合（Secure Cookie 失效）给 FAIL。
- 角色人设注入：`server/characters.js` 为林舟/顾川/孙晚维护 system 提示，`generate()` 按线程 `characterId` 注入（`server/app.mjs`、`server/model.mjs`）。
- 真实模型卡片预览：`POST /api/card-preview` 走 `reserve/settle` 网关（operation=preview，计 1 次），失败降级本地摘句；来源无效 404 不扣额度。
- 模型超时可配 `MODEL_TIMEOUT_MS`；vite `base:'./'` 支持子路径部署。
- 语音输入（Web Speech API）、多角色发现/选择（上一轮已实现，随本次一并上线）。

## 本次设定的额度默认值（owner 未给阈值，按授权拟定，改 `/etc/wanxin/env` 后 `sudo service wanxin restart` 生效）

| 键 | 值 | 含义 |
| --- | --- | --- |
| subjectDaily | 40 | 每邀请主体每日模型调用 |
| globalDaily | 400 | 全局每日 |
| subjectMinute / globalMinute | 5 / 30 | 分钟速率 |
| inFlight | 2 | 并发在途 |
| redeemSource / redeemGlobal | 5 / 60 | 10 分钟兑换窗（失败也计数） |
| endpointMinute | 90 | 主体业务请求频率 |
| timeZone | Asia/Shanghai | 日桶时区 |

## 证据（部署当日）

- 本地：`npm test` 48/48 通过、`npm run build` 通过、`scripts/deploy/healthcheck.mjs` 对生产 env 0 FAIL（两条预期 WARN）。
- 服务器：启动前 healthcheck 0 FAIL；`wanxin.service` 3001 监听；nginx `GET /api/session` 200 返回 `accessRequired:true` + 3 角色。
- 端到端（真实 DeepSeek）：
  - trial-001 浏览器兑换 → 顾川开场 → 发送 → 人设化真实回复「把手里的那本合上…」「那盏灯大概是整条街最后一点亮。你进来时外面冷不冷？」
  - trial-002 脚本兑换（孙晚）→ 真实回复「嗯，风这么大。我在边上，你站一会儿就好。」
  - 卡片预览（真实模型摘要）：标题「加班后在天台吹风」/ 正文「今晚天台风很大，加班刚结束。想在天台安静待一会儿。」；收藏与列表成功。
  - 额度账本：message 4 success、preview 2 success；404 场景未扣额度；主体/全局分账正确（trial-001:3、trial-002:3、global:6）。
  - 安全回归：GET /api/session 无 Cookie 200；空/错令牌 POST 403；跨访客/错误 Origin 拒绝（见受控测试套件与日志）。
- 回滚：部署前完整备份至 `/var/www/_rollback_wanxin_<ts>/`（含旧代码、旧前端、数据快照、旧 unit），指针见 `/var/www/_last_wanxin_backup`。

## 已知限制与待办

1. **HTTP 明文**：邀请令牌与聊天内容明文传输（owner 已知晓并选择临时使用）；上域名+TLS 后移除 `ACCESS_ALLOW_INSECURE_ORIGIN` 并恢复 https 校验。
2. **Cookie 非 Secure**：HTTP 下刻意不设 `NODE_ENV=production`；TLS 后应恢复。
3. **额度阈值为拟定值**：待 owner 批准正式值（供应商侧硬上限与告警责任人待定）。
4. 发版三闸门的正式化记录（候选哈希登记、owner 真机清单、群内点名）待 HTTPS 转正时补齐。
5. 凭据经聊天传递（SSH 密码、模型 key）：建议轮换；服务器已添加本机公钥（`~ubuntu/.ssh/authorized_keys`），不需要时请删除。
6. 运行中曾观察到另一会话共用测试浏览器，其消耗计入 trial-001 主体额度（账本已如实记录）。

> AI生成

## 附录 · 夜航视觉改版上线（同日第二次发版）

参考 Lifeboat 公开展示页设计语言（仅借鉴设计原则：低饱和夜色、宋体标题、渐隐细线、玻璃胶囊、金色发光、纸品信笺、异形圆角；未复制任何品牌素材或整站代码），重写 `src/ui/style.css`：

- 夜航主题：`168deg` 三段夜空渐变（#060a14→#0e1526→#131c33）、玄关星野、拱门月色场景；晨间主题改为暖纸色调。
- 字体分工：宋体（标题/信笺正文）+ 系统黑体（控件）+ Didot italic（英文小字）。
- 聊天：玻璃头部 + 渐隐细线；角色气泡冷蓝 / 用户气泡暖酒红，19px 圆角对角收 6px；输入区为玻璃胶囊（blur+内置高光），发送键金色渐变；消息错峰入场动效。
- 共同经历：月份标题两侧渐隐线、河灯呼吸发光、信笺纸卡（右上大圆角 + 内衬虚线框）、信笺正文首字下沉。
- 无障碍与既约保持：44px 触控、焦点金环、320px 无横向溢出、`prefers-reduced-motion` 全关动效。

验证：本地 48/48 测试、构建通过；320/390/1280 三视口截屏（`docs/verification/night-voyage-style/`，含晨间主题与生产门页）；生产静态产物 SHA-256 与本地构建逐字节一致（index-CuDBqt2R.css / index-B_WPO5pa.js），API 未变更未重启。后端零改动，仅前端静态资源发版。

> AI生成

## 附录 · 陪伴功能六阶段上线（同日第三次发版）

六阶段功能随本附录一次性上线（对应本地提交 079d274 → 81101ca）：羁绊与心情（阶段1）、朋友圈（阶段2）、捏捏形象（阶段3）、生活服务（阶段4）、仪式互动（阶段5）、玄关卡片压缩打磨（阶段6）。

- **后端**：`server/features.mjs` 新增 bond/mood/home/moments/avatar/services/letters/wishes/anniversaries/gifts 路由（线程级隔离、级联删除）；新表 bond、mood_log、moments、moment_likes、moment_comments、avatar_config、letters、anniversaries、wishes、gift_log（仅增量建表，旧数据不动）。
- **额度网关**：操作白名单扩展为 message/preview/moment/letter；信笺与角色动态走 reserve/settle，失败降级零成本模板。
- **事件白名单**：`trial_events` CHECK 白名单扩至 17 个事件（新增 mood_checkin/moment_*/avatar_save/service_click/letter_open/wish_make/anniversary_save/gift_send），应用初始化对旧库自动事务迁移，原事件保留；此前 mood/moment 等事件被旧白名单静默丢弃的问题随迁移修复。
- **前端**：新增 `src/ui/avatar.tsx`（原创分层 SVG 捏人）、`src/ui/services.tsx`（深链+网页回退+首点授权）、`src/ui/rituals.tsx`（信箱/河灯/纪念日/礼物）；玄关四张横滑卡片；聊天关键词快捷入口。
- **安全边界**：生活服务只做深链 scheme + 网页回退与匿名点击统计，不接入平台 API、不代操作账号（真实对接需商务合作）；features 未匹配路由由 500 改 404；朋友圈点赞/角色发动态的 GET/POST 方法错误已修复。
- **打磨**：玄关第一卡从 808px 压至 ~615px（头像叠入弧顶、开场白折叠 3 行），390 视口下主 CTA 完整避开悬浮 tabbar；tabbar 稍贴底。三视口双主题 12 张截图见 `docs/verification/companionship-stage/`。

验证（2026-11-26 20:00 前后）：

- 本地：`npm test` 64/64、`npm run build` 通过；部署包 SHA-256 本地与服务器一致。
- 服务器：healthcheck 除实例锁（运行中持锁的预期 FAIL）外全部 OK（HTTP 临时通道 WARN 依旧）；`sudo service wanxin restart` 后 3001/nginx 均 200；静态产物 `index-Bmy_8fE0.js` / `index-CnHCFS0t.css` 与本地构建逐字节一致。
- 端到端（trial-004 真实 DeepSeek）：信笺生成走 letter 网关 success（孙晚人设天台夜航口吻）；读信 +2、礼物 +8、羁绊 10/100；`trial_events` 新增 letter_open、gift_send（旧库白名单迁移生效）；`gift_log` 落账；未认证服务点击 403。
- 回滚：部署前备份至 `/var/www/_rollback_wanxin_20261126-195839/`（旧后端、旧前端、数据快照、package.json），指针 `/var/www/_last_wanxin_backup`。
- 邀请消耗：token-003 已于本日早间被兑换（非本附录消耗）；本附录验收消耗 token-004。token-005~007 仍未用。

> AI生成
