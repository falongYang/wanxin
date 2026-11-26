# 本地实现核定说明

项目经理已核定方案B用于本地代码实施；生产阈值、Origin、代理与保留策略尚未批准，不构成部署或开放入口许可。

# 目标与证据
基点b2e6943；只读git status仅见应用配置目录未跟踪，未合并列表为空。server/app.mjs的POST session仅adult=true创建访客，generate→reply触发模型，pending Map仅进程内互斥；card-preview当前是本地正则摘句，没有模型调用。server/model.mjs真实网络调用在返回的reply函数中，超时由app.mjs控制；index.mjs绑定127.0.0.1且生产Secure Cookie。现有匿名指标不改为成本账本。本轮不编码、不运行数据库流程、测试或部署。

## 三方案比较
|方案|准入/额度|优点|代价与限制|
|---|---|---|---|
|A 外层受邀访问控制+应用持久化额度|网关认证传可信主体，应用账本|令牌管理交给既有网关|未知目标网关；代理身份注入与撤销需环境证据，当前无法独立落地|
|B 应用受控邀请码+SQLite额度（推荐）|服务端配置令牌摘要，原子兑换，额度绑定稳定邀请主体|适配现有Node/SQLite，合成验收可独立完成，清Cookie不重置|需小型邀请配置与恢复流程，严格单实例|
|C 签名邀请码+内存限流、供应商硬上限|无状态签名票据，主要依赖外部限额|代码少|撤销/复用及本地持久化额度不足，重启与清Cookie风险不闭环，不满足本轮目标|
推荐B。A可在已有正式网关证据后另行替换，不同时引入两套身份源；C不作为邀请上线方案。

## B的运行模式和配置
显式APP_ACCESS_MODE=development且NODE_ENV非production、MODEL_MODE=stub时允许原本地开放体验。生产或邀请模式绝不能因stub而绕过准入。其他模式（含未显式选择开发模式的Ollama）必须受控；缺少准入/额度/可信Origin等必填配置、格式错误、重复ID、非正阈值、非绝对持久路径时启动失败。生产+development组合拒绝启动。createApp测试选项必须显式构造开发策略，避免测试默认开放被入口误用。
服务端受限文件保存邀请清单（路径通过环境变量注入）、稳定主体ID、令牌摘要、notBefore/expiresAt、enabled、maxRedemptions=1；不把原始令牌写配置仓库。额度配置包括主体每日/分钟、全局每日/分钟、全局在途阈值、建会话/兑换端点频率、固定重置时区。统一加载校验；请求时重读邀请配置以支持撤销，读取/解析失败即拒绝受控业务，不回落为开放。额度策略启动固定，调参需重启并保留账本。
仅本地示例：主体20次/日、3次/分钟，全局100次/日、10次/分钟、在途2；兑换同来源5次/10分钟及全局30次/10分钟。全部标明开发示例，生产配置不得默认采用，需owner填入批准值。

## 邀请令牌与身份边界
1. owner离线生成至少256位随机不透明令牌，安全渠道交给受邀者；服务端存SHA-256摘要（高熵令牌非可猜口令），恒定时间比较。不要使用短码/自制可猜邀请码；令牌不放前端代码、URL、localStorage、日志。前端仅在成年确认界面提供密码输入，正文POST提交后清空输入，不做浏览器持久化；HTTPS为部署前提。
2. session响应只公开accessRequired等能力标志，不公开名单/阈值/令牌状态细节。POST session提交adult:true和inviteToken；只在合法准入时一次事务检查有效期/启用、消耗兑换次数、创建visitor/thread与映射。无效/撤销/过期统一403，限流429，策略不可读503。已有有效Cookie再次确认不重复消费。
3. 一枚令牌最多一次新会话兑换。并发兑换只允许一次；请求已成功但响应丢失且未收到Cookie，不能凭令牌重放拿回旧身份（避免复制令牌接管）。清Cookie/换设备/清除会话后需owner重新发放令牌；前端明确此限制。没有自动身份找回。
4. 额度主体用稳定quotaSubjectId（邀请ID），不使用可清除visitorId；每个试用者一主体。补发采用同一主体、更高令牌版本，旧令牌立即失效；不得用新主体替代补发以重置当日额度。配置删除后兑换记录保留为墓碑，重新加回同ID/版本不能复用。令牌ID/主体ID唯一性与复用版本均校验。
5. 每次受保护API（线程/消息/卡片/天气）校验visitor→邀请绑定及当前启用/有效期；撤销后已有Cookie也失效。旧未绑定visitor在受控模式下不能继续访问，要求重新准入，不自动把任意旧Cookie升级为邀请身份。删除会话可按持有Cookie执行其本人清除，即使邀请已过期/撤销，仍有Origin校验；不放行其他读写。公开GET session只提供最少状态。
6. 清除会话删正文/卡片/匿名事件与会话绑定；兑换墓碑、当日主体/全局额度不级联删除。控制账本不存正文、原令牌或Cookie；用途和保留需单独隐私说明。失去Cookie不具有找回旧会话权限。

