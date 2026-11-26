# 远端功能合并后的候选验证

2026-11-26，整合本地94e92f6与本地origin/main=6bc851730281d678ee8f6a6afb8792f0dda286df。用户经项目经理明确授权合并提交与普通GitHub推送，本轮不部署。

本JSON在合并提交之前生成，baseCommit=94e92f6b2532c176bc501b61e8cb380a5c4e7271仅为本地基点；记录的是已验证合并工作树的内容，不冒称该基点制品。完成提交后用相同源码摘要复核绑定，最终提交及实际远端结果记录在委派交付回执，避免提交文件递归引用自身提交号。

| 项目 | 记录 |
| --- | --- |
| 源码文件数 | 54 |
| 源码SHA256 | `f6942bdf1d8b7d99230403d30bbe01732bf4dc3e5f2f0911887c59acec853cd2` |
| 产物集合SHA256 | `14ee8eb14d1c1bec26356ada18f5367328e06c947a1afa9a04d2cefb23bae4a3` |
| 环境 | macOS26.6 arm64 / Node22.23.5 / npm10.9.9 |
| 隔离验证 | npm ci成功、35/35测试、两次构建成功且产物一致 |

| 产物 | 字节 | SHA256 |
| --- | ---: | --- |
| assets/index-Bt-zOg4T.js | 208763 | `e86d0d8e8dc9b23b9f5d621f31ae3c2d4cdcd61d4a56c1bba1d6c3ba0b6a746a` |
| assets/index-D0yuzwod.css | 13748 | `dfe4df13bcca4d2ce97e180207332502f31877f2b0964b93eb8f32f623a78dd4` |
| index.html | 368 | `5d5af4ed8a4be1e7862ec5f57c6a311134312a2f51c346f6a6aa21a26e796f88` |

逐文件记录见 [JSON](build-candidate.json)，合并前候选保留为 [历史记录](build-candidate-2026-11-26-pre-merge.md) 与 [历史JSON](build-candidate-2026-11-26-pre-merge.json)，原#6历史也保留。清单含新增合并说明/界面脚本；验证输出不入自身源码摘要。基点/提交/平台元数据不是源码摘要的一部分。

## 已核验

- main/style逐段合并，保留抽屉搜索/置顶定位、活动说明/状态、失败队列重试，以及准入/额度/日志、共同经历搜索分组与返回焦点。河灯容器保留在各月份分组内。
- pins的PUT/DELETE在Origin/JSON、邀请与端点频率检查之后，消息所有权再次限制；受控回归覆盖未准入/撤销、跨访客、重复置顶/取消、清除级联，不触发模型/不增加调用额度。日志pins类别无原消息ID。
- 外部临时副本按锁安装、35项测试/构建通过；重复构建产物逐字节一致，副本与原工作树均candidate_verified。没有使用共享node_modules/dist或已有库。
- verify-merged-ui三视口通过抽屉搜索、置顶、原消息定位、活动说明、河灯月份、返回查询焦点、置顶403恢复且无自动模型发送；verify-card-library及verify-access-ui也通过。
- 三套界面检查均为真实隔离构建资产+合成HTTP，不证明真实模型/后端全链路。无真实.env或既有数据库读取，无服务启动替换、新代理/QA调用或部署。

## 仍待环境验收

生产阈值/保留、HTTPS/PUBLIC_ORIGIN及可信代理、真实模型/费用/取消、目标持久化备份、真机/Safari与最终三闸门保持待验。GitHub推送授权不等于生产部署批准。源码再变需重新绑定候选。

本机临时副本：`/var/folders/lt/f7xdn9m95_zg7qh03bx5prjm0000gn/T/wanxin-merge-bdzv36lq/work`；可按docs/build-candidate.md重建。合并说明与截图索引见 [合并记录](merge-integration.md)。
