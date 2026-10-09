import initSqlJs, { type Database } from "sql.js";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { defaults, localDay, normalizeWord, schedule, analyze } from "./domain";
import { backupSchema, settingsSchema } from "./schemas";
import type { Article, Card, Definition, Settings, State } from "../src/types";
export class Store {
  private constructor(
    private db: Database,
    private dictionary: Database,
    readonly file: string,
  ) {}
  static async open(directory: string, assets: string, wasmPath?: string) {
    fs.mkdirSync(directory, { recursive: true });
    const SQL = await initSqlJs(wasmPath ? { locateFile: () => wasmPath } : {});
    const file = path.join(directory, "reader.sqlite");
    const db = new SQL.Database(
      fs.existsSync(file) ? fs.readFileSync(file) : undefined,
    );
    db.run(
      "PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS articles(id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS cards(id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);",
    );
    const store = new Store(
      db,
      new SQL.Database(fs.readFileSync(path.join(assets, "dictionary.sqlite"))),
      file,
    );
    if (!store.getMeta("settings"))
      store.setMeta("settings", JSON.stringify(defaults));
    const classics = JSON.parse(
      fs.readFileSync(path.join(assets, "classics.json"), "utf8"),
    );
    for (const a of classics)
      if (!store.article(a.id))
        store.upsertArticle({ ...a, ...analyze(a.text) });
    store.persist();
    return store;
  }
  private all<T>(table: "articles" | "cards"): T[] {
    const r = this.db.exec(`SELECT data FROM ${table}`);
    return r.length ? r[0].values.map((v) => JSON.parse(v[0] as string)) : [];
  }
  private getMeta(key: string) {
    const s = this.db.prepare("SELECT value FROM meta WHERE key=?");
    try {
      s.bind([key]);
      return s.step() ? (s.getAsObject().value as string) : "";
    } finally {
      s.free();
    }
  }
  private setMeta(key: string, value: string) {
    this.db.run(
      "INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      [key, value],
    );
  }
  private persist() {
    const tmp = this.file + ".tmp";
    const fd = fs.openSync(tmp, "w", 0o600);
    try {
      fs.writeFileSync(fd, Buffer.from(this.db.export()));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, this.file);
  }
  private transaction<T>(fn: () => T): T {
    this.db.run("BEGIN");
    let value: T;
    try {
      value = fn();
      this.db.run("COMMIT");
      this.persist();
      return value;
    } catch (e) {
      try {
        this.db.run("ROLLBACK");
      } catch {
        // A persistence failure after COMMIT: reload the last durable snapshot.
        const ctor = this.db.constructor as new (data: Uint8Array) => Database;
        this.db.close();
        this.db = new ctor(fs.readFileSync(this.file));
      }
      throw e;
    }
  }
  state(): State {
    return {
      articles: this.all<Article>("articles"),
      cards: this.all<Card>("cards"),
      settings: JSON.parse(this.getMeta("settings")),
      lastRefresh: this.getMeta("lastRefresh"),
      refreshError: this.getMeta("refreshError"),
      todayMinutes:
        (JSON.parse(this.getMeta("study") || "{}")[localDay()] || 0) / 60,
      storagePath: path.dirname(this.file),
    };
  }
  article(id: string) {
    return this.all<Article>("articles").find((a) => a.id === id);
  }
  private upsertArticle(a: Article) {
    this.db.run(
      "INSERT INTO articles VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      [a.id, JSON.stringify(a)],
    );
  }
  addArticles(articles: Article[]) {
    return this.transaction(() => {
      let added = 0;
      for (const a of articles) {
        const old =
          this.article(a.id) ||
          this.all<Article>("articles").find((x) => x.url === a.url);
        if (old) continue;
        this.upsertArticle(a);
        added++;
      }
      this.setMeta("lastRefresh", localDay());
      this.setMeta("refreshError", "");
      return added;
    });
  }
  refreshFailure(error: string) {
    this.transaction(() => this.setMeta("refreshError", error));
  }
  progress(id: string, progress: number, position: number) {
    return this.transaction(() => {
      const a = this.article(id);
      if (!a) throw Error("材料不存在");
      this.upsertArticle({
        ...a,
        progress: Math.max(0, Math.min(1, progress)),
        position: Math.max(0, position),
      });
    });
  }
  lookup(raw: string): Definition {
    const word = normalizeWord(raw).slice(0, 120);
    const s = this.dictionary.prepare(
      "SELECT * FROM entries WHERE word=? UNION ALL SELECT e.* FROM entries e JOIN forms f ON f.word=e.word WHERE f.form=? LIMIT 1",
    );
    try {
      s.bind([word, word]);
      if (s.step()) {
        const r = s.getAsObject();
        return {
          word: String(r.word),
          phonetic: String(r.phonetic),
          definition: String(r.definition),
          translation: String(r.translation),
          pos: String(r.pos),
          found: true,
          source: "ECDICT · MIT",
        };
      }
    } finally {
      s.free();
    }
    return {
      word,
      phonetic: "",
      definition: "",
      translation:
        "离线词典未收录；可选用语境释义（需要 API 配置及本次授权）。",
      pos: "",
      found: false,
      source: "ECDICT · MIT",
    };
  }
  saveCard(input: {
    word: string;
    meaning: string;
    example: string;
    articleId: string;
  }): Card {
    return this.transaction(() => {
      const word = normalizeWord(input.word);
      if (!word) throw Error("请选择英文单词或短语");
      const a = this.article(input.articleId);
      if (!a) throw Error("材料不存在");
      const id = createHash("sha256")
        .update(word + "\0" + input.articleId)
        .digest("hex");
      const existing = this.all<Card>("cards").find((c) => c.id === id);
      if (existing) return existing;
      const card: Card = {
        id,
        word,
        meaning: input.meaning,
        example: input.example,
        articleId: a.id,
        sourceTitle: a.title,
        sourceUrl: a.url,
        createdAt: new Date().toISOString(),
        due: new Date().toISOString(),
        interval: 0,
        ease: 2.5,
        repetitions: 0,
        lapses: 0,
        version: 0,
      };
      this.db.run("INSERT INTO cards VALUES(?,?)", [id, JSON.stringify(card)]);
      return card;
    });
  }
  review(id: string, rating: 0 | 3 | 4 | 5, version: number) {
    return this.transaction(() => {
      const card = this.all<Card>("cards").find((c) => c.id === id);
      if (!card) throw Error("复习卡不存在");
      if (card.version !== version) throw Error("这张卡片已复习，请刷新后继续");
      if (new Date(card.due).getTime() > Date.now())
        throw Error("这张卡片尚未到期");
      const next = schedule(card, rating);
      this.db.run("UPDATE cards SET data=? WHERE id=?", [
        JSON.stringify(next),
        id,
      ]);
      return next;
    });
  }
  deleteCard(id: string) {
    this.transaction(() => this.db.run("DELETE FROM cards WHERE id=?", [id]));
  }
  saveSettings(settings: Settings) {
    const parsed = settingsSchema.parse(settings);
    this.transaction(() => this.setMeta("settings", JSON.stringify(parsed)));
  }
  trackSeconds(seconds: number) {
    this.transaction(() => {
      const study = JSON.parse(this.getMeta("study") || "{}");
      const day = localDay();
      study[day] = (study[day] || 0) + seconds;
      this.setMeta("study", JSON.stringify(study));
    });
  }
  backup() {
    return {
      format: "english-reader-backup" as const,
      version: 1 as const,
      createdAt: new Date().toISOString(),
      articles: this.all<Article>("articles"),
      cards: this.all<Card>("cards"),
      settings: JSON.parse(this.getMeta("settings")),
      study: JSON.parse(this.getMeta("study") || "{}"),
      lastRefresh: this.getMeta("lastRefresh"),
    };
  }
  restore(input: unknown) {
    const b = backupSchema.parse(input);
    if (
      new Set(b.articles.map((a) => a.id)).size !== b.articles.length ||
      new Set(b.cards.map((c) => c.id)).size !== b.cards.length
    )
      throw Error("备份包含重复记录");
    const ids = new Set(b.articles.map((a) => a.id));
    if (b.cards.some((c) => !ids.has(c.articleId)))
      throw Error("备份包含无来源卡片");
    return this.transaction(() => {
      this.db.run("DELETE FROM articles; DELETE FROM cards;");
      for (const a of b.articles) this.upsertArticle(a);
      for (const c of b.cards)
        this.db.run("INSERT INTO cards VALUES(?,?)", [c.id, JSON.stringify(c)]);
      this.setMeta("settings", JSON.stringify(b.settings));
      this.setMeta("study", JSON.stringify(b.study));
      this.setMeta("lastRefresh", b.lastRefresh);
      this.setMeta("refreshError", "");
    });
  }
  close() {
    this.persist();
    this.db.close();
    this.dictionary.close();
  }
}