## Origin与代理信任（明确选择）
应用默认不信任Forwarded/X-Forwarded-For/X-Real-IP，取socket地址作兑换端点限流。所有写API要求application/json及严格匹配已配置PUBLIC_ORIGIN的Origin，缺失/不匹配拒绝（测试显式模拟合法Origin）；CORS不开放通配来源。Origin只是跨站防护，不是身份认证。
生产在API仅环回绑定/防火墙隔离且owner确认唯一反代会覆盖头后，才能启用明确single-proxy模式：要求socket来自配置的精确代理地址，仅接受反代覆盖的单一X-Real-IP并校验IP；不自动遍历不可信XFF链。未启用时代理后所有访客共享来源限流桶，安全但可能误伤，必须明确配置后放行。未经信任的头永远不能扩大额度。来源桶仅存带服务器独立秘密的HMAC(IP)，短期保留、不写日志；秘密缺失在受控模式拒绝启动。此HMAC用途是防滥用而非产品事件，也需owner确认保留。

## SQLite数据与原子性
新增独立access-control模块，使用现有业务库新增表，初始化有版本迁移事务；不覆盖旧messages/cards/analytics。建议表：
- invite_redemptions(tokenId/version唯一、quotaSubjectId、redeemedAt)：不外键级联到visitor，永久到邀请活动结束前的控制墓碑。
- visitor_access(visitorId外键级联、quotaSubjectId、tokenVersion)：授权绑定，只有合法兑换事务创建。
- call_daily(day, subject/global, used)、rate_buckets(scope/key, windowStart, count)：整型计数，配置时区日桶和固定分钟桶；来源兑换桶单独短窗。固定窗口有边界突发，文档说明最大跨边界突发为两倍窗口阈值，不伪称滑动限流。
- call_attempts(attemptId、quotaSubjectId、operation、day、state、startedAt/finishedAt、可选request摘要)：不含正文/业务资源原ID。request关联用服务端HMAC，若不需要长期排重可仅用于短期恢复。全局在途来自reserved状态；无活动事务跨网络等待。
- runtime_control(singleton, callsEnabled)：DB默认禁用，邀请启动需显式批准本地控制配置后启用；无公开管理API。使用离线本地受限管理脚本切换，日志仅报开/关结果。

模型网关唯一入口：先验证准入/正文/来源与幂等，再BEGIN IMMEDIATE中检查停止、速率、日额度/在途阈值，原子增加主体+全局计数并写reserved attempt，COMMIT后才能reply。拒绝时事务不部分增加计数、不写新业务消息（已存在失败消息保留）；返回机器可区分错误码。新消息业务落库与额度预留应在同一业务事务，分析事件也跟随该事务，防止额度拒绝却生成一条无法发送的pending。需要拆开generate当前职责避免嵌套事务。
准入兑换频率失败请求也消耗兑换限流桶；模型速率按真实获准调用计数，重放可另受通用端点速率约束。无效/越权/空输入/停止状态均不调用模型。任何DB错误拒绝执行，不用内存回退绕过账本。

