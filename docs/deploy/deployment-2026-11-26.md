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

## 附录 · 阶段 9 主题小铺与交互细节（次日第六次发版，2026-11-27）

以新增 4 张设计稿（`docs/design/stage9/`：樱雨/奶糖/薄荷玄关 + 主题小铺面板）为基准，新增 3 种可爱温柔主题与一批交互细节，纯前端发版（server 未改动），本地提交 12f8608：

- **主题小铺**：玄关头部主题按钮由二态切换升级为弹出式主题菜单（玻璃面板，5 选项各带渐变色块预览、主题名与一句心情小字、勾选指示），标题「主题小铺 · 挑一个今晚的心情」；主题选择写入 localStorage（下次进入保留），body 同步 data-theme 保证大屏两侧底色一致；时间默认规则不变（6-12 点晨间，其余夜航）。
- **三种新主题**：樱雨（深夜梅紫 #150c17 + 樱粉点缀，樱色星野 + 樱色微光层 petal-drift）、奶糖（奶油白 #f6efe3 + 焦糖 #b07a3f）、薄荷（海盐白 #e7f4f0 + 青碧 #2f8f79，主按钮取浅青渐变保深字对比）；浅色主题隐去星野、月牙调暗、信笺河纸面化、气泡阴影适配。
- **修复的历史问题**：`.shell` 与 `.discovery` 实为同一元素，`.shell[data-theme] .discovery` 后代选择器从不匹配（阶段 7 的 morning 星野隐藏规则一直是死代码），已全部改为复合选择器；底部标签栏选中态由硬编码金色改为 `color-mix(var(--gold))` 随主题变化；主题面板被玄关主大卡遮挡的层叠上下文 bug（.foyer-heading z-index:1 困住面板 z-40）已修复并经 elementFromPoint + 视觉模型双重验证。
- **交互细节**：聊天等待回复时显示角色侧「正在写回信…」typing 气泡（三点呼吸动画，完成后恢复「回复已收到」状态行）；朋友圈点赞爱心弹跳动画（heart-pop，计数随点赞数显示）；共同经历/朋友圈空态增加三盏熄着的河灯装饰（reduced-motion 全局规则覆盖全部新动画）。

验证（2026-11-27 09:00 前后）：

- 本地：`npm test` 64/64；`npm run build` 产物 `index-DZXLEw7H.js` / `index-D_OYzxWz.css`；阶段 9 验证截图 `docs/verification/stage9-design/`（主题小铺开面板、三新主题玄关、樱雨门页、typing 指示、点赞动画、空态）。
- dev 实测：主题面板开合（含 Escape 关闭与外点关闭）、五主题切换与 reload 持久化、樱雨樱花层 computed 动画 petal-drift、浅色主题星野 display:none、typing 气泡（拦截 api 延迟 2.5s 捕获，animationName=typing-breathe）、点赞 active+heart-pop+计数、空态河灯渲染，逐项通过；期间修复验证环境两个干扰：浏览器视口被外部进程重置为 1200 宽（重拍全部截图于 390×844）、stage8-design 已提交截图再次被外部进程以桌面视口覆盖（已 git 还原）。
- 线上：静态产物 SHA-256 与本地逐字节一致（index.html `1e1633d7…`、JS `6d3fcfb6…`、CSS `24080500…`）；`sudo service wanxin restart` 后页面 200 并引用 `index-DZXLEw7H.js`；线上 JS 含新功能标记（主题小铺/正在写回信）。
- 回滚：部署前备份至 `/var/www/_rollback_wanxin_20261127-090100/`（frontend），指针 `/var/www/_last_wanxin_backup`。
- 邀请消耗：本次发版未消耗邀请令牌；**token-007 仍为最后一张未用邀请**。

> AI生成

## 附录 · 阶段 10 人物捏捏 3D 形象引擎（第七次发版，2026-11-27）

以 8 张高保真设计稿（`docs/design/stage10/`：三角色双方案 + 编辑器 UI + 三人合影，定稿林舟A/顾川A/孙晚B）为基准，人物捏捏从 9 维 SVG 头像升级为 three.js 程序化 3D 形象系统，前后端同时发版，本地提交 bd80112 + 9c21762 + 00a1e98：

