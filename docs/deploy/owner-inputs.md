# 晚信 owner 输入清单（生产部署前必需）

> 代码、健康检查、部署模板与本地验证均已就绪；以下输入缺一则**受控环境不得开放**。
> 不含密钥值；密钥经批准的安全渠道传递，不写入本清单或聊天。

## 一、准入与入口
- [ ] **HTTPS 域名与证书**：目标域名 + 证书来源（当前远端 `101.42.26.83` 的 443 未开放）。
- [ ] `PUBLIC_ORIGIN`：`https://<域名>` 精确值。
- [ ] 反代模式：`none` 或 `single-proxy`；若 single-proxy，给出唯一代理地址，确认由它注入 `X-Real-IP`。

## 二、凭据（安全渠道，勿在聊天给）
- [ ] SSH 登录身份：**当前本机 ed25519 密钥被 `root@101.42.26.83` 拒绝，agent 无身份**，需提供可登录账号/已授权公钥。
- [ ] 真实模型：`MODEL_API_URL`、`MODEL_NAME`、`MODEL_API_KEY`（或确认 ollama 本机）。
- [ ] `ACCESS_HMAC_SECRET`（≥32 字符随机秘密）。

## 三、受控策略
- [ ] **生产阈值**（`ACCESS_LIMITS`，示例值 20/100 等不可用）：`subjectDaily/globalDaily/subjectMinute/globalMinute/inFlight/redeemSource/redeemGlobal/endpointMinute/timeZone`。
- [ ] 重置时区与每日/分钟窗口语义确认。

## 四、存储与运维
- [ ] **持久卷**：`SQLITE_PATH` 受限绝对路径 + 服务账号；备份 RPO/RTO 与恢复责任人。
- [ ] 日志保留期、落盘轮转、查看权限与告警接收人。
- [ ] 供应商硬上限/停止责任人（额度账本不能即时停费，供应商侧停用是兜底）。

## 五、验收与发版
- [ ] owner 真机设备/系统/浏览器 + 验收时间（软键盘、安全区、320px 完整流程）。
- [ ] **三闸门**：PM 双视口+候选哈希；owner 真机同版本；owner 群内点名同一具体版本。

> 任一缺失即保持「不开放入口」。本清单仅登记，不构成部署/发版授权。

> AI生成