## 调用计数、重试、超时及重启
- 一次获准的模型尝试计1次调用额度，非token数/人民币。预留后即保守消耗当日额度，成功/失败/超时/进程崩溃都不退还；明确命名“获准尝试次数”，避免当作供应商实际计费调用次数。预留后进程在发出网络前崩溃也计入，接受少用不超发。
- 已完成requestId重放不重复预留/调用；同requestId正在进行则复用当前Promise；同线程不同请求仍409。真正失败后的同requestId再次重试是新尝试，重新检查额度并扣1；不会重复用户消息或匿名send事件。attemptId每次新生成，与业务requestId区分。
- 超时立即abort并标记timeout/unknown，额度不退；Promise.race结束不证明底层网络停止。未确认reply真正settled时仍占在途槽，防止超时释放后继续叠加调用；晚到结果忽略，不复活已失败消息。若底层不响应取消，受控服务进入容量耗尽，需要运维处理，不靠自动释放制造超发。
- 单实例启动时将遗留reserved标unknown并释放本地在途计数，已用额度不变；只有确认旧实例终止才准启动接管，无法仅靠SQLite证明远程供应商已取消。跨重启可能有远端残留，日额度仍覆盖已预留次数。
- 以预留时的配置日桶记账，跨午夜的完成不转桶；重启/跨日/清会话不重置已有当天值；防时钟回拨，记录上次准入时间并拒绝明显倒退，时钟异常进入停止而非重新开新桶。
- 全局停止开关每次预留事务读取，停止提交之后不再允许新预留；已经获准的在途可能完成并计费，不宣称即时停止供应商收费。脚本可请求进程尽力abort在途，但不退款；供应商侧硬上限和密钥停用仍是owner兜底。

## 所有模型/网络路径
当前只有messages→generate→reply调用模型。card-preview本地摘句=0次调用，但仍要求准入并受通用端点速率限制；不可把每次预览当成模型扣费。将模型网关注入到应用中，未来预览改模型时必须使用相同预留入口、operation=preview、幂等策略与额度，不允许直接调用createModel绕过。createModel不做透明自动重试（每次真实重试需新额度）。天气为外部HTTP但非模型，维持独立超时/端点限流；模型额度不冒充天气供应商预算。本轮不增加新模型能力。

## 最小脱敏日志
独立于analytics，默认JSON一行：时间、受控事件名、路由类别枚举（非原始URL）、HTTP状态、耗时、受控错误码，可选一次性attemptId；不输出主体/visitor/卡片/消息ID、令牌摘要、HMAC来源、IP/UA、Cookie、头、正文、模型响应、异常message/stack或查询串。事件包括启动模式/配置校验结果、准入拒绝、额度429、停止503、调用success/error/timeout/unknown。
注入logger方便测试；字段白名单和错误分类，禁止直接console.error(error)。日志后端失败不能导致无额度模型调用；受控模式对持久控制账本失败直接拒绝。日志输出失败产生可见告警/健康失败，不能递归打印异常。保存期限、落盘轮转、查看权限、代理与供应商日志仍是owner/运维输入，不为本轮接入第三方平台。

## 文件范围与兼容
server/access.mjs（配置/兑换/授权/Origin来源）；server/usage.mjs（迁移/计数/attempt/停止）；server/telemetry.mjs；server/app.mjs整合入口/事务/错误；server/index.mjs启动校验和单实例运行约束；server/model.mjs必要时仅收敛调用入口，保持协议；src/ui/main.tsx/style.css小范围邀请输入与403/429/503恢复；scripts/access-control.mjs离线生成/启停/检查（不输出已有秘密）；.env.example仅变量名/非真实本地示例；docs/access-control.md及验收记录；聚焦测试文件。具体模块拆分实施时允许小幅调整，避免大重构。
旧库迁移仅增表，旧数据保留；开放开发模式保持既有访客体验。切受控模式旧会话不自动继承授权；回滚旧代码会绕过新控制，必须关闭入口，不能当作安全回滚。先在临时旧结构库演练，现有数据不触达。控制墓碑保留到活动结束、账本/来源桶保留由owner批准，不能直接套产品事件7天政策；当日额度绝不因清理消失。
单进程/单实例是硬前提，部署文档及启动互斥锁必须拒绝第二实例。不能靠PID文件自动删陈旧锁：异常退出后的解锁需明确确认旧进程终止；多实例/多主机不支持，不能将BEGIN IMMEDIATE预算原子性当成完整分布式执行锁。

