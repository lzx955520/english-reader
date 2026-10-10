import type { Feature, ModelConfig } from "../src/types";

// Process memory only. Never serialize this into settings or backups.
export class SessionConsent {
  enabled = false;
  revision = 0;
  grant(expectedRevision: number) {
    if (expectedRevision !== this.revision) return false;
    this.enabled = true;
    this.revision++;
    return true;
  }
  revoke() { this.enabled = false; this.revision++; }
}

const labels: Record<Feature, string> = {
  context: "语境释义：所选单词或短语及当前段落",
  grammar: "语法分析：所选文本及周围段落",
  selection: "新闻筛选：已缓存新闻的编号、标题、词数、难度、发布日期",
};
export function consentDetails(models: Partial<Record<Feature, ModelConfig>>) {
  return (Object.keys(models) as Feature[]).map(feature => {
    const config = models[feature]!;
    return `${labels[feature]}\n提供商：${config.provider}\n模型：${config.model}\n接收接口：${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  }).join("\n\n");
}

// Keep native Windows dialogs bounded; the actual immutable request remains whole.
export function consentPreview(text: string) {
  return text.length <= 350 ? text : `${text.slice(0, 350)}…\n（预览前 350 字符，将发送完整 ${text.length} 字符）`;
}
