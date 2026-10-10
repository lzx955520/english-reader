import * as checker from "license-checker-rseidelsohn";
import fs from "node:fs";
import path from "node:path";
const result = await new Promise((resolve, reject) =>
  checker.init(
    { start: process.cwd(), production: true, excludePrivatePackages: true },
    (error, data) => (error ? reject(error) : resolve(data)),
  ),
);
fs.mkdirSync("licenses/dependencies", { recursive: true });
let notices =
  "# 第三方软件与内容许可\n\n生成自当前锁文件。原文许可保存在 `licenses/dependencies/`，并随安装包分发。\n\n";
for (const [name, item] of Object.entries(result)) {
  if (
    !/^(MIT|ISC|BSD-2-Clause|BSD-3-Clause|Apache-2.0|CC0-1.0|0BSD|Python-2.0|\(MIT OR CC0-1.0\))$/.test(
      String(item.licenses),
    )
  )
    throw Error("Review dependency license: " + name + " " + item.licenses);
  notices += `- **${name}** — ${item.licenses}; ${item.repository || "see package metadata"}\n`;
  if (item.licenseFile && fs.existsSync(item.licenseFile))
    fs.copyFileSync(
      item.licenseFile,
      path.join(
        "licenses/dependencies",
        name.replace(/[^a-zA-Z0-9_.-]/g, "_") + ".txt",
      ),
    );
  else throw Error("License text missing: " + name);
}
notices +=
  "\n## 桌面运行时\n\nElectron 39：MIT；包含 Chromium、Node.js 等第三方组件，其 LICENSE 与 LICENSES.chromium.html 由 electron-builder 保留在安装包内。构建工具不随应用分发；开发依赖完整许可证清单见 licenses/development.json。\n";
notices +=
  "\n## 词典\n\nECDICT（skywind3000/ECDICT）：上游仓库声明 MIT。保留 licenses/ECDICT-MIT.txt；固定提交、原始 CSV SHA-256 和筛选条件见 assets/dictionary-provenance.txt。48,185 个词条及词形映射，仅按原始字段筛选，未修改释义。上游说明词条来自多个历史词典及贡献，MIT 为仓库声明，不代表对每条历史来源作独立权利担保。\n";
notices +=
  "\n## 阅读内容\n\nWikinews 英语已发布文章：CC BY 4.0（https://creativecommons.org/licenses/by/4.0/）。应用保留标题、作者署名、来源永久链接、日期和许可链接，正文未经改写，不抓取付费内容。不下载图片。正文提取移除页面导航与引用脚注；原文完整版本见来源页。\n\nJane Austen, Pride and Prejudice, chapter 1, 1813：原作公版；来自 GITenberg/Project Gutenberg ebook 1342。保留完整 Project Gutenberg 许可与来源声明于 licenses/GUTENBERG.txt。电子版镜像提交：81db45c9c48c592f0b77f01fc59e677ad0a5634e；仅摘录第一章并规范换行。应遵循所在地区的公版及 Project Gutenberg 条款。\n";
notices += "\n## 0.2 新阅读来源与显示变化\n\nNIH Research Matters：NIH 自有文本一般为公有领域，明确另有版权者排除。政策 https://www.nih.gov/about-nih/frequently-asked-questions ，订阅 https://www.nih.gov/nih-research-matters/feed.xml 。\n\nNSF News：自有网页文本可复制再用，明确版权材料排除。政策 https://www.nsf.gov/policies/digital ，订阅 https://www.nsf.gov/rss/rss_www_news.xml 。\n\nGlobal Voices：CC BY 3.0，https://creativecommons.org/licenses/by/3.0/ ，署名政策 https://globalvoices.org/about/global-voices-attribution-policy/ 。每篇保留作者、来源永久链接与许可；另有转载或版权声明的内容保守跳过。\n\n以上来源均不下载图片或其他媒体，不暗示官方认可。正文只提取阅读段落并规范空白，导航、参考列表等省略；原版见来源链接。可关闭的中文括注来自 ECDICT，属于本应用添加的学习注释，不是原作者文字；原文仍单独保存。AI 输出若用户单次授权请求则另行显示，不替换来源正文。\n\n打包词典沿用 0.1 的 48,185 条子集，其数据库没有 CET / 词频列。当前自动括注是稀疏启发式，不是官方六级排除表。重建脚本现保留原始 tag / BNC / frequency / Oxford 元数据，只有用固定数据正式重建后这些列才存在；此版未重新下载或生成词典。\n";
fs.writeFileSync("THIRD_PARTY_NOTICES.md", notices);
const dev = await new Promise((resolve, reject) =>
  checker.init(
    { start: process.cwd(), excludePrivatePackages: true },
    (error, data) => (error ? reject(error) : resolve(data)),
  ),
);
fs.writeFileSync(
  "licenses/development.json",
  JSON.stringify(
    Object.fromEntries(
      Object.entries(dev).map(([name, item]) => [
        name,
        { licenses: item.licenses, repository: item.repository },
      ]),
    ),
    null,
    2,
  ),
);
console.log(
  "Production licenses checked and retained:",
  Object.keys(result).length,
);