## 分阶段验收（核定后实施）
1. 配置/准入优先：开发stub允许；生产缺配置/错误模式启动失败；令牌有效/过期/撤销/重复/并发兑换；既有Cookie续用、清Cookie不复用、补发同主体；旧访客拒绝；Origin/Content-Type及伪造代理头检查。合成数据，无现有库。
2. 额度网关：单次与并发阈值精确、429不调reply、主体+全局原子且数据库错误不调模型、停止后无新预留、跨午夜/重启/清会话保持当天额度、已完成重放不扣/失败重试再扣、取消忽略时槽不释放、崩溃保守计数；预览零模型扣费但受端点限流、天气不混算。
3. 脱敏与UI：合成秘密哨兵覆盖输入/卡片/令牌/头/URL/供应商错误，断言日志不含；日志失败/通用错误、输入不入持久前端存储；403可重新准入、429保留用户原文与Retry-After、503不自动重发、不重复send/用户消息。
4. 旧库/文档：临时旧库增表、原消息卡片与analytics/级联不回退；读写/拒绝结果重启可复现；全套现有测试与构建。真实模型费用、HTTPS、真机/代理、备份与发布验收单独留证，不把替身视为通过。

## owner输入与范围外
核定B及单次兑换/无自动找回、稳定主体补发规则、控制数据保留；邀请人数/时段、生产阈值/重置时区、供应商硬上限与开关责任人；PUBLIC_ORIGIN、HTTPS/反代地址与头覆盖/端口隔离、持久路径/服务用户、锁接管流程；安全秘密注入渠道、日志期限/查看人/告警，密钥值不要入聊天。无这些输入可完成临时代码及合成验收，但受控环境不得开放。
本轮只准备设计；不实施部署、购买、远程配置、完整账号体系、真实货币结算、多实例、供应商控制面集成、改匿名指标、改天气产品或新增代理。原三闸门（PM双视口+候选哈希、owner真机、owner群内点名同一版本）仍保持，代码修复不是发版授权。

---

# 本地实现与操作说明（2026-11-26）

以上为核定设计原文，其中“本轮只准备设计”指此前的设计阶段。项目经理随后授权四阶段本地实施。本节记录实际行为；生产策略、部署、远程配置和开放入口仍未批准。

## 已实现的模式与配置

`server/index.mjs` 在打开数据库之前调用 `loadPolicy`。未配置模式拒绝启动。仅 `APP_ACCESS_MODE=development`、`MODEL_MODE=stub` 且非 `NODE_ENV=production` 的组合开放本地替身体验。生产与 development 组合拒绝；本机 Ollama 也属于真实调用，需 invitation 配置。测试直接调用 `createApp` 时也必须显式传入策略，旧测试/本地审计已改用 `developmentPolicy()` 表明合成替身边界。

本地体验命令（须由操作者选择运行，本轮未启动或替换已有服务）：

```sh
APP_ACCESS_MODE=development MODEL_MODE=stub npm run api
npm run dev
```

README 与 `.env.example` 已同步。AgentsRoom 已保存的旧开发命令需要由项目经理/owner在命令面板显式更新这两个变量；应用配置及运行中的终端没有被此次改动修改。

受控模式必填：

| 配置 | 要求 |
| --- | --- |
| APP_ACCESS_MODE | invitation |
| PUBLIC_ORIGIN | 单一完整HTTPS Origin，无路径、用户名、查询串或末尾斜杠 |
| SQLITE_PATH | 受限持久目录内绝对路径；目录/服务用户权限由owner配置 |
| ACCESS_INVITES_FILE | 私密邀请摘要清单的绝对路径；每次授权重读，解析失败503 |
| ACCESS_HMAC_SECRET | 至少32字符的服务端随机秘密，经安全渠道注入，不进入前端/仓库/日志 |
| ACCESS_PROXY_MODE | none 或 single-proxy，必须明确选择 |
| ACCESS_PROXY_ADDRESS | 仅single-proxy需要，socket来源须精确等于该IP，X-Real-IP须是一个合法IP |
| ACCESS_LIMITS | JSON对象，下面所有键必须显式提供，不使用缺省生产阈值 |