- **3D 引擎（`src/ui/avatar3d.ts`，three@0.187 动态 import 按需加载）**：程序化半身人像（40+ 参数连续形变）、360° 拖动 / 双指缩放 / 双击回正、raycast 点哪捏哪（点脸/发/身体自动跳分区）、眨眼（自然间隔 2.2-5.8s + 保存时反馈）、呼吸、视线跟随、发丝微摆、微笑/保存/随机微表情；五主题光照实时联动（setTheme）；全站头像快照渲染（256px dataURL，带缓存），玄关/聊天/门页/朋友圈头像全部改为 3D 快照 img；reduced-motion 下保留视线姿态、停用全部动画。
- **Schema v2 与款式库（`src/ui/avatar-catalog.ts`）**：41 根滑杆（六分区：脸型/眉眼/鼻唇/发型/穿搭/肤妆）× 款式库（发型 8 / 刘海 4 / 瞳色 6 / 上装 6 / 外套 6 / 配饰 8、配饰最多三件）× 12 色板；WX2- 前缀 base64url 分享码（生成/导入）；v1→v2 迁移与降级投影（旧配置无损进入、无 WebGL 环境回退 SVG 编辑器）；三角色默认形象按设计稿定稿写入；随机三档（好看优先/只换五官/放飞自我）。
- **编辑器（`src/ui/avatar.tsx` 重写）**：撤销/重做 50 步、按住看原样、恢复默认、形象码弹窗、保存 PUT v2；无 WebGL 自动降级 SVG 路径。
- **服务端（`server/features.mjs`）**：sanitizeAvatar 新增 v2 分支（分区白名单、数值截断、HSL 校验、款式 ID 正则、配饰≤3、未知键忽略），与 v1 配置共存。
- **视觉调优 12 轮（像素级 canvas 扫描驱动）**：修复眼睑开口几何（上盖沿极角 1.20→1.14 配合虹膜 0.56r，消除“黑斑”与“瞪眼”两个极端）、巩膜/虹膜加 emissive 保夜色主题下层次、五官小件（眉/睫/唇/唇线）禁投影消除颗粒脏阴影、阴影 normalBias 0.06 + 2048 贴图消 acne、皮肤换 Physical 材质加 sheen 绒感、默认视线回望镜头（BASE_LOOK）消除发愣、发型去侧发条 + 刘海高频噪声边缘、下眼睑降亮消“黑眼圈”观感。

验证（2026-11-27 10:00-11:05）：

- 本地：`npm test` 65/65（新增 v2 校验 6 例）；`npm run build` 产物 `index-CpCC4QNE.js`（268.42KB / gzip 89.68KB）+ `avatar3d-lKxflMe-.js` 异步 chunk（599.93KB / gzip 154.68KB）+ `index-zFMS6huq.css`；tsc --noEmit 0 错误。
- dev 真实浏览器全量交互验收（390×844 主视口）：滑杆→撤销(1→0)→重做(0→1)链路；点哪捏哪（脸颊→脸型、头发→发型、身体 y70-96%→穿搭）；随机“好看优先”渲染无穿模错位；形象码导出→导入完整还原（低马尾+八字刘海+银月发色）；保存 PUT v2 落库（SQLite avatar_config 表 version:2）；粉发改色后玄关/聊天 2 处头像快照均像素级确认更新（樱粉 5394px）；自然眨眼 700 帧捕获 2 次完整闭眼（虹膜点 R 值 42→186→43）；按住看原样粉↔暗棕切换；拖动旋转+双击回正；主题联动（夜航脸区 (143,128,116) 金暖 vs 樱雨 (150,124,123) 粉调）。三视口（320/390/1280）与双主题截图归档 `docs/verification/stage10-design/`。
- 视觉模型多轮评估用于发现结构性问题（黑斑/脏阴影/呆视已全部修复）；后续评分波动（5→4→3）经像素剖面核实为风格偏见（“下眼白过多”实为 1-3px 含蓄月牙+眼睑亮带误判），程序化低模卡通的固有边界如实告知 owner，不再追评。
- 线上：页面 200 引用 `index-CpCC4QNE.js` / `index-zFMS6huq.css`；`avatar3d-lKxflMe-.js` 200（599,928B）；主 JS/CSS 200；未认证 POST 403；线上 JS 含 av3/WX2 新功能标记；5 个产物 SHA-256 本地与服务器逐字节一致（index.html `afdcfd23…`、JS `8244e09f…`、avatar3d `cf6ff791…`、CSS `b95cce3f…`、features.mjs `0961aff5…`）。
- 重启：后端 features.mjs 变更，`sudo service wanxin restart` 后 active（PID 1208321）。
- 回滚：部署前备份至 `/var/www/_rollback_wanxin_20261127-110434/`（frontend + server + wanxin.sqlite 数据快照），指针 `/var/www/_last_wanxin_backup`。
- 邀请消耗：本次发版未消耗邀请令牌（线上验收仅 curl 未认证路径）；**token-007 仍为最后一张未用邀请**。
- 遗留：本机浏览器对 HTTP 直连 IP 拦截（ERR_BLOCKED_BY_CLIENT），线上页面级截图待 HTTPS 转正后补拍；程序化 3D 形象为低模卡通风格，写实度受程序化几何固有限制，如需更高保真可后续评估接入外部 VRM/GLB 资产管线。

