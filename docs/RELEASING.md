# 首次上传与后续发布指南

[返回 README](../README.md) · [版本更新记录](../CHANGELOG.md) · [v0.1.0 发布正文](releases/v0.1.0.md)

## 版本编号规则

版本以 `package.json` 为准，`package-lock.json` 保持一致，UI 从应用版本读取。Git 标签增加 `v` 前缀，发布附件包含相同版本。

| 用途 | 首次版本示例 |
| --- | --- |
| 应用与 npm manifest | `0.1.0` |
| Git 标签 | `v0.1.0` |
| GitHub Release 名称 | `v0.1.0 · 首个公开预览版` |
| 本地发行目录 | `release/0.1.0/` |
| 用户下载附件 | `MyMonitor-v0.1.0-windows-x64.zip` |

采用 [Semantic Versioning](https://semver.org/) 的 `MAJOR.MINOR.PATCH` 结构：补丁修复用 `0.1.1`，新增功能用 `0.2.0`；`0.x` 为早期开发阶段，破坏兼容的变化也提升次版本并给出迁移说明。达到明确稳定兼容承诺后发布 `1.0.0`；此后破坏兼容提升主版本。未来同一版本的候选版可用 `0.2.0-beta.1`、`0.2.0-rc.1`，各文件和标签同步。

首次应用已有 `0.1.0`，准备文档不改变版本。建议在 GitHub 勾选 **This is a pre-release**；`0.x` 编号不会自动代替该选项。没有发布过的内部构建不需要每次递增；已经公开的版本和标签不能移到别的提交，修复后发布新版本。

## 第一次 Git 提交

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

## GitHub Release：发布 v0.1.0

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

在 **Issues → Labels** 检查 `bug`、`enhancement`；可另建 `question`、`documentation`、`good first issue`、`help wanted`、`security`。模板自动标签只对已存在标签生效。使用 Milestones 建立 `v0.1.1` / `v0.2.0`，关联待修复 Issue，关闭时注明修复版本；Projects 看板和 Discussions 按实际需要开启即可。

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