ACCESS_LIMITS 的键为 `subjectDaily/globalDaily/subjectMinute/globalMinute/inFlight/redeemSource/redeemGlobal/endpointMinute/timeZone`，次数均为正整数，时区必须有效。日/分钟调用额度属于稳定邀请主体；每个试用者一个主体，因此清Cookie、更换visitor或同主体补发不能重置其额度。`endpointMinute` 是主体业务请求频率，含线程、卡片、预览及天气；`redeemSource/redeemGlobal` 是10分钟固定窗中的准入请求次数，失败请求也计数；调用分钟桶独立。固定窗边界可能出现两倍窗口阈值的短时突发。日桶按预留时的配置时区，不按完成时刻移桶。

`.env.example` 注释中的阈值仅为合成示例，不是生产批准。生产Origin、阈值、代理与保留政策仍须owner确认，程序的格式校验不证明这些策略已获授权。

## 生成、启停和单实例接管

以下均为**操作模板，不是本轮执行记录**。现有库/真实邀请只在owner批准的维护流程操作。使用Node>=22.13，所有路径使用绝对路径；先确保父目录存在且为受限私密目录。

```sh
# 输出目录必须尚不存在；只写新文件，不覆盖已有邀请。
node scripts/access-control.mjs generate /absolute/private/new-issue trial-001 1 token-001 2026-11-26T00:00:00Z 2026-12-01T00:00:00Z

# 聚合状态检查，不输出主体、令牌或事件明细。
node scripts/access-control.mjs inspect /absolute/private/wanxin.sqlite

# 默认 callsEnabled=0；明确启用获准的本地调用，停止也要求显式参数。
node scripts/access-control.mjs enable /absolute/private/wanxin.sqlite --confirm-local-control
node scripts/access-control.mjs stop /absolute/private/wanxin.sqlite --confirm-local-control

# 仅确认旧进程确实终止后人工接管；脚本还会检查旧PID不存活。
node scripts/access-control.mjs takeover /absolute/private/wanxin.sqlite --confirmed-old-process-stopped
```

生成器创建0700目录和0600文件：`invite-secret.txt` 是256位随机原始令牌，`invite.json` 只含SHA-256摘要及策略。标准输出只有状态，不能把秘密文件传入仓库、聊天或截图。通过批准的私密渠道交付原始令牌；把摘要条目合并至服务端清单，使用临时文件加原子重命名更新，避免不完整写入造成暂时503。保留到期/禁用条目可显式撤销；每主体清单只允许一个当前版本。补发沿用subjectId，增加version并使用新tokenId/新令牌，不新建主体绕过额度。

每令牌只允许一次新身份兑换；已有有效Cookie再次确认不消耗兑换。响应丢失且Cookie未收到、清Cookie或换设备后均不能重复兑换取回身份，需同主体补发。旧未绑定/已撤销Cookie可以用新邀请创建独立身份，不认领旧数据；仍持有旧Cookie者可按合法Origin清除其旧会话。当前前端不提供自动找回或跨设备合并。

文件数据库（包括开发替身）使用规范路径旁的 `.instance-lock`，获取失败立即拒绝。正常关闭会排空底层模型任务后关闭数据库并释放锁；退出时若底层永不结束，锁保留到人工确认接管。异常退出不自动删除陈旧锁。不要手工删除活实例锁，不支持多主机/网络文件系统/硬链接别名或多实例。旧版不创建锁，升级前须停止所有旧版写入进程，不能与新版并行。