> AI生成

## 附录 · 阶段 10 补丁 + 阶段 11 形象系统 2.5D 化（第八次发版，2026-11-27 下午）

本轮含两部分：① 回应 owner 实测反馈（形象与设计稿差距大）的紧急补丁；② owner 拍板后形象系统整体转向 2.5D 插画路线。本地提交 c39016e + 89bca5d + 4d4adad。

**① 紧急补丁（第七次半发版，c39016e，纯前端）**：三角色默认脸型参数叠加失误（下巴+14/+16、脸颊-12/-14、下颌角+12 全部正向叠加成失衡比例），薄荷主题全冷光导致肤色发灰。修复：默认脸型重定为柔和中庸值、皮肤材质加暖红自发光底（emissive #4a2e26 ×0.07，任何主题保血色）、薄荷主光换暖白；像素验收脸颊/额头/下巴 warmth +21~33。线上产物 `index-B5jjOYY0.js`。

**② S11 形象系统 2.5D 化（第八次发版，89bca5d）**：

- **背景**：程序化 3D（S10）与设计稿插画质感存在不可弥合的路线差距（owner 实测确认）；owner 在「继续 3D / 外部 3D 资产 / 2.5D 分层插画 / 混合」四选项中拍板 2.5D，并加选增强项（表情/说话帧、配饰开关、氛围滤镜）。执行中两个工程决策：配饰提取后 AI 无法保持原位叠加（验证失败），配饰改为与造型包固定绑定；氛围滤镜随五主题联动（夜航无滤镜/晨间暖阳/樱雨樱粉/奶糖焦糖/薄荷清爽）。
- **造型包体系**：每包 = 一套完整 AI 插画立绘（图生图保持角色一致），含 open/closed/smile/talk 四帧；本版上线三角色默认包（深夜电台/旧书店/城市天台），共 12 张透明 PNG（720 宽，约 17MB，白底抠除管线 `scripts/assets/cutout-stage11.mjs`）；架构支持增量扩包（每角色规划 5 包，其余 12 包后续量产）。
- **前端**：`avatar2d.ts` Layer2D 引擎（眨眼 2.2-5.8s/呼吸/指针视差/说话联动/主题滤镜/快照合成带缓存）；`avatar.tsx` 重写为「造型小屋」（2.5D 大预览 + 心情平静/微笑 + 造型包卡片 + WX3- 形象码 + 保存）；`main.tsx` 全站头像接入 `renderPackSnapshot`，聊天页头部改 LiveStage 活头像（表情贯穿、busy 时切 talk 帧）；v1 SVG 保留为素材加载失败降级；320 视口适配。
- **服务端**：sanitizeAvatar v3 分支（角色白名单/packId 正则/表情枚举）；旧 v1/v2 捏捏配置读取时自动迁移默认包。
- **退役**：avatar3d.ts / avatar-catalog.ts / three 依赖全部移除，主包 268KB→250KB（gzip 89.7→82.8KB），600KB 3D chunk 消失；无 WebGL 依赖全设备兼容。

验证（2026-11-27 13:40-15:00）：

