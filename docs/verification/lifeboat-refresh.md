# 晚信三阶段改版交付记录

2026-11-25。实施完成，项目经理复核通过；未提交、未推送、未部署。

体验入口：[晚信本地预览](http://127.0.0.1:5173)。由项目经理启动的页面与接口服务，使用 **MODEL_MODE=stub**，回复标记为「测试回复」，独立预览数据库。进入后完成成年确认，与林舟聊天；自己的完整消息右下角「···」可制作经历卡。

## 三阶段结果

| 工作项 | 实施与检查结果 |
| --- | --- |
| #1 统一视觉与布局 | 夜蓝暖金、系统衬线标题、原创 CSS 海面、信笺卡片。成年确认、发现、聊天、预览、列表、详情与空态均留证；390×844、1280×900、320×740 无页面横向溢出，显示按钮和 summary 高度至少44px。 |
| #2 消息菜单 | 仅完整用户消息提供可见入口；Enter打开，方向键聚焦菜单项，Tab、Escape和外点关闭；Escape及取消预览恢复来源按钮焦点。取消不保存，预览失败可用原文编辑收藏；等待禁重发，重试按原requestId去重。 |
| #3 来源与续聊 | 详情与编辑分离，支持取消修改；来源按sourceMessageId滚动、聚焦并强调3.2秒，缺失时明确提示。两张卡刷新仍在；编辑后续聊重新读最新版本、可移除且不自动发送；失效引用恢复原文、移除后可发送；删除确认与清除双确认保留。 |

## 改动文件

- `src/ui/main.tsx`：页面层级、消息菜单、焦点、详情/编辑、来源定位、最新卡片续聊。
- `src/ui/style.css`：设计变量、布局、纸张样式、窄屏和安全区、减少动态效果。
- `scripts/verify-ui.mjs`：独立浏览器身份的前端回归和截图脚本。
- `docs/verification/lifeboat-refresh.md` 及 `screenshots/`：本记录与页面证据。

未修改服务端、接口或数据模型、依赖清单、运行配置。既有 `.gitignore` 和应用配置目录未改动。本地安装项目已有依赖时不生成锁文件；测试工具仅临时安装到外部目录。

## 执行命令与结果

项目要求 Node >=22.13。默认 shell 为 Node20，直接 `npm test` 因缺少 `node:sqlite` 失败，直接构建因未安装依赖失败；仓库没有锁文件，`npm ci` 不适用。改用现有 Node22 和安装现有依赖后：

```sh
npm install --no-package-lock --no-audit --no-fund
PATH=/Users/loganyang/.nvm/versions/node/v22.23.5/bin:$PATH npm test
PATH=/Users/loganyang/.nvm/versions/node/v22.23.5/bin:$PATH npm run build
git diff --check
```

- 11项现有测试全部通过，包含访客隔离、并发去重、重试、输入边界、卡片更新和删除上下文。
- TypeScript及Vite构建通过；未发现diff空白问题。

前端测试可使用任意外部Playwright安装。此轮复现命令：

```sh
npm install --prefix /tmp/wanxin-browser --no-audit --no-fund playwright
PLAYWRIGHT_MODULE=/tmp/wanxin-browser/node_modules/playwright/index.mjs node scripts/verify-ui.mjs
```

使用本机缓存 Chromium，无界面运行，访问上述真实本地页面与SQLite替身服务；没有启动QA代理。脚本通过全部断言，无页面脚本异常。测试独立访客身份，结束时仅删除该测试身份数据。

覆盖：开聊建议仅填入、等待禁重发、菜单键盘/外点关闭、取消预览及焦点恢复、同源收藏去重、503预览失败后手动保存、两卡刷新、编辑保存/取消、跨页面更新后最新版本引用、移除引用、准确来源与返回历史缺失来源、引用被另一页面删除后的404恢复、服务端已处理但丢响应后的原位重试、删除确认/取消、清除双确认/取消、减少动态效果、三视口触控与横向溢出。

初次菜单检查确认入口缺失而失败，实现后通过；来源检查确认按钮缺失而失败，实现后通过。追加取消预览焦点用例曾失败，按消息ID恢复新DOM焦点后通过。单字消息菜单曾因气泡宽度限制导致聊天区横向溢出，新增断言复现后改为视口上限，通过。截图统一等待目标页面和busy=false，避免异步返回旧画面。

## 截图索引

每行三个文件分别使用390×844、1280×900、320×740视口。纵向长内容使用完整页面截图。

| 页面或状态 | 手机 | 桌面 | 最小宽度 |
| --- | --- | --- | --- |
| 成年确认 | [390](screenshots/gate-390.png) | [1280](screenshots/gate-1280.png) | [320](screenshots/gate-320.png) |
| 发现 | [390](screenshots/discover-390.png) | [1280](screenshots/discover-1280.png) | [320](screenshots/discover-320.png) |
| 聊天 | [390](screenshots/chat-390.png) | [1280](screenshots/chat-1280.png) | [320](screenshots/chat-320.png) |
| 单字消息菜单 | [390](screenshots/message-menu-390.png) | [1280](screenshots/message-menu-1280.png) | [320](screenshots/message-menu-320.png) |
| 预览 | [390](screenshots/preview-390.png) | [1280](screenshots/preview-1280.png) | [320](screenshots/preview-320.png) |
| 空列表 | [390](screenshots/empty-cards-390.png) | [1280](screenshots/empty-cards-1280.png) | [320](screenshots/empty-cards-320.png) |
| 经历列表 | [390](screenshots/cards-390.png) | [1280](screenshots/cards-1280.png) | [320](screenshots/cards-320.png) |
| 正常信笺详情 | [390](screenshots/edited-card-390.png) | [1280](screenshots/edited-card-1280.png) | [320](screenshots/edited-card-320.png) |
| 来源强调 | [390](screenshots/source-390.png) | [1280](screenshots/source-1280.png) | [320](screenshots/source-320.png) |
| 长中文/长链接聊天 | [390](screenshots/long-chat-390.png) | [1280](screenshots/long-chat-1280.png) | [320](screenshots/long-chat-320.png) |
| 长中文/长链接详情 | [390](screenshots/card-390.png) | [1280](screenshots/card-1280.png) | [320](screenshots/card-320.png) |

已人工查看发现页手机/桌面、聊天最小宽度、正常信笺、窄屏预览、单字菜单与长内容详情，配合脚本边界检查核对。

## 约束与剩余验证

- 仅实施计划中已确定的参考设计原则；本轮没有交互操作参考站点，不能声称复刻或验证其真实交互。
- 真实模型回复质量、延迟和真实模型生成摘要未验证；本轮结果仅证明前端与替身服务的流程。
- 无连接的用户Chrome，使用独立无界面Chromium。未测试Safari、实体手机、软键盘弹出和实际底部安全区设备；CSS已处理dvh与safe-area，但不能替代真机证据。
- 三阶段实现及自动化检查完成，最终产品审阅、票据流转由项目经理负责；未提前关闭票据。

## 项目经理复核

已核对前端实际差异及更新后的手机聊天、320px消息菜单、桌面发现页与信笺详情截图，先前聊天截图错页问题已修正。

独立重跑 Node22 下 `npm test`（11/11）、`npm run build`、`git diff --check` 和完整浏览器脚本，均退出0。浏览器复核使用独立访客，截图输出到临时目录，避免覆盖交付截图。#1、#2、#3 按依赖顺序完成，委派已核验。

本轮可交付本地体验；上述真实模型、Safari及实体手机限制仍成立。预览服务保留在开发命令面板，使用测试回复与独立数据库。
