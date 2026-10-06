# 发布与仓库维护指南

[返回 README](../README.md) · [版本更新记录](../CHANGELOG.md) · [v0.2.0 发布正文](releases/v0.2.0.md)

## 本次发布：v0.2.0

远端已有 `main` 和 `v0.1.0`。本次新增低占用模式并优化浮窗 / 待机，因此提升次版本到 `0.2.0`；不要覆盖旧标签或附件。当前本地发行物是待提交源码生成的候选包，GitHub 尚需维护者发布。

### 提交这轮变更

在 `D:\Projects\Data-Monitor` 执行：

```powershell
git status --short
git diff --stat
git add .
git diff --cached --check
git diff --cached --stat
git diff --cached --name-only
git commit --file docs/releases/v0.2.0-commit.txt
git push origin main
```

应提交源码、测试、版本 / 锁文件、公开文档及模拟截图；发行物、测试输出和用户数据继续由 `.gitignore` 排除。不要使用 `git add -f`。`origin` 已配置，无需再添加。如果 `main` 要求 PR，提交前用 `git switch -c release/v0.2.0` 创建分支，推送该分支并合并 PR。

提交后确认 `git status --porcelain` 没有输出，并到 Actions 确认该提交的 `Windows checks` / `check-and-test` 成功。如果提交后修改了源码或媒体，重新提交、重建和校验。

### 复核包与标签

```powershell
node scripts/verify-package.mjs
node scripts/run-packaged-floating.mjs
Get-FileHash -Algorithm SHA256 .\release\0.2.0\MyMonitor-v0.2.0-windows-x64.zip
git log -1 --oneline
git tag -a v0.2.0 -m "My Monitor v0.2.0 web compatibility and idle memory preview"
git push origin v0.2.0
```

假设已推送与包一致的提交，且 `v0.2.0` 尚不存在。使用 PR 时合并后切回 `main`、`git pull --ff-only`，再校验 / 重建并打标签，使标签指向实际发布提交。ZIP 哈希应与 `release/0.2.0/SHA256SUMS.txt` 一致。

若需从干净提交重建，先将候选 ZIP 移到忽略的 `artifacts/` 下保留，再运行 `npm run package`、`node scripts/verify-package.mjs` 和 `./scripts/release.ps1`。ZIP 脚本不覆盖已有压缩包；不要覆盖正在运行的软件目录。

### 在 GitHub 发布

打开 **Releases → Draft a new release**，选择 `v0.2.0`：

1. 标题：`v0.2.0 · 网页兼容性与待机优化`。
2. 正文：复制 [v0.2.0.md](releases/v0.2.0.md)，核对升级提示及验证范围。
3. 上传 `release/0.2.0/MyMonitor-v0.2.0-windows-x64.zip` 和 `SHA256SUMS.txt`。
4. 勾选 **This is a pre-release**；先保存草稿核对，再发布。`0.x` 不会自动设置 GitHub 预览状态。
5. 发布后下载附件核对 SHA-256，检查 README、版本徽章、图片、使用说明及 Release 链接。

GitHub 自动提供的 Source code ZIP / tar.gz 是源码，用户应下载 Windows 附件。如果开启不可变发布，应在草稿中上传齐全；发布后不能替换附件或移动标签。[GitHub Release 官方说明](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)。

### 发布后维护

