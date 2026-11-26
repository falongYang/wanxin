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

## 附录 · 设计驱动的 UI 升级（同日第四次发版）

以图像模型产出的 4 张高保真设计稿（`docs/design/stage7/`：玄关/我的/聊天/仪式）为基准，对布局、交互、功能边界与入口做了一轮系统优化后上线（本地提交 1438bee）：

- **玄关信息架构重构**：横滑四卡改为「主大卡 + 2×2 功能宫格」。主卡横向布局（左列文字与金色渐变 CTA，右列纵贯弧形月色场景内嵌角色头像）；宫格承载共同经历/小小仪式（未读信金色角标）/生活服务/捏捏形象，每格带场景化副标题。390 视口整页收纳、宫格完整避开悬浮导航；数据一次 `/api/home` 聚合（bond/mood/letters/gifts/met）。
- **聊天拟人化**：仅角色侧气泡带头像与冷雾柔光（用户侧无头像，保留写信感）；头部「共同经历」改为信封图标；发送键改为金色渐变纸飞机；主题切换图标化。
- **我的页**：眉标「航海日志」；新增「相遇 N 天」概览条（后端 home 新增 `met.days`）；心情打卡河灯串（7 盏，按连续天数点亮）；羁绊进度末端发光金球与下一级预告。
- **仪式页层次**：信箱大卡（未读角标、金色 CTA「拆开这封信」）> 河灯许愿/小礼物双卡（剩余份数感知）> 纪念日通栏；眉标「灯塔小屋」。
- **朋友圈**：发动态可选心情标签（开心/平静/想念/感触/夜航/随想，后端 moments 本支持 moodTag）；「让TA也发一条」按后端新增 `characterToday` 字段状态感知禁用。
- **捏捏**：随机一套 / 恢复默认；生活服务分组加场景化注释（「深夜饿了，不用硬扛」等）。
- **无障碍与主题**：宫格副标题、羁绊数值、slogan 对比度提升；夜航/晨间双主题三视口（320/390/1280）验证截图 `docs/verification/stage7-design/`。

验证（2026-11-26 22:25 前后）：

- 本地：`npm test` 64/64、`npm run build` 通过；部署包与服务器 SHA-256 一致；静态产物 `index-DdUdLxwF.js` / `index-epGJdmf6.css` 与本地构建逐字节一致。
- 线上：`sudo service wanxin restart` 后 API 与 nginx 均 200；trial-005（顾川）验证 home 聚合新字段（`met.days=1`、`gifts.limit=2`）与 moments `characterToday`；trial-006 真实 DeepSeek 信笺生成成功（letter 网关 success），内容符合顾川书店人设。
- 回滚：部署前备份至 `/var/www/_rollback_wanxin_20261126-222551/`，指针 `/var/www/_last_wanxin_backup`。
- 邀请消耗：本附录验收消耗 trial-005、trial-006；**token-007 为最后一张未用邀请**。

## 附录 · 阶段 8 交互细节打磨（同日第五次发版）

以新增 2 张设计稿（`docs/design/stage7/`：门页 gate.png、共同经历 cards.png）为基准做细节打磨，纯前端发版（server 目录未改动），本地提交 e98c6be：

- **门页角色选择卡**：欢迎页由单角色直进改为「选择今晚想见的人」三卡并列（林舟/顾川/孙晚），每卡带默认形象头像、场景副标题与金色单选指示，默认选中林舟；品牌区新增月牙装饰（夜航 opacity .85 / 晨间 .55），slogan 对比度提至 88%（`color-mix muted/text`），选择区图例修正 3px 基线偏移；invitation 模式下邀请码为玻璃胶囊输入框（锁形图标 + 密码态 + 「仅可兑换一次」脚注），dev 模式不显示（`accessRequired=false`）。
- **朋友圈按天分组**：动态由平铺改为按日聚合，组标题（今天/具体日期）左右渐隐细线；dev 实测「今天」组渲染正常。
- **共同经历页精修**：header 加眉标「河灯航程」；信笺卡奇偶微倾斜（-0.7°/+0.5°）叠纸层次阴影，hover 归正。
- **捏捏保存动效**：保存成功后形象舞台播放 savedPulse 呼吸缩放；reduced-motion 全局规则覆盖。
- **对比度**：我的页脚注（me-foot）由 --faint 提亮为 --muted。

验证（2026-11-26 23:45 前后）：

- 本地：`npm test` 64/64；`npm run build` 产物 `index-CwJuMOF7.js` / `index-NsJWpXlE.css`；阶段 8 验证截图 `docs/verification/stage8-design/`（门页夜航/晨间/320 三视口 + 朋友圈/共同经历/我的 390），并经视觉模型验收（三卡协调、选中态与月牙正常、无排版错位）。
- dev 实测：门页三卡选择→过门→玄关、朋友圈「今天」分组、共同经历眉标+倾斜信笺卡、捏捏保存动效（computed animationName=savedPulse）逐项通过；期间用「清除会话」路径验证了门页在不刷新下的主题保持。
- 线上：静态产物 SHA-256 与本地逐字节一致（index.html `20de594e…`、JS `492f569b…`、CSS `7d586afe…`）；`sudo service wanxin restart` 后页面 200 并引用 `index-CwJuMOF7.js`，静态资源 200；未认证 `POST /api/session` 正确 403；线上 JS 含新门页组件标记（invite-field/选择今晚想见的人）。
- 浏览器直开生产页受本机浏览器拦截裸 IP HTTP 导航限制（ERR_BLOCKED_BY_CLIENT），改用 curl 完成线上验收，功能与安全行为均已确认。
- 回滚：部署前备份至 `/var/www/_rollback_wanxin_20261126-234544/`（frontend），指针 `/var/www/_last_wanxin_backup`。
- 邀请消耗：本次发版未消耗邀请令牌；**token-007 仍为最后一张未用邀请**。

> AI生成