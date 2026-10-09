# 官方资料核查记录

核查日期：2026-10-09。未向模型服务提交请求，未使用真实密钥或产生费用。

## DeepSeek

主 API 文档 `https://api-docs.deepseek.com/` 在当前云端返回代理 HTTP 403。通过平台现有 GitHub HTTPS 认证读取 **DeepSeek 官方组织**维护的 `deepseek-ai/awesome-deepseek-integration`，固定版本 `94a834802fd1489db4ced41f3a23c669cb8644b1`：

- [llm.nvim 官方集成说明](https://github.com/deepseek-ai/awesome-deepseek-integration/blob/94a834802fd1489db4ced41f3a23c669cb8644b1/docs/llm.nvim/README_cn.md) 给出 `url = "https://api.deepseek.com/chat/completions"`、`model = "deepseek-chat"`、`api_type = "openai"`。
- [16x Prompt 官方集成说明](https://github.com/deepseek-ai/awesome-deepseek-integration/blob/94a834802fd1489db4ced41f3a23c669cb8644b1/docs/16x_prompt/README.md) 给出 `deepseek-chat` 与 `deepseek-reasoner` 模型标识。
- [思源官方集成说明](https://github.com/deepseek-ai/awesome-deepseek-integration/blob/94a834802fd1489db4ced41f3a23c669cb8644b1/docs/SiYuan/README_cn.md) 给出 `https://api.deepseek.com/v1/` 与 `deepseek-chat`。

据此确认基础接口兼容方向与默认标识。该仓库集成说明不等同于最新完整 API 契约：主文档的当前价格、限额、模型可用性和 reasoning 参数仍需在可访问后确认。实现不依赖特定 reasoning 参数，使用非流式 OpenAI 兼容 Chat Completions。所有默认模型可在设置中编辑。不把 mock 成功当成真实 API 调用通过。

## Wikinews 许可

从 Wikimedia 官方代码镜像 `wikimedia/operations-mediawiki-config` 核查：提交 `ab324f326fd7df4213ce2500bbdf3fcdcbeb4988` 的 [wmf-config/InitialiseSettings.php](https://github.com/wikimedia/operations-mediawiki-config/blob/ab324f326fd7df4213ce2500bbdf3fcdcbeb4988/wmf-config/InitialiseSettings.php) 中 `wgRightsUrl` 的 `wikinews` 默认值为 `https://creativecommons.org/licenses/by/4.0/`，配置注释说明 Wikinews 默认许可已按 T384614 改为 4.0。部分语言有不同覆盖，但英语不在这些覆盖中。

因此初版标注 **CC BY 4.0**。联网时使用 MediaWiki `meta=siteinfo&siprop=rightsinfo` 核对来源当时返回的许可；只接受明确的 CC BY 4.0 或历史 CC BY 2.5 URL，遇到未知许可停止正文下载。新闻没有随安装包预装；缓存文章保存自己当时核验的许可元数据。保留来源、贡献者署名、原文链接、许可链接，标明正文提取移除了导航与脚注。正文许可检查已用 fixture 测试，实际云端 API 仍被网络策略拒绝。

## 词典与经典

- [ECDICT](https://github.com/skywind3000/ECDICT/tree/bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b)：读取 README、原始 CSV 及 MIT 许可原文；固定内容 SHA-256 记录在 `assets/dictionary-provenance.txt`，生成脚本再次下载时会校验。
- [GITenberg Austen 电子版](https://github.com/GITenberg/Pride-and-Prejudice_1342/tree/81db45c9c48c592f0b77f01fc59e677ad0a5634e)：阅读电子版头部来源声明与附带 Project Gutenberg 完整许可，摘录 1813 年原作第一章并规范换行。许可原文在 `licenses/GUTENBERG.txt`。

## 所需网络域名

已保存到当前环境配置草稿的自定义域名：`en.wikinews.org`、`api-docs.deepseek.com`、`api.deepseek.com`；保留原有包管理器 / GitHub 预设。草稿保存不等于运行时策略生效，用户需在环境设置中审核、保存并发布后，再重试实际新闻抓取。

桌面 Windows 使用系统网络 / 代理配置，不受这里的云端草稿控制。自定义其他国内提供商时，用户需确保其地址支持兼容协议且可访问；没有写死外部付费凭据。