- 保留 `v0.1.0` 历史 Release 和标签；本地旧发行物归档到忽略的 `artifacts/release-archive/`，`release/` 保留当前候选版本。
- 建立 `v0.2.0` milestone，关闭确实解决的已有问题并注明版本；新问题放进 `v0.2.1`（修复）或 `v0.3.0`（功能）。没有对应 Issue 时无需补造。
- 缺陷报告提供版本、复现、低占用模式、来源数量和窗口状态；截图脱敏。内存报告注明口径和等待时间，安全问题走私密报告。
- 在 `CHANGELOG.md` 的 Unreleased 中积累下一版变更；发布时同步版本 / 锁文件、README、使用说明、发布正文和媒体。已公开程序变更要发新版本，不能覆盖旧标签。
- Generate release notes 收集合并的 PR；本次直接提交仍以手写正文为准，不把空白自动说明当作更新记录。[GitHub 自动发布说明](https://docs.github.com/en/repositories/releasing-projects-on-github/automatically-generated-release-notes)。

## 版本编号规则

版本以 `package.json` 为准，`package-lock.json` 保持一致，UI 从应用版本读取。Git 标签增加 `v` 前缀，发布附件包含相同版本。

| 用途 | 当前版本示例 |
| --- | --- |
| 应用与 npm manifest | `0.2.0` |
| Git 标签 | `v0.2.0` |
| GitHub Release 名称 | `v0.2.0 · 网页兼容性与待机优化` |
| 本地发行目录 | `release/0.2.0/` |
| 用户下载附件 | `MyMonitor-v0.2.0-windows-x64.zip` |

采用 [Semantic Versioning](https://semver.org/) 的 `MAJOR.MINOR.PATCH` 结构：当前版本之后补丁修复用 `0.2.1`，新增功能用 `0.3.0`；`0.x` 为早期开发阶段，破坏兼容的变化也提升次版本并给出迁移说明。达到明确稳定兼容承诺后发布 `1.0.0`；此后破坏兼容提升主版本。未来同一版本的候选版可用 `0.3.0-beta.1`、`0.3.0-rc.1`，各文件和标签同步。

当前应用版本为 `0.2.0`，下一次补丁可用 `0.2.1`，新增功能可用 `0.3.0`。建议在 GitHub 勾选 **This is a pre-release**；`0.x` 编号不会自动代替该选项。没有发布过的内部构建不需要每次递增；已经公开的版本和标签不能移到别的提交，修复后发布新版本。

## 历史参考：第一次 Git 提交

### 1. 在 GitHub 创建空仓库

账号 `Jiang-Felix`，仓库名 `My_Monitor`。选择 Public；创建时不要自动添加 README、LICENSE、gitignore，本地已有完整文件，避免产生另一条初始历史。如果仓库已存在且有提交，先查看其内容并用分支 / PR 合并，不要强制覆盖。

仓库 About 描述可用：

> Local desktop monitor for web metrics, range alerts and a translucent floating overlay. Windows · Chinese / English.

Topics 建议：`electron`、`windows`、`desktop-app`、`monitoring`、`alerts`、`local-first`、`floating-window`。Website 可填仓库或 Release 页面，目前无需额外站点。

### 2. 核对提交身份与文件

在项目根目录执行：

```powershell
git status --short
git config --get user.name
git config --get user.email
git remote -v
```

若要保护私人邮箱，从 GitHub Settings → Emails 复制自己的 no-reply 地址，再以仓库级设置替换下面占位内容：

```powershell
git config user.name "Felix_Jiang"
git config user.email "你在 GitHub Emails 中的 no-reply 地址"
```

邮箱需要与你的 GitHub 账户关联，Git 提交作者邮箱会进入公开历史。[GitHub 提交邮箱说明](https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address)。

应提交源码、测试、脚本、锁文件、公开媒体、许可证及 `.github/`；**不要用 `git add -f` 绕过忽略规则**提交发行包、node_modules、测试输出、草稿或登录资料。

```powershell
git add .
git diff --cached --stat
git diff --cached --check
git diff --cached --name-only
```

检查没有私人配置、Token、Cookie、真实截图和大体积 exe / ZIP。当前默认忽略发行目录；二进制只作为 Release 附件上传。若误暂存新文件，可用 `git rm --cached -- 文件路径` 移出索引，文件仍保留本地。

### 3. 提交与推送

首次提交标题建议 **`feat: initial release of My Monitor v0.1.0`**。该提交包含应用本身，所以用 `feat`；后续仅调整发布文档可用 `docs` 或 `chore`。

多行正文已经放在 [first-commit-message.txt](first-commit-message.txt)，可直接使用：

```powershell
git commit --file docs/first-commit-message.txt
git branch -M main
git remote add origin https://github.com/Jiang-Felix/My_Monitor.git
git push -u origin main
```

这里假设 remote 为空，且 GitHub 是空仓库；若已有 `origin`，先核对 `git remote -v`，不要重复添加或未经核对修改。HTTPS 登录通常通过 Git Credential Manager 浏览器授权完成；不要把访问令牌写进 remote URL 或脚本。也可使用已配置的 SSH remote。

上传完在 GitHub 检查 README 图片、MIT 识别、文档链接和 Actions 结果。检查发现凭证时先撤销凭证，再处理历史；不能只删除新版本文件就视为清除泄露。

## 本地发行包

先完成 [开发验证](DEVELOPMENT.md#测试入口)，随后：

```powershell
npm run package
node scripts/verify-package.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release.ps1
```

打包以当前工作区为输入。公开版本必须从干净、已提交的工作区重建；首次准备包可用于检查，但提交后若源文件 / 媒体改变，请重新打包。初次提交后重新生成 ZIP 时，先将旧 ZIP 移到仓库外备用，再运行脚本；脚本不覆盖既有发布附件。

`release/<version>/` 保留这一候选版的应用目录、ZIP、`SHA256SUMS.txt` 和发布正文。发布附件只上传 ZIP 与 SHA256SUMS，发布正文粘贴到 Release 描述。Windows 包中保留项目 `LICENSE`、Electron `LICENSE` 与 `LICENSES.chromium.html` 等第三方声明，不能删除。

本地 `release/` 可按需清理旧构建；已发布 GitHub Release、标签和源码历史用于保留公开版本，不随本地清理删除。

## 历史参考：首次发布 v0.1.0

先确认 `main` 的 CI 通过，提交与本地包对应。在本地标记该提交：

```powershell
git tag -a v0.1.0 -m "My Monitor v0.1.0 first public preview"
git push origin v0.1.0
```

仓库页面点击 **Releases → Draft a new release**：

1. Choose a tag 选择 `v0.1.0`；已存在的标签必须指向确认的发布提交。
2. Title 填 `v0.1.0 · 首个公开预览版`。
3. Describe this release 粘贴 [发布正文](releases/v0.1.0.md)，也可补充最终验证结果。
4. 附件区上传 `MyMonitor-v0.1.0-windows-x64.zip` 和 `SHA256SUMS.txt`。
5. 勾选 **This is a pre-release**。预览版不主动设为稳定 Latest；README 的 Releases 链接可看到预览版。
6. 先 Save draft 核对附件、版本和链接，完成后 Publish release。

GitHub 自动生成的 Source code (zip / tar.gz) 是源代码，不是用户可直接运行的软件。ZIP 的 SHA-256 可由用户这样核对：

```powershell
Get-FileHash -Algorithm SHA256 .\MyMonitor-v0.1.0-windows-x64.zip
```

若启用 immutable releases，先草稿上传齐全再发布，发布后不可替换资产或移动标签。[GitHub Release 官方说明](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)。

## Issues、贡献与安全配置

在仓库 **Settings → General → Features** 开启 Issues。提交到默认分支后，`.github/ISSUE_TEMPLATE/` 会提供缺陷 / 功能表单；用户点击 New issue 验证表单是否出现。

在 **Issues → Labels** 检查 `bug`、`enhancement`；可另建 `question`、`documentation`、`good first issue`、`help wanted`、`security`。模板自动标签只对已存在标签生效。使用 Milestones 建立 `v0.2.1` / `v0.3.0`，关联待修复 Issue，关闭时注明修复版本；Projects 看板和 Discussions 按实际需要开启即可。

PR 模板及贡献规范已提供。给发布工作和每项修改关联 Issue / PR，正文用 `Fixes #编号` 仅在确实解决对应 Issue 时使用。不要在公开 Issue 报告安全漏洞详情。

在 **Settings** 左侧的 **Security and quality → Advanced Security** 中，对 Private vulnerability reporting 点击 Enable，之后在仓库 Security → Advisories 中私下处理漏洞。`SECURITY.md` 已给出报告方式。GitHub 官方入口与条件见 [私密漏洞上报](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository)。

`.github/workflows/ci.yml` 会在 push / PR 运行 Windows 语法及单元检查；首次上传后到 Actions 确认 `Windows checks` 成功。Dependabot 按月提议 npm / Actions 依赖更新，审阅测试后再合并，不自动发布。

如有协作者，可在 Settings → Rules → Rulesets 中为默认分支配置 PR 与必需状态检查，选择 `check-and-test`，并阻止强制推送。先让 CI 至少运行一次，再选择检查名称；个人维护不要设置没有可用审阅者的强制审批数。

## 后续更新与发布节奏

1. 在独立分支开发，补充测试与 `CHANGELOG.md` 的 Unreleased 条目；Issue 标明版本 / 复现步骤。
2. 用 `npm version patch --no-git-tag-version` 或 `npm version minor --no-git-tag-version` 更新 manifest 和锁文件；该命令此处不创建 Git 标签。
3. 将 Unreleased 变更整理成新版本与发布日期，新增 `docs/releases/v版本.md`，更新 README 版本徽章 / 下载文件名与截图。
4. 完成核心、桌面、网页安全测试，核对启动 / 托盘 / 透明度。涉及配置变化时说明备份、迁移及回退限制。
5. 提交修改，推送并等 CI，通过后从对应干净提交构建版本目录，核对 ASAR 和用户 ZIP、许可证、校验值。
6. 创建新的注释标签和 GitHub Release。公开版本保持不变；需要修正程序时发补丁版本。

提交标题推荐 `feat:` 新功能、`fix:` 修复、`docs:` 文档、`test:` 测试、`chore:` 工具 / 依赖。提交消息描述改了什么；Release 描述面向用户，讲新增、修复、注意事项和升级方法。

`.github/release.yml` 提供按标签分类的自动发布说明。后续可用 Generate release notes 收集 PR；仍需维护者核对用户影响、已知问题和升级步骤，`CHANGELOG.md` 保持仓库内的长期记录。[GitHub 自动发布说明](https://docs.github.com/en/repositories/releasing-projects-on-github/automatically-generated-release-notes)。
