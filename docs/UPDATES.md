# 软件更新和构建产物（0.3.0）

## 当前状态

- 源码与安装包均公开。软件更新源固定为同一仓库的 [GitHub Releases](https://github.com/lzx955520/english-reader/releases)，不使用其他发布仓库。
- 推荐 Windows x64 NSIS 安装包，保留便携启动器。
- 应用标识仍为 `com.englishreader.desktop`，包名称仍为 `english-reader`；用户数据目录和现有学习数据不迁移、不重置。
- 检查版本只读取固定公开发布源。尚无正式发布时显示没有可用发布，不将 404 视作成功发现新版本。
- 检查版本不会下载或安装。下载需要单独确认，并验证大小和 SHA-256；校验通过后只显示下载文件的位置，安装程序由用户自行运行。
- CI 仅生成 GitHub Actions 构建产物，保留 7 天。本工作流没有创建 GitHub Release 的步骤，没有增加发布权限、发布凭据或自动执行安装器的能力。
- 阅读材料刷新与软件版本更新彼此独立。

## 构建

```powershell
npm ci
npm run test:package
npm run dist:win
```

输出仅上传以下四个构建文件：

- `English-Reader-0.3.0-x64-Setup.exe`
- `English-Reader-0.3.0-x64-Portable.exe`
- `update-manifest.json`
- `SHA256SUMS.txt`

`npm run dist:portable` 只生成便携包及其校验和，不生成安装版更新清单。Linux 目录构建仍可使用 `npm run dist:linux`。

清单结构固定为：

```text
schemaVersion: 1
version: 0.3.0
platform: win32
arch: x64
installer:
  name: English-Reader-0.3.0-x64-Setup.exe
  size: 实际安装包的整数字节数
  sha256: 实际安装包的64位小写SHA-256
```

实际文件为 JSON，由安装包计算生成。清单没有任意下载 URL、本机路径、访问令牌或提交身份。校验和文件仅列出安装包、便携包和生成的清单，不包含源码或构建调试元数据。SHA-256 验证文件一致性，不替代代码签名与发布源信任。

## 打包边界与隐私检查

`package:prepare` 在 `release/app` 重新组装运行目录。只复制前端构建文件、主进程和 preload 构建文件、固定词典/经典材料、必要许可证，以及 sql.js 的运行 JS/WASM。运行 package.json 仅保留必要字段；sql.js 保持既有外部模块路径。其他运行依赖已在 Vite/esbuild 产物中合并，其许可证仍完整保留。

README、docs、source map、开发依赖清单、源码目录、环境文件、用户数据库/备份、密钥文件、测试记录和构建元数据不在运行目录白名单中。Electron/Chromium 自带许可证保留。源码公开不代表允许将用户个人数据或凭据打入安装包。

隐私检查同时验证暂存目录和实际 app.asar（含解包文件）。意外文件、缺失声明、已知凭据模式、疑似硬编码密钥和私人本机路径会使构建失败；仅记录通用失败信息，不输出文件内容或匹配到的值。动态读取并发送用户授权 API 密钥的代码不等于硬编码密钥。它是启发式防线，不能保证发现所有秘密；发布前仍须人工审核。Electron 应用分发可执行的 JavaScript/WASM，构建文件可以被解包分析。

## 正式发布与升级前检查

1. 人工审查安装包、便携包、最小清单和校验和，确认没有用户数据或凭据。
2. 在 Windows 10/11 x64 实机验证：安装、启动、DPAPI 密钥读取、本地发音、旧版升级后的文章/进度/生词/设置保留，以及更新流程的取消、重复操作、离线和失败情况。
3. 从旧版升级前，用设置中的完整备份功能保存学习数据；关闭旧版再运行 NSIS。便携版的数据仍在同一 Windows 用户目录，不随 exe 迁移。
4. 核实版本号、安装包名称、大小与 SHA-256，确认新旧版本使用相同应用身份。
5. 将审查通过的构建文件放入同一仓库对应版本的正式 Release；不得用 Actions 构建成功代替正式发布成功。本 CI 工作流不执行上传到 Release 的步骤。
6. 从公开发布页重新核实清单与安装包可访问且一致后，才能宣称该版本已发布。

未经代码签名的产物可能触发 SmartScreen。不要关闭或规避系统安全检查。CI 通过不等于 Windows 实机升级验证完成。


### 0.3 依赖与验证安全提示

2026-10-10 的 npm audit 报告仍有 13 项已知依赖发现（2 critical、2 high、9 moderate）。审计任务仅保存报告，绿色任务不代表漏洞为零；本次没有擅自升级依赖。此未签名预览版不应被视为已完成生产安全审查。Windows 原生安装、DPAPI、语音和从旧版安装升级的数据保留仍未实机验证；离线模拟测试与 CI 构建不能替代这些检查。不要关闭或绕过 SmartScreen，应用不会自动执行安装程序。