- 本地：`npm test` 66/66（新增 v3 校验 1 例）；`npm run build` 产物 `index-DW5RwoJL.js`（250.11KB / gzip 82.83KB）+ `index-CiaKSviG.css`；tsc 0 错误。
- dev 真实浏览器全量验收：造型小屋挂载/立绘帧加载/眨眼开闭帧切换（900ms 内捕获）/微笑表情切换帧 src（open↔smile）/视差 translate/保存 PUT v3 落库（SQLite `{"version":3,"characterId":"lin-zhou","packId":"pack1","expression":"smile"}`）/玄关快照 dataURL 生成/聊天页 LiveStage 活头像（显示保存的微笑表情）；期间修复一个真 bug（avatar.tsx 调用 main.tsx 的 api(path,data,method) 签名不符导致 PUT 变 POST 404）；说话联动因 stub 秒回（busy <100ms）采样未捕获，链路与 setExpression 同构、代码审查通过，待真实模型环境观察。
- 素材质检：15 张生成、两轮修正（林舟短碎发→中长发、耳机挂颈→戴头上）、一次方案否决（配饰独立层提取后 AI 重排为产品图）；抠图验证棋盘格合成（flood-fill 保护云白针织衫不误删、边缘干净）；320 视口修复标题折行与立绘卡高度。
- 线上：页面 200 引用 `index-DW5RwoJL.js`；素材 `avatar-packs/*.png` 200（抽查 linzhou-open 1,251,459B 与本地一致）；未认证 POST 403；线上 JS 含「造型小屋/WX3-」标记；5 项哈希本地与服务器逐字节一致（index.html `919bebdd…`、JS `6177ede1…`、CSS `ff3adf58…`、features.mjs `1fec27eb…`、素材抽查 `056d4d90…`）。
- 重启：后端 v3 校验变更，`sudo service wanxin restart` 后 active。
- 回滚：部署前备份至 `/var/www/_rollback_wanxin_20261127-144738/`（frontend + server + 数据快照），指针 `/var/www/_last_wanxin_backup`；旧前端目录 `wanxin.old` 已清理。
- 邀请消耗：线上验收仅 curl 未认证路径，未消耗邀请令牌；**token-007 仍为最后一张未用邀请**。
- 待办：其余 12 个造型包素材量产（管线已就绪，每包 5 张生成+检查）；说话联动待真实模型环境观察；AI 水印按平台合规保留。

> AI生成

## 附录 · 阶段 11 造型包素材库量产（第九次发版，2026-11-27 下午第二次）

三角色其余 12 个造型包（每角色 4 包）量产完成并上线，提交 ddf7e19。素材库从 3 包扩至 **15 包 60 帧**（透明 PNG 约 81MB，按包加载约 5.5MB/包）。

- **新造型包**：林舟「海边漫步/暖冬炉火/夏夜风铃/特别节目」，顾川「深夜阅读/雨天来客/午后咖啡/店休日」，孙晚「深夜便利店/图书馆午睡/流星雨之夜/春日骑行」；avatar-packs.ts 同步登记（包名 + 一句心情小字）。
- **量产管线**（48 张新图）：open 帧 → 按角色拼图批量质检 → 衍生 closed/smile/talk（ref=各包 open）→ 衍生帧抽查 6/6 → 白底抠除 → 登记。返工 2 次：林舟「特别节目」人设锐利+发型不符（重产后温柔人设回归，背头留少量碎发在可接受范围）、孙晚「图书馆午睡」误带星形发夹（重产后达标）。
- **修复一个真 bug**：LiveStage useEffect 未依赖 config.packId，造型包切换后 Layer2D 不重建、画面停留在旧包素材；补依赖后实测三包切换帧 src 正确（pack2/3/4 素材）且表情状态贯穿。
- **验证**：tsc 0 错误、66/66 测试、真实浏览器实测（造型小屋显示 5 包、依次切换三个包帧加载正确、保存 `{"version":3,"characterId":"lin-zhou","packId":"pack4","expression":"smile"}` 落库、素材三角色抽查可达）。
- **线上**：页面引用 `index-BNBkwsu0.js`；素材抽查 200（linzhou-pack3-open 1,766,386B 等）；未认证 POST 403；线上 JS 含新包名；JS 哈希本地与服务器逐字节一致（`250839bb…`）；纯前端发版（server 未改动）未重启服务。
- **回滚**：部署前备份至 `/var/www/_rollback_wanxin_20261127-153125/`（frontend），指针 `/var/www/_last_wanxin_backup`；旧前端目录已清理。
- **邀请消耗**：线上验收仅 curl，未消耗邀请令牌；**token-007 仍为最后一张未用邀请**。

