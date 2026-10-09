# 初版验证记录

验证日期：2026-10-09。执行位置：云端 `/workspace/english-reader`；没有操作用户电脑。

## 已通过

| 检查 | 结果与实际范围 |
| --- | --- |
| `npm run typecheck` / 构建内 tsc | TypeScript 类型检查通过 |
| `npm run build` | React 生产构建及 Electron main / sandbox preload 构建通过 |
| `npm test` | 5 个测试文件、26 项测试通过，非零测试运行 |
| `DISPLAY=:99 npm run test:ui` | 2 条真实 Linux Electron 窗口端到端流程通过，真实 preload / IPC / SQLite，未替换为网页假后端 |
| `npm run licenses` | 29 个运行依赖许可核查通过，原文保留并进入应用包；开发依赖另有完整清单 |
| `npm audit --omit=dev --audit-level=high` | 运行依赖 0 个已知漏洞（查询时结果） |

### 单元与集成覆盖

- SM-2 风格排期：第一次 / 第二次成功间隔、遗忘 10 分钟重学、ease 下限、难易评分差异。
- 字数与估计难度、本地日期、规范词形；模型 URL 拒绝明文 HTTP、URL 凭据与异常地址。
- 真实离线 ECDICT 数据库、英汉释义、词形映射与未收录行为。
- 收藏幂等、例句来源、重复复习版本保护；SQLite 重开后进度、滚动位置、设置与排期保持。
- 完整备份恢复、无效 / 重复备份不丢失现有记录；断网保留缓存、文章 ID / URL 去重。
- Wikinews 协议 fixture（明确标注测试内容，不进入生产）：日期、许可、正文及大小验证；拒绝过期 / 撤稿 / 缺失日期 / 未知许可材料。
- 跨日刷新、当日成功后跳过、重复更新共享任务、取消后不提交结果、网络恢复强制重试及失败冷却。
- AI 使用 mock transport 验证兼容 URL、请求体、密钥缺失和 HTTP 错误隐藏响应体；没有付费调用。
- 系统加密接口 adapter 验证；拒绝 Linux basic_text 明文后端、删除密钥。不是 Windows DPAPI 实机验证。

### 无头界面实际流程

1. 启动 Electron，确认无新闻时显示空态与断网原因；打开真实 Austen 经典正文。
2. 点击 truth，展示英汉释义与音标；两次收藏仅产生一张卡片；无 API key 的 AI 功能给出配置提示。
3. 滚动保存进度；进入复习、显示答案、评分；关闭整个应用再打开，核对阅读进度和复习日期。
4. 通过界面创建完整备份、删除卡片、恢复备份并验证例句 / 排期，以及生成恢复前安全备份；导出 CSV 并检查包含词条。
5. 保存学习时长不发起 API 请求；取消原生文件对话框不修改数据；渲染器没有 Node require，未捕获界面脚本错误。

文件对话框在 UI 测试中用 Electron dialog stub 选择测试路径 / 取消结果；其余数据链路为真实实现。原生 Windows 对话框视觉与权限未测试。截图由该次测试生成，阅读截图附于 README。

## 真实网络检查：未通过

`DISPLAY=:99 node scripts/check-live-news.cjs` 用真实 Electron 网络层执行推荐更新，返回 `无法更新新闻：net::ERR_TUNNEL_CONNECTION_FAILED`，非成功抓取。Python 对同一域名以及 `api-docs.deepseek.com` 的 TLS 请求显示代理 403；未禁用 TLS / 签名 / 哈希验证，没有伪造新闻、没有用 fixture 掩盖结果。

当前环境草稿已添加 `en.wikinews.org`、`api-docs.deepseek.com`、`api.deepseek.com` 所需访问域名，保存草稿不会立即修改运行策略。用户在环境设置中审核、保存并发布后，可重新执行 `xvfb-run -a npm run test:live`；成功必须打印真实标题、日期、来源 URL 与许可。

DeepSeek 官方组织的 GitHub 集成文档可通过现有 Git 通道读取，已核对接口路径与默认标识，详见 API_REFERENCES.md。当前服务可用性 / 主 API 文档仍未实时核验，未录入密钥、未购买服务、未调用真实付费 API。

## Windows 打包与未测试项目

Electron Windows x64 程序目录 `release/win-unpacked` 已构建，包含应用 asar、SQLite WASM、离线词典、经典及第三方许可。Windows 运行所需原生 Electron 文件由 electron-builder 从官方发布渠道下载并按其工具链验证。

Linux 交叉构建 NSIS 安装器先因缺少 Wine 失败；在 `/tmp` 通过 Debian 签名包索引及包校验获取 Wine 后，仍因运行库初始化不完整失败。失败的 Setup.exe 是构建中间文件，不作为可用安装器分发。Windows 原生构建步骤及 CI 工作流已提供，但 CI 未在本次任务中运行。

`npm run dist:portable` 对应的 Linux 交叉构建已成功生成 Windows x64 便携 EXE（约 90 MB），无需 NSIS 卸载器的 Wine 执行步骤。检查 app.asar 确认包含 main / preload、SQLite WASM、词典、经典、THIRD_PARTY_NOTICES 和 29 份运行依赖许可。PE 签名目录为空，证实未签名；校验和保存在 release/SHA256SUMS.txt，文件不加入 Git 或公开发布。

没有 Windows 实机验证，以下均不宣称通过：原生启动、系统语音发音、DPAPI 加密、安装 / 卸载、SmartScreen 行为、Windows 日期 / 网络变化通知。初版未签名，不自动更新应用二进制，也不配置开机启动。