管理脚本只打开已有数据库，不初始化新库或绕过策略；启停事务与运行中预留使用同一SQLite控制行。停止后不再接受新的预留，已预留的调用仍可能发出或完成，不承诺供应商即时停费。脚本不提供自动终止在途HTTP；应用的请求超时会尽力Abort。供应商硬上限和吊销凭证仍由owner负责。

## 额度、失败和迁移

- 一次获准尝试消耗一次主体/全局日额度及模型速率；不是token数或真实费用。无效输入、越权、额度拒绝不调用模型，也不新增用户消息。数据库失败不回退为内存额度。
- 消息写入、匿名send和额度预留在同一 `BEGIN IMMEDIATE` 中完成；网络调用不持有SQL事务。成功重放不再次扣次数；失败后主动重试是新模型尝试，再扣一次，但不重复业务用户消息或匿名send。
- 失败、超时、进程崩溃均不退次数；预留后未实际发出也保守算已用。HTTP超时标记timeout_pending，底层未settled仍占全局槽，同线程返回原失败结果，不额外发起尝试。底层结束后释放槽，晚到回复不写业务历史。若底层完全不响应取消，容量可能耗尽，需操作者处理。
- 单实例锁保护下重启将遗留在途标记unknown，释放本地槽但不退款。旧进程必须已终止；供应商端仍可能短暂处理旧请求，已预留次数仍包含这部分。
- 最后控制时间持久化，时钟回拨时拒绝请求，不能靠回拨开新日桶；恢复正确系统时间后处理，不删除账本“重置”。分钟桶到期在后续请求剪除；日账本、attempt及兑换墓碑当前无自动过期，正式保留策略尚待owner。清除会话会删业务数据、匿名事件及授权绑定，不删除这些独立控制记录。
- 本地预览仍为摘句，不消耗模型调用次数，但受主体请求频率限制；天气是外部HTTP，受端点限流与其既有超时，不混入模型调用次数。未来模型预览必须复用reserve/settle网关，不允许直接调用模型。
- 控制表以版本1事务及 `CREATE TABLE IF NOT EXISTS` 增量创建（未知版本拒绝启动），现有消息/卡片及analytics保持不变。已有用户数据不会自动绑定邀请。回滚旧代码会绕过保护，必须先关闭入口，不能作为安全回滚。

## 日志、UI和局限

运行日志为JSON白名单：时间、受控事件/路由类别、HTTP状态、耗时及有限错误码。无原URL/查询串、IP、UA、身份、业务ID、令牌/摘要、HMAC、Cookie、正文、模型回复或原始异常。启动失败只输出固定通用原因。默认日志输出标准输出，落盘轮转、访问和保留由运维/owner配置；注入logger是同步sink，抛错会标记不健康，后续请求503并输出固定故障标记。运行环境还需处理stdout管道/磁盘故障与进程监控，不能把应用日志白名单当作代理或供应商日志已脱敏的证据。

邀请输入仅保存在当前内存，经JSON POST提交并清空；不进入URL、本地存储或脚本日志。403显示重新确认邀请入口；429/503保留原文，必须手动重试，原请求编号沿用。`Retry-After` 用于提示最少等待，不保证到时一定有容量/日额度。消息队列、卡片来源和历史去重逻辑保留。

仍未验证：真实供应商取消/计费、实际HTTPS及代理头覆盖、生产阈值/日志与控制数据保留、真机/Safari和最终候选三闸门。所有本地测试使用临时合成库与替身，不触达既有库、真实模型或生产资源。

## 可复现验证

```sh
node --test tests/access.test.mjs tests/usage.test.mjs tests/control-integration.test.mjs tests/control-operator.test.mjs tests/telemetry.test.mjs
npm test
npm run build
# Playwright外部安装，浏览器脚本加载dist并拦截合成HTTP，不启动服务。
PLAYWRIGHT_MODULE=/absolute/external/playwright/index.mjs node scripts/verify-access-ui.mjs
git diff --check
```

Node22.23.5现场结果及文件清单见 [本地实施证据](verification/access-control.md)。上线仍须项目经理双视口和候选哈希、owner真机、owner群内点名同一版本，三闸门不因本地实现完成而关闭。
