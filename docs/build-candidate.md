# 可复现构建候选

本流程只准备本地待验候选，不提供部署、发布、推送或生产参数授权。源码版本用工作树文件摘要标识；Git HEAD仅作基点，未提交改动不能标成该HEAD的已提交版本。

## 固定输入

- `.nvmrc`固定本轮验证的Node22.23.5；package.json仍声明兼容下限，不升级原有根依赖版本。
- `package-lock.json`为npm10.9.9生成的lockfileVersion 3，根依赖仍为原精确版本，转递依赖由锁和integrity固定；未运行npm update/audit fix或大版本升级。
- `scripts/candidate-files.json`精确列出候选文件；包含清单脚本自身、锁、版本文件、配置模板、服务端/前端、测试、操作脚本与稳定产品/操作文档。`prototype/index.html`仅作为原型源文件保留，不属于Vite构建入口。
- 不含真实.env、邀请/密钥文件、运行目录、SQLite/数据、node_modules、dist、Git元数据或任何docs/verification输出（包括历史截图）。校验报告不递归参与自身摘要。
- 只允许正规文件，拒绝符号链接；server/src/scripts/tests中新源码必须显式更新清单，避免静默漏包。白名单不能自动判断源码内容是否误写秘密，生产前仍按既定秘密注入边界审阅；本轮没有读取真实.env。

## 摘要规则

每文件记录POSIX相对路径、字节长度、原始字节SHA-256，按路径ASCII/UTF-16顺序排序；源码摘要为该文件记录数组紧凑JSON（无末尾换行）的SHA-256。构建产物用同一规则，对dist中的全部html/css/js逐文件记录并再聚合。两套摘要相互独立，构建产物不混入源码。

输出schemaVersion=1；source.kind=working-tree-snapshot，versionLabel明确未提交工作树；baseCommit只记录上下文，不参与源码摘要。副本没有.git时baseCommit为空，不影响逐文件及摘要核验。Node必须精确匹配.nvmrc。

这提供内容校验而非数字签名或来源认证。平台/架构及Node记录在报告中，本轮只证明同一macOS arm64、Node22.23.5/npm10.9.9环境的重复构建；不宣称跨OS/架构产物必然逐字节相同。

## 干净临时副本

在仓库根目录切换正确Node（本机可用nvm use），检查`node --version`与`npm --version`。以下命令使用新的外部临时目录，不使用共享node_modules、不复制已有数据或启动服务：

```sh
candidate_dir=$(mktemp -d)
node scripts/candidate-manifest.mjs --copy-to "$candidate_dir/work" > "$candidate_dir/source.json"
cd "$candidate_dir/work"
npm ci --include=dev --no-audit --no-fund
npm test
npm run build
node scripts/candidate-manifest.mjs --dist-root "$candidate_dir/work/dist" > "$candidate_dir/candidate.json"
node scripts/candidate-manifest.mjs --dist-root "$candidate_dir/work/dist" --verify "$candidate_dir/candidate.json"
```

`--copy-to`目标必须位于源码树外且尚不存在；复制后再次计算快照摘要，复制中源码变化会拒绝，失败快照不可当候选。安装和构建输出仅写临时副本；所有服务测试使用临时合成数据库。命令不会改动原库、服务或配置。下载依赖需要可达锁文件中的registry；本轮锁的resolved均为registry.npmjs.org的HTTPS地址，无认证信息/查询串。

候选复制后，在原仓库也可对照副本产物确认对应相同工作树：

```sh
node scripts/candidate-manifest.mjs --root /absolute/source/repository --dist-root "$candidate_dir/work/dist" --verify "$candidate_dir/candidate.json"
```

原工作树任何已列文件发生变更，校验失败，需要新候选。构建后的依赖、产物或日志不会改变源码摘要。再次运行`npm run build`后用原candidate.json核验，可确认本轮同环境重复构建的产物一致。

可选界面检查（Playwright通过外部安装提供，不加入项目依赖）：

```sh
PLAYWRIGHT_MODULE=/absolute/external/playwright/index.mjs node scripts/verify-access-ui.mjs
```

该脚本加载当前副本dist并拦截合成HTTP，证明对应构建的邀请输入及403/429/503交互；不证明API、真实模型、Cookie/HTTPS反代、部署或真实费用的全链路可用。

## 候选记录与闸门

最终实际文件清单/哈希保存在`docs/verification/build-candidate.json`；证据与环境输入见`docs/verification/build-candidate.md`，两者均排除于源码清单之外，允许记录摘要而不造成自引用。清单脚本输出比对仅验证source/artifacts，基点与平台元数据供审阅。

仍需：受控策略和目标环境批准、真实模型、owner真机/Safari、目标HTTPS/代理与备份恢复。三闸门是项目经理同候选双视口+哈希、owner同候选真机、owner群内点名同一具体版本；本地安装/构建通过不会替代三项批准。
