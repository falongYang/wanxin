# 共同经历搜索与分组本地交付

2026-11-26，#7实现完成，待项目经理复核；设计见 [card-library.md](../card-library.md)。仅前端、无新增依赖、服务接口不变。现有准入/候选未提交改动保留，未触达已有数据库或运行服务。

## 行为

- 标题/正文与查询trim、小写后的连续子串匹配；不分词、不拼接字段，空查询显示全部。结果数、清空、空收藏和无结果文案区分。
- createdAt按Asia/Shanghai自然月分组，月份/卡片倒序，同时间按id升序。列表日期同用上海时区；异常日期置后标明未知。
- 查询、列表滚动位置和卡片身份只在内存。详情返回刷新列表后恢复原查询/位置/焦点；编辑出匹配集或删除后聚焦最近存活卡；无结果聚焦搜索框。清除会话重置状态。
- 搜索本身不请求API、不写URL/localStorage/sessionStorage；详情/编辑/删除/返回仍沿用原接口。失败提示与重新准入入口保留；详情读取失败也恢复卡片按钮焦点。

## 文件

src/ui/main.tsx、style.css；新增card-library.js及.d.ts、tests/card-library.test.mjs、scripts/verify-card-library.mjs、设计文档；README入口及候选白名单更新。旧#6候选验收归档，新源码/产物摘要见 [当前候选](build-candidate.md)。没有覆盖服务端准入改动、依赖锁或其他成员配置。

## 验证

在全新外部副本执行`npm ci --include=dev --no-audit --no-fund`、`npm test`、`npm run build`：**34/34通过，构建通过**；第二次构建逐文件哈希一致，原工作树/副本核验`candidate_verified`。Node22.23.5/npm10.9.9，macOS26.6 arm64。`git diff --check`通过。

两个聚焦逻辑回归先失败后通过：中文、英文大小写、trim/空白/无结果、标题正文不跨字段匹配、输入数组不变；上海UTC月界、时间倒序、同时间稳定id及非法日期兜底。

浏览器命令在临时副本、真实构建资产上运行，接口由独立合成HTTP拦截；无服务进程、真实模型或现有数据库：

```sh
PLAYWRIGHT_MODULE=/tmp/wanxin-browser/node_modules/playwright/index.mjs UI_SCREENSHOTS=/absolute/project/docs/verification/card-library-screenshots node scripts/verify-card-library.mjs
PLAYWRIGHT_MODULE=/tmp/wanxin-browser/node_modules/playwright/index.mjs node scripts/verify-access-ui.mjs
```

搜索脚本三视口均通过：15张跨月卡稳定分组/顺序，连续匹配/空白/清空、搜索请求数不变且查询不入URL/请求体或持久存储、刷新重置查询；非零滚动位置与卡片焦点恢复（误差≤2px）、编辑不匹配邻卡焦点、删除取消/确认和最后匹配删除、空收藏区分；读取503恢复焦点、403仍保留结果与重新准入入口；最新版本续聊引用不自动发送/可移除、来源准确定位。现有403/429/503邀请恢复脚本通过。

补充503检查复现焦点落到body的问题，设置恢复标记后最终副本通过。一次验证误从共享旧dist读取，超时后改用隔离副本，最终证据均来自work-final，未构建或改动共享dist。

## 三视口截图

以下均为合成数据/HTTP、真实本轮构建；脚本等待目标列表与busy=false后截图，并检查页面无横向溢出，按钮/输入区域高度至少44px。已人工查看390分组、320搜索与1280无结果截图。

| 状态 | 320×740 | 390×844 | 1280×900 |
| --- | --- | --- | --- |
| 月份分组 | [320](card-library-screenshots/grouped-320.png) | [390](card-library-screenshots/grouped-390.png) | [1280](card-library-screenshots/grouped-1280.png) |
| 英文搜索 | [320](card-library-screenshots/search-320.png) | [390](card-library-screenshots/search-390.png) | [1280](card-library-screenshots/search-1280.png) |
| 无结果 | [320](card-library-screenshots/no-results-320.png) | [390](card-library-screenshots/no-results-390.png) | [1280](card-library-screenshots/no-results-1280.png) |
| 空收藏 | [320](card-library-screenshots/empty-320.png) | [390](card-library-screenshots/empty-390.png) | [1280](card-library-screenshots/empty-1280.png) |

## 限制

本轮不验证后端真实链路、模型质量/费用、目标HTTPS或实体手机软键盘/Safari。搜索只覆盖当前API已返回的集合；没有服务端分页/全文搜索。源码改变后旧候选摘要不适用；历史记录保留，当前验收绑定新工作树摘要，仍未提交/部署/推送。生产输入和最终三闸门保持待验。
