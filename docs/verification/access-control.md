# 受控邀请与调用额度保护本地交付

基于 b2e6943 实施，2026-11-26。设计经项目经理核定B后本地落地，等待项目经理独立复核。未部署、提交、推送、购买、启动/替换服务；未读本机.env、未打开现有数据库。仅强制会话状态由应用规定更新，其他应用运行目录未改。

## 阶段证据

1. **配置/准入**：配置缺失及生产development拒绝；显式非生产stub保持开发体验。密码输入POST、单次/并发兑换、撤销/过期、同主体补发、旧身份不继承、严格Origin/JSON及可信单代理均有合成检查。设计先保存docs/access-control.md。
2. **持久化次数/停止**：预留与业务/事件同事务；主体及全局额度、分钟桶、清身份/重启/跨日、时钟回拨、停止、失败重试及免费成功重放均检查。HTTP超时不释放未settled槽，底层晚到不会复活失败回复；SQL写失败事务回滚且不调模型。单实例互斥及人工确认接管命令检查。
3. **日志/UI**：秘密哨兵覆盖正文、令牌、Cookie、查询串、数据库/供应商异常，日志只留白名单值；输出失败健康503。无界面Chromium加载真实构建资产，拦截合成HTTP，验证邀请码清空/不持久化、403/429/503输入保留与无自动发送、429/503手动重试沿用requestId；不需要开发服务器。
4. **兼容/文档/回归**：临时旧库已有消息、卡片与匿名事件，移除控制表再增表升级后数据完全一致，外键完整；旧Cookie拒绝，新邀请独立身份；控制表以版本1事务初始化，不支持的版本拒绝启动；配置回滚不能复活已被更高兑换版本取代的Cookie。既有产品回归继续检查。README及.env.example明确开发模式；已有开发命令未自动修改。

## 改动清单

- 服务端：server/access.mjs、usage.mjs、instance-lock.mjs、telemetry.mjs，以及app.mjs、index.mjs。
- 本地操作：scripts/access-control.mjs；scripts/audit-release-baseline.mjs显式开发策略并说明其20次替身样例不证明受控额度。
- 界面：src/ui/main.tsx、style.css，仅邀请输入与错误恢复。
- 回归：tests/access.test.mjs、usage.test.mjs、control-integration.test.mjs、control-operator.test.mjs、telemetry.test.mjs、tests/helpers/；既有五个服务测试文件改为显式开发策略，原业务断言保留。
- 浏览器：scripts/verify-access-ui.mjs。
- 文档：docs/access-control.md、此文件、审计跟进、README.md、.env.example。

## 命令与结果

使用本机Node22.23.5（默认Node20不支持node:sqlite）：

```sh
PATH=/Users/loganyang/.nvm/versions/node/v22.23.5/bin:$PATH npm test
PATH=/Users/loganyang/.nvm/versions/node/v22.23.5/bin:$PATH npm run build
PLAYWRIGHT_MODULE=/tmp/wanxin-browser/node_modules/playwright/index.mjs node scripts/verify-access-ui.mjs
git diff --check
```

最终全套30/30通过，0失败；TypeScript与Vite构建成功；git diff --check通过。针对控制的13项检查覆盖准入/额度/管理工具/日志（30项总数包含既有17项）。浏览器脚本三种错误状态检查通过。旧本地审计脚本的Secure Cookie、重启、停写备份恢复和完整性检查通过；其20次调用明确标为显式开发stub，不能用作受控额度证据。聚焦模块缺失先失败，实现后通过；集成检查发现测试兑换次数超过其自身阈值，明确提高该流程的合成阈值，运行策略没有放宽；UI重试检查等待条件曾过早成立，改为等待完成消息操作按钮，验证响应完成后草稿清空。

## 风险与未完成的环境工作

生产参数/Origin、反代可信地址与覆盖头、真实模型费用/取消、持久卷/权限、备份恢复、日志及控制记录保留仍未批准。当前attempt/每日账本/兑换墓碑不自动清理，分钟桶触发式剪除，不能宣称保留运维已完成。严格单实例，异常锁由人工确认接管；不提供丢Cookie自动找回，补发不认领旧数据。停止不即时阻断已预留调用，次数不等于费用。真机/Safari和发布候选三闸门未在本轮验证。
