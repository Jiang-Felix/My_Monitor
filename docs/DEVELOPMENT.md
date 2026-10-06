# 开发与验证

[返回 README](../README.md) · [贡献规范](../CONTRIBUTING.md) · [发布指南](RELEASING.md)

## 环境与启动

当前验证环境为 Windows x64、Node.js 24、npm。运行时使用 Electron 44.5.1，打包工具为 `@electron/packager` 20.3.0，依赖版本通过 `package-lock.json` 锁定。

```powershell
npm ci
npm start
```

第一次安装会下载 Electron 运行时，需要网络；只使用可信 npm / Electron 下载源，不要关闭 TLS 校验来处理代理问题。`npm start` 使用你的正常用户配置，可能访问已配置的网站；纯验证优先使用下面的隔离测试。

## 目录职责

```text
core/                  配置、数值解析、监控、告警、存储和资源预算
desktop/               Electron 窗口、IPC、网页选取、托盘、通知与启动设置
ui/                    HTML / CSS / JS 界面与正式应用素材
tests/                 Node 单元测试
scripts/               开发、隔离桌面测试、截图、打包和校验工具
docs/                  公开使用、开发和发布文档
.github/               CI、Issue / PR 模板与发布说明分类
release/<version>/     本地发行物，Git 忽略
artifacts/             本地测试输出，Git 忽略
```

本机 `docs/png/`、`docs/prompts.md`、`docs/concept-proposal.md`、`docs/superpowers/` 属于原始素材 / 设计草稿，不加入公开仓库。运行素材已在 `ui/assets/`，README 截图在 `docs/media/`，无需重复提交原始图片。

## 测试入口

```powershell
npm run check
npm test
npm run smoke
node scripts/run-web-security.mjs
node scripts/smoke.mjs --security-only
```

`check` 检查应用、脚本与测试的 JavaScript 语法。`test` 检查核心逻辑；`smoke` 启动本应用的 Electron 窗口，使用临时用户目录、本机模拟站点、替身托盘与启动设置，退出后清理临时目录。不会读取常规应用 profile；安全测试也使用模拟凭证。

原生 GUI 测试应顺序运行，避免窗口 / 桌面合成干扰，不要同时启动多套 smoke。每轮有超时保护；测试输出写入被忽略的 `artifacts/`。不要在受保护的生产监控任务中用自己的真实账户做自动化压力测试。

桌面测试默认抑制真实系统通知；不要无意添加 `--native-notification-probe` 等可产生真实副作用的探测参数。GitHub CI 运行语法和单元测试，桌面合成、透明度和真实认证兼容性仍需本地验证；CI 通过不等于所有网站都兼容。

## 更新展示媒体

```powershell
node scripts/smoke.mjs --docs-media-only
```

生成 `docs/media/` 中七张截图，使用固定模拟数据和用于展示的记录时间。不打开第三方网页、不发送系统通知、不访问真实登录状态。保持截图与 UI 同步；发布前手动检查不含账号、主机名、Token、Cookie 或私人 URL。

README 的品牌图直接引用 `ui/assets/Profile.png`、`LOGOPWB.png`；应用状态图标使用 mini-c / mini-w。截图保留 UI 原貌，不将演示值描述为真实采集结果。

## 打包与产物校验

```powershell
npm run package
node scripts/verify-package.mjs
```

输出由 `package.json` 的版本决定，例如 `release/0.1.0/MyMonitor-win32-x64/`。打包脚本会重建 ICO，复用安装的 Electron 校验信息，包含运行源代码、README、项目许可证以及品牌素材，排除测试、设计文档、Git 元数据和 GitHub 配置。

`verify-package` 比较 ASAR 内的运行文件与源码 SHA-256，并核对运行入口、版本、许可证、作者、仓库元数据。原生浮窗校验：

```powershell
node scripts/run-packaged-floating.mjs
```

该检查使用自己的临时 profile 和模拟 IPC，验证打包后透明度 / 尺寸；不会启动用户的正常监控配置。启动器等待进程退出并清理临时目录，120 秒超时仅终止自己的测试进程。打包脚本可接受输出目录参数，但发布时使用默认版本目录，避免混淆。

最终 ZIP 与校验文件可使用：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release.ps1
```

该命令仅为当前进程允许执行仓库内已审阅脚本，不更改机器执行策略；也可在已允许本地脚本的 PowerShell 中直接运行 `./scripts/release.ps1`。脚本不会提交 / 推送 / 发布。ZIP 只能在源码校验和打包完成后生成，已存在的 ZIP 会阻止覆盖。

## 本地与 CI 边界

CI 权限只读，使用固定 SHA 的官方 checkout / setup-node；不包含发布令牌、不自动上传安装包或更改远端仓库。依赖更新通过 Dependabot PR 提议，仍需测试和人工审阅。

应用的凭证存储、网络限制和本地备份不能因调试方便而移除。详细约束见 [SECURITY](../SECURITY.md)。
