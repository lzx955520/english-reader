export type Article = {
  id: string;
  title: string;
  source: string;
  url: string;
  published: string;
  fetchedAt: string;
  kind: "news" | "classic";
  license: string;
  licenseUrl: string;
  author: string;
  text: string;
  words: number;
  minutes: number;
  difficulty: string;
  progress: number;
  position: number;
};
export type Definition = {
  tag?: string;
  bnc?: number;
  frq?: number;
  oxford?: number;
  word: string;
  phonetic: string;
  definition: string;
  translation: string;
  pos: string;
  found: boolean;
  source: string;
};
export type Card = {
  id: string;
  word: string;
  meaning: string;
  example: string;
  articleId: string;
  sourceTitle: string;
  sourceUrl: string;
  createdAt: string;
  due: string;
  interval: number;
  ease: number;
  repetitions: number;
  lapses: number;
  version: number;
};
export type Feature = "context" | "grammar" | "selection";
export type ModelConfig = {
  provider: "deepseek" | "compatible";
  baseUrl: string;
  model: string;
  hasKey?: boolean;
};
export type Settings = {
  dailyMinutes: number;
  inlineGlosses?: boolean;
  models: Record<Feature, ModelConfig>;
};
export type State = {
  articles: Article[];
  cards: Card[];
  settings: Settings;
  lastRefresh: string;
  refreshError: string;
  todayMinutes: number;
  storagePath: string;
  sourceDiagnostics?: SourceDiagnostic[];
};
export type AIRequest = {
  feature: Feature;
  text: string;
  context?: string;
  approved: boolean;
  operationId: string;
};
export interface ReaderAPI {
  state(): Promise<State>;
  refresh(force?: boolean): Promise<{ added: number; cancelled?: boolean }>;
  cancel(id: string): Promise<void>;
  lookup(word: string): Promise<Definition>;
  glosses(articleId: string): Promise<Record<string, { lemma: string; translation: string }>>;
  progress(id: string, progress: number, position: number): Promise<void>;
  saveCard(input: {
    word: string;
    meaning: string;
    example: string;
    articleId: string;
  }): Promise<Card>;
  review(id: string, rating: 0 | 3 | 4 | 5, version: number): Promise<Card>;
  deleteCard(id: string): Promise<void>;
  saveSettings(
    settings: Settings,
    keys: Partial<Record<Feature, string>>,
  ): Promise<void>;
  ai(request: AIRequest): Promise<string>;
  backup(): Promise<boolean>;
  restore(): Promise<boolean>;
  exportCards(): Promise<boolean>;
  openSource(url: string): Promise<void>;
  trackMinutes(seconds: number): Promise<void>;
}
declare global {
  interface Window {
    reader: ReaderAPI;
  }
}

export type SourceDiagnostic = {
  id: string; name: string; url: string;
  status: "updated" | "no-new" | "filtered" | "failed";
  lastAttempt: string; lastSuccess: string;
  candidates: number; added: number; duplicates: number; filtered: number;
  failures: number; cached: number; message: string;
};
