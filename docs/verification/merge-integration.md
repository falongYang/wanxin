# 最新受控试用合并验证

本地提交94e92f6与缓存origin/main=6bc8517的现有merge继续完成。冲突只在main.tsx/style.css，逐段整合，未整文件选择ours/theirs；app.mjs及chat测试自动合并后另核验。

保留：远端会话抽屉本地搜索/置顶、定位原消息、回复过程计数/阶段说明、回复状态、待发失败重试修复；本轮邀请、调用次数保护、脱敏日志、共同经历搜索/月份/返回位置。河灯样式包裹每个月的卡片，保留卡片ID及焦点快照。置顶错误进入既有准入恢复。

新增受控pins测试：未准入403、伪Origin403、非JSON415、跨访客PUT/DELETE404、本人幂等置顶/取消、撤销后PUT/DELETE403、删除会话级联清pin/activity，模型调用次数不因置顶增加；安全日志不含正文或消息ID。pins仍在授权/端点频率守卫后，不是DELETE session清除例外。

## 命令与证据

在新外部副本、Node22.23.5/npm10.9.9：npm ci成功；npm test **35/35**；npm run build及重复构建通过，产物相同；原工作树/副本候选核验成功；git diff --check及冲突标记检查通过。原共享依赖/已有数据库/运行服务保持不动。所有数据库和回复都是临时合成。

脚本：verify-merged-ui、verify-card-library、verify-access-ui均通过。真实构建资产与合成HTTP，不证明真实后端、模型费用或部署可用。已人工查看320抽屉/活动及390河灯截图。

| 状态 | 320×740 | 390×844 | 1280×900 |
| --- | --- | --- | --- |
| 抽屉置顶与活动说明 | [320](merge-screenshots/drawer-320.png) | [390](merge-screenshots/drawer-390.png) | [1280](merge-screenshots/drawer-1280.png) |
| 河灯月份列表 | [320](merge-screenshots/river-320.png) | [390](merge-screenshots/river-390.png) | [1280](merge-screenshots/river-1280.png) |
| 搜索结果 | [320](merge-library-screenshots/search-320.png) | [390](merge-library-screenshots/search-390.png) | [1280](merge-library-screenshots/search-1280.png) |
| 无结果 | [320](merge-library-screenshots/no-results-320.png) | [390](merge-library-screenshots/no-results-390.png) | [1280](merge-library-screenshots/no-results-1280.png) |

其余分组/空收藏三视口照片在merge-library-screenshots中；旧共同经历照片未覆盖。新候选完整源码/产物SHA256见build-candidate.md/.json；旧候选pre-merge记录保留，不用于合并后的源码。

用户授权普通提交推送已由项目经理交接。本次只完成GitHub同步，不部署；最终提交、父提交和远端实际结果以委派交付回执为准。需要owner的生产策略/HTTPS/真实模型/真机/三闸门仍待后续，不用本地合成证据代替。
