> 历史验收：共同经历搜索实施前的候选，不适用于后续源码。

# 可复现构建候选与验收包

2026-11-26，本地候选准备完成，待项目经理复核。**这是未提交工作树快照，不是HEAD版本的已提交制品，不构成部署许可。**

## 版本与摘要

| 项目 | 本轮记录 |
| --- | --- |
| Git基点 | b2e6943e0c4c0fd8f9abd0a05241590b13d86605（仅上下文） |
| 工作树源码SHA-256 | `2a8c066cb353362f9183d0bcd1f08a14a32234a2b5e8ebff5b370fd12231396e` |
| 源文件数 | 47，精确清单及逐文件哈希见 [JSON记录](build-candidate-2026-11-26-pre-library.json) |
| 构建产物集合SHA-256 | `e348ee20d0db5a164ac098dcfb6da73b04ec609f9c1eab33d3fd9ea43d4567e4` |
| 运行时/安装工具 | Node22.23.5、npm10.9.9 |
| 验证环境 | macOS26.6 / darwin arm64 |
| 依赖 | lockfileVersion 3；原根版本不变，无大版本升级 |

源码与产物摘要均按路径、字节长度、原始字节SHA-256组成的排序记录数组计算；规则与重建命令见 [构建说明](../build-candidate.md)。JSON输出、此验收记录、其他验证截图、dist均不参与源码摘要，避免自引用。校验脚本本身在47项清单中。

| 产物 | 字节 | SHA-256 |
| --- | ---: | --- |
| index.html | 368 | `5216a87c811722354745bc9057d1f0f5b08fc698726aaafbae96c09617ea8af0` |
| assets/index-Bup0LaoX.css | 12054 | `9aa87d6a1edfdc0c31982f9f843f779cabcc2c2ed18544626ab90f7f39614d5c` |
| assets/index-CvCq3hDm.js | 204900 | `564944b83ec679eeb0dfb5cf8075042a23dc9d9976a444eb2a8b6d020fe51c8d` |

## 实际验证

1. 锁文件仅在新建外部临时目录中执行`npm install --package-lock-only --ignore-scripts --no-audit --no-fund`生成，再复制package-lock.json；原package.json精确依赖版本未改。resolved均为registry.npmjs.org HTTPS，无认证信息/查询串。
2. 通过白名单脚本复制全新外部工作目录；未复制.env真实值、应用运行目录、Git元数据、SQLite、data、node_modules、dist或验证输出。源/副本摘要一致。
3. 在副本运行`npm ci --include=dev --no-audit --no-fund`，干净安装成功（18个包）。未执行共享目录的安装或构建。
4. 副本`npm test` **32/32通过**，0失败，含原30项及两个清单/复制/排除/篡改检查；所有数据库为临时合成数据。
5. 副本`npm run build`成功；再次构建成功，3个产物逐文件及集合哈希一致。两次`--verify`均返回`candidate_verified`。
6. 原工作树指定副本dist，按JSON记录核验也返回`candidate_verified`，确认产物对应此工作树快照；共享dist未重建，记录不取自其旧产物。
7. 副本运行`verify-access-ui.mjs`，外部Playwright和无界面Chromium验证邀请码POST/清空/不持久化，以及403/429/503原文恢复、无自动发送与同requestId手动重试，通过。加载真实副本构建资产，HTTP为合成拦截，**不证明后端/真实模型/HTTPS部署全链路**。本轮未新增双视口截图，不将该检查算作最终三闸门。
8. `git diff --check`通过；工作区原有受控邀请改动保留。未读真实.env、未打开已有数据库、未启动/替换服务、未新增代理/QA工具、未部署、购买、提交或推送。

清单单测曾发现空源码目录不随文件复制而丢失的问题，复制器现会建立四个源码目录；两个检查最终通过。现有共享node_modules没有改动。

本轮保留的临时副本（供本机复核，临时目录可能被系统清理，不是长期发布存储）：

`/var/folders/lt/f7xdn9m95_zg7qh03bx5prjm0000gn/T/wanxin-candidate-1ps90jk8/work`

本机命令中的Node路径仅用于选定已安装版本，不写入候选源码或生产配置：

```sh
# 先切换Node22.23.5，然后在仓库根目录：
node scripts/candidate-manifest.mjs --dist-root /var/folders/lt/f7xdn9m95_zg7qh03bx5prjm0000gn/T/wanxin-candidate-1ps90jk8/work/dist --verify docs/verification/build-candidate.json

# 长期复现请按docs/build-candidate.md新建临时副本，npm ci/测试/构建，再对照本JSON。
```

## 本轮文件

新增 `.nvmrc`、`package-lock.json`、`scripts/candidate-files.json`、`scripts/candidate-manifest.mjs`、`tests/candidate-manifest.test.mjs`、`docs/build-candidate.md` 与本验收记录/JSON；README增加入口。未改根依赖版本、业务实现、应用配置、共享依赖或数据库。

## 精简owner输入与剩余闸门

| owner需要提供 | 用途/未验证项 |
| --- | --- |
| 目标域名/HTTPS终止、PUBLIC_ORIGIN、可信代理地址及头覆盖方案；主机/服务用户、持久卷路径、备份RPO/RTO与恢复责任人 | 目标环境、Cookie、网络隔离、持久化、备份恢复及回滚演练；本轮没有部署或远程探测 |
| 受邀人数/有效期/补发责任人、主体与全局阈值/时区、供应商硬上限和停止责任人；控制账本/日志保留及查看人 | 真实生产准入与次数策略批准；开发示例不代表授权，调用次数不是费用 |
| 模型供应商/协议/型号与数据政策，安全注入渠道和秘密引用、告警接收人 | 真实模型回复/延迟/失败取消/费用兜底；不要在聊天或仓库提供密钥值 |
| owner真机/系统/浏览器与验收时间，以及之后群内点名的同一具体候选版本 | 真机软键盘、安全区、Safari与版本授权 |

三闸门仍未齐：项目经理需把双视口与最终候选哈希绑定；owner需同候选真机验收；owner需群内点名同一具体版本。后续若提交、修改源码/锁/模板或环境，不把当前记录自动当新版本批准，需重新绑定并复验受影响项目。checksum是内容检查，不是来源签名；本轮同环境重复构建不保证跨平台逐字节一致。

## 最终候选验收登记模板（尚未填写即未通过）

| 登记项 | 待补记录 |
| --- | --- |
| 最终候选版本 | 当前工作树摘要见上；提交版本若后续产生，记录完整提交标识并重新绑定源码/产物摘要 |
| 项目经理双视口 | 候选摘要、视口尺寸、截图位置、验收人、时间、结论：待PM填写 |
| owner真机 | 同一候选摘要、设备/系统/浏览器、软键盘/安全区及完整流程、验收时间与结论：待owner填写 |
| 群内指定版本 | owner授权原文所在位置、时间、明确的同一版本/摘要：待owner填写 |
| 环境核验 | 目标HTTPS/Origin/代理、持久卷/备份恢复、模型及生产策略批准引用、执行人/时间/结果：待补 |

不得把上述“待补”改为通过，除非取得对应候选的实际证据。