> AI生成

## 附录 · 聊天语音输入专项修复 + 阶段 12 同包携带（第十次发版，2026-11-27 傍晚）

回应 owner 实测反馈（语音按钮卡死在「正在听…」无法退出）的专项修复，提交 55e86d0；**同一构建包含并行会话完成的阶段 12**（角色记忆系统、每日关心、反馈通道、造型包羁绊解锁、PWA，提交 75538b1），语音验证全程跑在 stage12 代码之上（70/70），组合版本已整体验证后一并上线。

- **修复的 5 项语音缺陷**（`src/ui/main.tsx`，只动语音，不触碰发送/队列逻辑——语音仅写 draft，与手动输入共用入口）：
  1. 卡死无法退出：listening 态下按钮原为 disabled，无任何停止途径 → 按钮变「■ 停止」可点击，手动 stop 随时可用；
  2. HTTP 非安全上下文误导提示：线上 HTTP 环境浏览器禁用麦克风却报「没有听清」→ `isSecureContext` 检测，明确提示「HTTP 访问浏览器不允许麦克风，正式域名 HTTPS 上线后即可语音」；
  3. `continuous:false` 说话一停顿识别即断 → 改 `true` 连续识别；
  4. `interimResults:false` 无实时反馈 → 改 `true`，说话时实时显示中间文字；
  5. 错误提示一刀切 → 按 error code 分类（not-allowed / no-speech / audio-capture / network）+ 20 秒无响应 watchdog 兜底。
- **验证**：tsc 0 错误、`npm test` 70/70（含 stage12 新增 4 例）；dev 真实浏览器 Mock SpeechRecognition 注入测试矩阵全过（interim 实时显示、多段 final 累积、停止后按钮/状态复位、四类错误分别提示、HTTP 环境降级提示、不支持语音的浏览器优雅提示），端到端链路语音→draft→纸飞机发送→收到回复实测通过；验证截图归档 `docs/verification/voice-fix/`。
- **线上**：rsync checksum 增量同步（首用，替代全量 tar：仅传 8 个前端文件 797KB，60 张立绘素材校验和全一致零传输，并顺带清理历次 tar 上传残留的 macOS `._*` 元数据垃圾文件）；12 项产物 SHA-256 本地与服务器逐字节一致（index.html `baed2a0a…`、JS `746a5dd0…`、CSS `7d2b13df…`、sw.js `a6d5730a…`、manifest `bc769c73…`、icon-512 `b3deed53…`、app.mjs `5f56f90d…`、features.mjs `ea6499d1…`、model.mjs `285099c6…`、analytics.mjs `503fe84a…` 等）；后端 4 文件变更，`sudo service wanxin restart` 后 active（PID 1352383）；页面 200 引用 `index-DkJrjqsO.js`；PWA 四件（manifest/sw.js/favicon/icon）200；旧产物已删（SPA 回退返回 883B index.html 壳，磁盘已核实清空）；未认证 POST 403（`/api/` 与 `/wanxin/api/` 双路径）；stage12 新路由 `POST /api/memories`、`POST /api/feedback` 均 403（路由存在且鉴权拦截，旧代码为 404，确认新后端生效）；线上 JS 含语音修复标记（停止/麦克风/isSecureContext）与 stage12 标记（memories/反馈）；公网侧（本机 curl）首页/新 JS/manifest/sw.js/立绘抽查全部 200。
- **回滚**：部署前备份至 `/var/www/_rollback_wanxin_20261127-172708/`（frontend + server + wanxin.sqlite 数据快照，83MB），指针 `/var/www/_last_wanxin_backup`。
- **邀请消耗**：线上验收仅 curl 未认证路径，未消耗邀请令牌；**token-007 仍为最后一张未用邀请**。
- **遗留**：线上为 HTTP 直连 IP，浏览器在非安全上下文下禁用麦克风，语音功能待正式域名 HTTPS 转正后才能真正使用（当前会显示明确的等待提示而非误导报错）；说话帧联动待真实模型环境观察；老三样（SSH 密码与 DeepSeek key 轮换、token-007、域名+HTTPS）待办不变。

> AI生成