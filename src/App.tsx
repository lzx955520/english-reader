import { useEffect, useMemo, useRef, useState } from "react";
import { dailyArticles } from "./recommendations";
import { annotateArticle, rawReaderSelection, type GlossMap } from "./gloss";
import {
  BookOpen,
  CalendarDays,
  RotateCw,
  Settings as SettingsIcon,
  Bookmark,
  Volume2,
  ArrowUpRight,
  Download,
  ShieldCheck,
  X,
  Check,
  WifiOff,
  Sparkles,
  ChevronRight,
} from "lucide-react";
import type {
  Article,
  Card,
  Definition,
  Feature,
  Settings,
  State,
} from "./types";
const api = window.reader;
const emptyDefinition: Definition = {
  word: "",
  phonetic: "",
  definition: "",
  translation: "",
  pos: "",
  found: false,
  source: "",
};
function humanError(e: unknown) {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.replace(/^Error invoking remote method '[^']+': Error: /, "");
}
function formatSourceTime(value: string) {
  if (!value) return "尚无";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}
function dayLabel() {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date());
}
export function App() {
  const [state, setState] = useState<State | null>(null),
    [tab, setTab] = useState<"today" | "library" | "review">("today"),
    [articleId, setArticleId] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false),
    [notice, setNotice] = useState(""),
    [refreshing, setRefreshing] = useState(false),
    [lookup, setLookup] = useState(emptyDefinition),
    [selected, setSelected] = useState(""),
    [sentence, setSentence] = useState("");
  const [aiResult, setAIResult] = useState(""),
    [busyAI, setBusyAI] = useState(false),
    [sessionAI, setSessionAI] = useState(false),
    [consentBusy, setConsentBusy] = useState(false),
    [saving, setSaving] = useState(false);
  const [revealed, setRevealed] = useState(false),
    [reviewBusy, setReviewBusy] = useState(false);
  const [glosses, setGlosses] = useState<{ id: string; text: string; values: GlossMap }>({ id: "", text: "", values: {} });
  const [glossSaving, setGlossSaving] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const consentRevision = useRef(-1);
  const contentRef = useRef<HTMLDivElement>(null),
    lookupSequence = useRef(0),
    progressRef = useRef<{ id: string; p: number; y: number } | null>(null),
    progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const article = state?.articles.find((a) => a.id === articleId);
  const paragraphs = useMemo(
    () => annotateArticle(
      article?.text || "",
      state?.settings.inlineGlosses !== false &&
        glosses.id === articleId && glosses.text === article?.text
        ? glosses.values
        : {},
    ),
    [article?.text, articleId, state?.settings.inlineGlosses, glosses],
  );
  const load = async () => {
    const s = await api.state();
    setState(s);
    const status = await api.aiConsentStatus();
    if (status.revision >= consentRevision.current) {
      consentRevision.current = status.revision;
      setSessionAI(status.enabled);
    }
    return s;
  };
  const report = (e: unknown) => setNotice(humanError(e));
  useEffect(() => {
    void load().catch(report);
    const timer = setInterval(() => void load().catch(report), 10000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 7000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (
        articleId &&
        document.visibilityState === "visible" &&
        document.hasFocus()
      )
        void api.trackMinutes(30).then(load).catch(report);
    }, 30000);
    return () => clearInterval(timer);
  }, [articleId]);
  const flush = () => {
    if (progressTimer.current) clearTimeout(progressTimer.current);
    const p = progressRef.current;
    progressRef.current = null;
    if (p) void api.progress(p.id, p.p, p.y).catch(report);
  };
  useEffect(() => {
    setLookup(emptyDefinition);
    setSelected("");
    setSentence("");
    setAIResult("");
    lookupSequence.current++;
    if (article && contentRef.current)
      contentRef.current.scrollTop = article.position;
    return flush;
  }, [articleId]);
  useEffect(() => {
    if (!article || state?.settings.inlineGlosses === false) return;
    let cancelled = false;
    const id = article.id, text = article.text;
    void api.glosses(id).then((values) => {
      if (!cancelled) setGlosses({ id, text, values });
    }).catch((e) => {
      if (!cancelled) report(e);
    });
    return () => { cancelled = true; };
  }, [articleId, article?.text, state?.settings.inlineGlosses]);
  const toggleGlosses = async (enabled: boolean) => {
    if (!state || glossSaving) return;
    const previous = state.settings.inlineGlosses !== false;
    setGlossSaving(true);
    setState(current => current ? { ...current, settings: { ...current.settings, inlineGlosses: enabled } } : current);
    try {
      await api.saveSettings({ ...state.settings, inlineGlosses: enabled }, {});
      await load();
    } catch (e) {
      setState(current => current ? { ...current, settings: { ...current.settings, inlineGlosses: previous } } : current);
      report(e);
    } finally {
      setGlossSaving(false);
    }
  };
  const openArticle = (a: Article) => {
    flush();
    setArticleId(a.id);
  };
  const onScroll = () => {
    const el = contentRef.current;
    if (!el || !article) return;
    const p =
      el.scrollHeight <= el.clientHeight
        ? 1
        : Math.min(1, el.scrollTop / (el.scrollHeight - el.clientHeight));
    progressRef.current = {
      id: article.id,
      p: Math.max(article.progress, p),
      y: el.scrollTop,
    };
    if (progressTimer.current) clearTimeout(progressTimer.current);
    progressTimer.current = setTimeout(flush, 400);
  };
  const pickWord = async (word: string, paragraph: string) => {
    if (rawReaderSelection(window.getSelection(), bodyRef.current).trim()) return;
    setSelected(word);
    setSentence(paragraph);
    setAIResult("");
    const seq = ++lookupSequence.current;
    setLookup({ ...emptyDefinition, word, translation: "正在查词…" });
    try {
      const d = await api.lookup(word);
      if (seq === lookupSequence.current) setLookup(d);
    } catch (e) {
      report(e);
    }
  };
  const captureSelection = () => {
    const selection = rawReaderSelection(window.getSelection(), bodyRef.current).trim();
    if (!selection || selection.length > 10000) return;
    lookupSequence.current++;
    setSelected(selection);
    setSentence(selection);
    setAIResult("");
    if (selection.length <= 120 && selection.split(/\s+/).length <= 6) {
      const seq = lookupSequence.current;
      void api
        .lookup(selection)
        .then((d) => {
          if (seq === lookupSequence.current) setLookup(d);
        })
        .catch(report);
    } else
      setLookup({
        ...emptyDefinition,
        word: "长句选择",
        translation: "已选中长句，可请求语法解析。",
      });
  };
  const save = async () => {
    if (!article || !selected || saving) return;
    if (selected.length > 120) {
      setNotice(
        "收藏支持单词及短语（120 字符以内）；长句可作为例句随生词保存。",
      );
      return;
    }
    setSaving(true);
    try {
      await api.saveCard({
        word: selected,
        meaning:
          aiResult ||
          [lookup.translation, lookup.definition].filter(Boolean).join("\n"),
        example: sentence,
        articleId: article.id,
      });
      await load();
      setNotice("已收藏，加入间隔复习");
    } catch (e) {
      report(e);
    } finally {
      setSaving(false);
    }
  };
  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const result = await api.refresh(true);
      const s = await load();
      setNotice(
        result.cancelled
          ? "更新已取消，已有材料保留"
          : result.added
            ? `获取 ${result.added} 篇真实新闻`
            : s.refreshError || "来源已检查，没有新增材料",
      );
    } catch (e) {
      report(e);
    } finally {
      setRefreshing(false);
    }
  };
  const propose = (feature: Feature) => {
    if (!state?.settings.models[feature].hasKey) {
      setNotice(
        "该功能未配置 API 密钥。请在设置中录入；阅读、查词、收藏和复习无需密钥。",
      );
      return;
    }
    if (busyAI) return;
    void runAI(feature);
  };
  const runAI = async (feature: Feature) => {
    if (busyAI) return;
    setBusyAI(true);
    setAIResult("");
    try {
      const result = await api.ai({
        feature,
        text:
          feature === "selection"
            ? JSON.stringify(
                state?.articles
                  .filter((a) => a.kind === "news")
                  .map(({ id, title, words, difficulty, published }) => ({
                    id,
                    title,
                    words,
                    difficulty,
                    published,
                  })),
              )
            : selected,
        context: feature === "selection" ? "只排序已缓存真实新闻" : sentence,
        operationId: "reader-ai",
      });
      setAIResult(result);
    } catch (e) {
      report(e);
    } finally {
      setBusyAI(false);
      void load().catch(report);
    }
  };
  const speak = () => {
    if (!("speechSynthesis" in window)) {
      setNotice("当前系统不支持朗读");
      return;
    }
    const voices = speechSynthesis
      .getVoices()
      .filter((v) => v.lang.startsWith("en") && v.localService);
    if (!voices.length) {
      setNotice(
        "没有可用的本地英语语音，请在 Windows 语音设置中安装英语语音包。",
      );
      return;
    }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(selected);
    u.voice = voices[0];
    u.lang = "en-US";
    u.rate = 0.8;
    speechSynthesis.speak(u);
  };
  const due =
    state?.cards
      .filter((c) => new Date(c.due).getTime() <= Date.now())
      .sort((a, b) => a.due.localeCompare(b.due)) || [];
  const card = due[0];
  const review = async (rating: 0 | 3 | 4 | 5) => {
    if (!card || reviewBusy) return;
    setReviewBusy(true);
    try {
      await api.review(card.id, rating, card.version);
      setRevealed(false);
      await load();
    } catch (e) {
      report(e);
    } finally {
      setReviewBusy(false);
    }
  };
  if (!state)
    return (
      <main className="loading">
        <BookOpen size={40} />
        <p>正在打开你的阅读空间…</p>
        {notice && <p role="alert">{notice}</p>}
      </main>
    );
  const news = state.articles
      .filter((a) => a.kind === "news")
      .sort((a, b) => b.published.localeCompare(a.published)),
    classics = state.articles.filter((a) => a.kind === "classic");
  const visibleNews =
    tab === "today"
      ? dailyArticles(news)
      : news;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <BookOpen size={26} />
          <div>
            English Reader<small>每天一点，读得更深</small>
          </div>
        </div>
        <nav aria-label="主导航">
          <button
            className={tab === "today" && !article ? "active" : ""}
            onClick={() => {
              flush();
              setTab("today");
              setArticleId("");
            }}
          >
            <CalendarDays size={19} />
            今日阅读
          </button>
          <button
            className={tab === "library" && !article ? "active" : ""}
            onClick={() => {
              flush();
              setTab("library");
              setArticleId("");
            }}
          >
            <BookOpen size={19} />
            材料书架
          </button>
          <button
            className={tab === "review" && !article ? "active" : ""}
            onClick={() => {
              flush();
              setTab("review");
              setArticleId("");
              setRevealed(false);
            }}
          >
            <Bookmark size={19} />
            生词复习<span className="count">{due.length}</span>
          </button>
        </nav>
        <div className="daily-goal">
          <span>今天的专注</span>
          <strong>
            {Math.floor(state.todayMinutes)}{" "}
            <small>/ {state.settings.dailyMinutes} 分钟</small>
          </strong>
          <progress
            max={state.settings.dailyMinutes}
            value={state.todayMinutes}
          />
          <p>阅读计时仅统计前台窗口。</p>
        </div>
        <div className="sidebar-footer">
          <button role="switch" aria-checked={sessionAI} disabled={consentBusy}
            onClick={async () => {
              if (consentBusy) return;
              setConsentBusy(true);
              try { await api.setAIConsent(!sessionAI); await load(); }
              catch (e) { report(e); }
              finally { setConsentBusy(false); }
            }}>
            {sessionAI ? "本次 AI 授权：已开启" : "开启本次 AI 授权"}
          </button>
          <span className="privacy">仅主动点击的请求 · 退出即失效 · 可随时关闭</span>
          <p>六级略高 · 每日 30–60 分钟</p>
          <button onClick={() => setSettingsOpen(true)}>
            <SettingsIcon size={18} />
            设置与数据
          </button>
          <span className="privacy">
            <ShieldCheck size={13} />
            本地存储 · 无自动付费请求
          </span>
        </div>
      </aside>
      <main className={article ? "workspace reader-workspace" : "workspace"}>
        {article ? (
          <>
            <header className="reader-header">
              <button
                className="text-button"
                onClick={() => {
                  flush();
                  setArticleId("");
                  void load();
                }}
              >
                ← 返回书架
              </button>
              <span>
                {article.kind === "classic"
                  ? "经典 · 非实时材料"
                  : "已缓存真实新闻"}{" "}
                · {article.minutes} 分钟
              </span>
              <label className="gloss-toggle">
                <input
                  type="checkbox"
                  checked={state.settings.inlineGlosses !== false}
                  disabled={glossSaving}
                  onChange={(e) => void toggleGlosses(e.target.checked)}
                />
                行内中文提示
              </label>
              <button
                className="text-button"
                onClick={() => void api.openSource(article.url).catch(report)}
              >
                原文来源 <ArrowUpRight size={14} />
              </button>
            </header>
            <div className="reader-grid">
              <div
                className="reading-scroll"
                ref={contentRef}
                onScroll={onScroll}
              >
                <article className="article-text">
                  <div className="eyebrow">{article.source}</div>
                  <h1>{article.title}</h1>
                  <div className="article-meta">
                    {article.published} · {article.words} 词 ·{" "}
                    {article.difficulty}
                    <span>{article.author} · {article.source} · {article.license}</span>
                    <button
                      className="text-button"
                      onClick={() => void api.openSource(article.licenseUrl).catch(report)}
                    >许可条款 ↗</button>
                    <span>难度与时长为启发式估计</span>
                  </div>
                  <div className="reader-tip">
                    点击单词查词；拖选短语或长句获得更多帮助。
                    <span className="gloss-explanation">
                      中文提示来自离线词典，仅按长词与常见词表粗筛，同一词根只提示一次；
                      不是精确六级词表，也不是语境翻译。复制与选词保留英文原文。
                    </span>
                  </div>
                  <div
                    className="article-body"
                    ref={bodyRef}
                    onMouseUp={captureSelection}
                    onKeyUp={captureSelection}
                    onCopy={(event) => {
                      const raw = rawReaderSelection(window.getSelection(), bodyRef.current);
                      if (!raw) return;
                      event.preventDefault();
                      event.clipboardData.setData("text/plain", raw);
                    }}
                  >
                    {paragraphs.map((paragraph, i) => (
                      <p
                        key={i}
                        data-reader-paragraph
                        data-reader-separator={paragraph.separatorBefore}
                      >
                        {paragraph.tokens.map((token, j) =>
                          token.word ? (
                            <span className="reader-token" key={j}>
                              <button
                                className="word"
                                onClick={() => void pickWord(token.text, paragraph.text)}
                              >
                                {token.text}
                              </button>
                              {token.gloss && (
                                <span
                                  className="inline-gloss"
                                  data-inline-gloss
                                  data-lemma={token.gloss.lemma}
                                  aria-hidden="true"
                                  onMouseDown={(event) => event.preventDefault()}
                                >（{token.gloss.translation}）</span>
                              )}
                            </span>
                          ) : (
                            <span key={j}>{token.text}</span>
                          ),
                        )}
                      </p>
                    ))}
                  </div>
                  <footer className="attribution">
                    {article.author} · {article.license}
                    <br />
                    正文提取省略导航与参考信息；中文括注为应用添加，可关闭；原版见来源。
                    <button
                      className="text-button"
                      onClick={() =>
                        void api.openSource(article.licenseUrl).catch(report)
                      }
                    >
                      许可条款 ↗
                    </button>
                    <button
                      className="button"
                      onClick={async () => {
                        await api.progress(
                          article.id,
                          1,
                          contentRef.current?.scrollTop || 0,
                        );
                        await load();
                        setNotice("已标记读完");
                      }}
                    >
                      标记读完 <Check size={15} />
                    </button>
                  </footer>
                </article>
              </div>
              <aside className="word-panel">
                <div className="panel-label">阅读助手</div>
                {selected ? (
                  <>
                    <div className="selected-word">
                      {selected.length > 120 ? "所选长句" : selected}
                    </div>
                    {lookup.phonetic && (
                      <div className="phonetic">
                        /{lookup.phonetic}/{" "}
                        <button aria-label="发音" onClick={speak}>
                          <Volume2 size={18} />
                        </button>
                      </div>
                    )}
                    {!lookup.phonetic && selected.length <= 120 && (
                      <button className="text-button" onClick={speak}>
                        <Volume2 size={16} />
                        系统英语发音
                      </button>
                    )}
                    <div className="definition">
                      {lookup.pos && (
                        <span className="badge">{lookup.pos}</span>
                      )}
                      <p>{lookup.translation}</p>
                      {lookup.definition && (
                        <>
                          <h4>English definition</h4>
                          <p>{lookup.definition}</p>
                        </>
                      )}
                      <small>{lookup.source}</small>
                    </div>
                    <button
                      className="button primary full"
                      disabled={saving || selected.length > 120}
                      onClick={() => void save()}
                    >
                      <Bookmark size={16} />
                      {saving ? "正在收藏" : "收藏生词与例句"}
                    </button>
                    <div className="assistant-actions">
                      <button
                        className="button full"
                        disabled={busyAI}
                        onClick={() => propose("context")}
                      >
                        <Sparkles size={15} />
                        语境 / 短语释义
                      </button>
                      <button
                        className="button full"
                        disabled={busyAI}
                        onClick={() => propose("grammar")}
                      >
                        <Sparkles size={15} />
                        长句语法解析
                      </button>
                    </div>
                    <p className="muted small">
                      AI 仅在你授权本次请求后调用。解释可能出错，请对照原文。
                    </p>
                  </>
                ) : (
                  <div className="empty-helper">
                    <BookOpen size={28} />
                    <p>
                      一个词，一句话，
                      <br />
                      慢慢读懂。
                    </p>
                    <span>点击正文里的英文单词</span>
                  </div>
                )}
                {busyAI && (
                  <div className="ai-output" role="status">
                    正在请求模型…
                    <button
                      className="text-button"
                      onClick={() => void api.cancel("reader-ai")}
                    >
                      取消请求
                    </button>
                  </div>
                )}
                {aiResult && (
                  <div className="ai-output">
                    <h4>AI 辅助解释</h4>
                    <p>{aiResult}</p>
                  </div>
                )}
              </aside>
            </div>
          </>
        ) : tab === "review" ? (
          <>
            <header className="page-header">
              <div className="eyebrow">SPACED REPETITION</div>
              <h1>让理解留下来。</h1>
              <p>
                共 {state.cards.length} 张卡片 · 今天到期 {due.length} 张 · SM-2
                间隔复习
              </p>
            </header>
            {card ? (
              <section className="review-card">
                <span className="eyebrow">回忆词义，再翻开答案</span>
                <h2>{card.word}</h2>
                <blockquote>{card.example}</blockquote>
                <p className="muted">来自 {card.sourceTitle}</p>
                {!revealed ? (
                  <button
                    className="button primary"
                    onClick={() => setRevealed(true)}
                  >
                    显示答案
                  </button>
                ) : (
                  <>
                    <div className="review-meaning">
                      {card.meaning || "未添加释义"}
                    </div>
                    <div className="rating-buttons">
                      <button
                        disabled={reviewBusy}
                        onClick={() => void review(0)}
                      >
                        忘记了<small>10 分钟后</small>
                      </button>
                      <button
                        disabled={reviewBusy}
                        onClick={() => void review(3)}
                      >
                        有点难<small>缩短间隔</small>
                      </button>
                      <button
                        disabled={reviewBusy}
                        onClick={() => void review(4)}
                      >
                        记住了<small>正常间隔</small>
                      </button>
                      <button
                        disabled={reviewBusy}
                        onClick={() => void review(5)}
                      >
                        很轻松<small>延长间隔</small>
                      </button>
                    </div>
                  </>
                )}
              </section>
            ) : (
              <div className="empty-state">
                <Check size={32} />
                <h2>
                  {state.cards.length ? "本轮复习完成" : "还没有生词卡片"}
                </h2>
                <p>
                  {state.cards.length
                    ? "到期后再来，给记忆一点时间。"
                    : "阅读时点击单词，将释义和例句一起收藏。"}
                </p>
              </div>
            )}
            <section className="saved-list">
              <h3>我的收藏</h3>
              {state.cards.map((c) => (
                <div key={c.id}>
                  <strong>{c.word}</strong>
                  <span>
                    下次复习 {new Date(c.due).toLocaleString("zh-CN")}
                  </span>
                  <button
                    className="text-button danger"
                    onClick={async () => {
                      if (confirm(`删除“${c.word}”的卡片？`)) {
                        await api.deleteCard(c.id);
                        await load();
                      }
                    }}
                  >
                    删除
                  </button>
                </div>
              ))}
            </section>
          </>
        ) : (
          <>
            <header className="page-header">
              <div className="eyebrow">{dayLabel()} · DAILY READING</div>
              <h1>
                {tab === "today" ? "今天，读懂一点世界。" : "你的阅读书架。"}
              </h1>
              <p>少量真实材料，留足时间精读。词典、收藏和复习都可离线使用。</p>
            </header>
            <section className="session-banner">
              <div>
                <span className="eyebrow">今日学习建议</span>
                <h3>精读 1–2 篇 + 生词复习</h3>
                <p>
                  约 {state.settings.dailyMinutes - 10} 分钟阅读 · 10 分钟复习
                </p>
              </div>
              <BookOpen size={40} />
            </section>
            <div className="section-heading">
              <div>
                <h2>
                  近期英文新闻 <span className="badge">联网推荐</span>
                </h2>
                <p>多个真实英文来源 · 按各来源许可收录 · 最近 30 天</p>
              </div>
              <button
                className="button"
                disabled={refreshing}
                onClick={() => void refresh()}
              >
                <RotateCw size={15} className={refreshing ? "spin" : ""} />
                {refreshing ? "更新中…" : "更新推荐"}
              </button>
              {refreshing && (
                <button
                  className="text-button"
                  onClick={() => void api.cancel("refresh")}
                >
                  取消
                </button>
              )}
            </div>
            {state.refreshError && (
              <div className="network-notice" role="status">
                <WifiOff size={17} />
                <span>{state.refreshError}。不会以示例代替实时新闻。</span>
              </div>
            )}
            {!!state.sourceDiagnostics?.length && (
              <details className="source-diagnostics">
                <summary>
                  来源更新详情 · {state.sourceDiagnostics.filter((source) => source.status === "failed").length} 个失败
                  {" · "}{state.sourceDiagnostics.reduce((sum, source) => sum + source.cached, 0)} 篇缓存
                </summary>
                <p className="muted small">
                  每个来源独立检查；失败时保留已有缓存。“更新推荐”会重新检查全部来源。
                </p>
                <ul>
                  {state.sourceDiagnostics.map((source) => (
                    <li key={source.id}>
                      <div className="source-status-heading">
                        <button
                          className="text-button"
                          onClick={() => void api.openSource(source.url).catch(report)}
                        >{source.name} ↗</button>
                        <span className={source.status === "failed" ? "source-status failed" : "source-status"}>
                          {({ updated: "有新增", "no-new": "无新增", filtered: "已筛选", failed: "更新失败" })[source.status]}
                        </span>
                      </div>
                      <p>
                        候选 {source.candidates} · 新增 {source.added} · 重复 {source.duplicates}
                        {" · "}筛除 {source.filtered} · 失败 {source.failures} · 缓存 {source.cached}
                      </p>
                      <p className="small muted">
                        最近尝试：{formatSourceTime(source.lastAttempt)}
                        {" · "}最近成功：{formatSourceTime(source.lastSuccess)}
                      </p>
                      {source.message && <p className="source-message">{source.message}</p>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {!visibleNews.length ? (
              <div className="news-empty">
                <h3>
                  {news.length
                    ? "暂无近期新闻，旧缓存可在材料书架查看"
                    : "尚无已缓存的新闻"}
                </h3>
                <p>
                  启动、跨日与联网恢复会检查真实来源。暂时可以阅读下方经典材料，或点击更新重试。
                </p>
                <small>
                  新闻来源更新时间：{state.lastRefresh || "尚未成功更新"}
                </small>
              </div>
            ) : (
              <div className="article-cards">
                {visibleNews.map((a) => (
                  <ArticleTile
                    key={a.id}
                    article={a}
                    onOpen={() => openArticle(a)}
                  />
                ))}
              </div>
            )}
            <div className="news-tools">
              <span className="muted small">
                上次成功检查：{state.lastRefresh || "尚未成功更新"} ·
                新增材料按日期与启发式难度筛选
              </span>
              {news.length > 0 && (
                <button
                  className="text-button"
                  disabled={busyAI}
                  onClick={() => propose("selection")}
                >
                  <Sparkles size={14} />
                  轻量模型辅助筛选
                </button>
              )}
            </div>
            {busyAI && (
              <p role="status">
                正在筛选…
                <button
                  className="text-button"
                  onClick={() => void api.cancel("reader-ai")}
                >
                  取消请求
                </button>
              </p>
            )}
            {aiResult && (
              <div className="ai-output">
                <p>{aiResult}</p>
              </div>
            )}
            <div className="section-heading">
              <div>
                <h2>
                  经典精读 <span className="badge neutral">非实时 · 公版</span>
                </h2>
                <p>明确标注原作年份，作为离线补充，不替代每日新闻。</p>
              </div>
            </div>
            <div className="article-cards">
              {classics.map((a) => (
                <ArticleTile
                  key={a.id}
                  article={a}
                  onOpen={() => openArticle(a)}
                />
              ))}
            </div>
          </>
        )}
      </main>
      {notice && (
        <div className="toast" role="alert">
          {notice}
          <button aria-label="关闭提示" onClick={() => setNotice("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {settingsOpen && (
        <SettingsDialog
          settings={state.settings}
          storagePath={state.storagePath}
          close={() => setSettingsOpen(false)}
          saved={() => void load()}
          report={report}
        />
      )}

    </div>
  );
}
function ArticleTile({
  article: a,
  onOpen,
}: {
  article: Article;
  onOpen: () => void;
}) {
  return (
    <button className="article-tile" onClick={onOpen}>
      <div className="tile-top">
        <span>{a.kind === "classic" ? "CLASSIC READING" : "WORLD · NEWS"}</span>
        <ArrowUpRight size={17} />
      </div>
      <h3>{a.title}</h3>
      <p>{a.text.slice(0, 140)}…</p>
      <div className="tile-meta">
        {a.published} · {a.minutes} 分钟 · {a.words} 词
        {a.kind === "news" && Date.now() - Date.parse(a.published) >= 30 * 86400000 && (
          <span className="badge neutral">较早缓存</span>
        )}
      </div>
      <span className="difficulty">{a.difficulty}</span>
      <div className="tile-source">
        {a.source}
        <ChevronRight size={14} />
      </div>
      {a.progress > 0 && (
        <div className="tile-progress">
          <progress value={a.progress} max={1} />
          <small>
            {a.progress === 1
              ? "已读完"
              : `已读 ${Math.round(a.progress * 100)}%`}
          </small>
        </div>
      )}
    </button>
  );
}
function SettingsDialog({
  settings,
  storagePath,
  close,
  saved,
  report,
}: {
  settings: Settings;
  storagePath: string;
  close: () => void;
  saved: () => void;
  report: (e: unknown) => void;
}) {
  const [draft, setDraft] = useState<Settings>(structuredClone(settings)),
    [keys, setKeys] = useState<Partial<Record<Feature, string>>>({}),
    [busy, setBusy] = useState(false),
    [dataBusy, setDataBusy] = useState(false);
  const [feature, setFeature] = useState<Feature>("context");
  const config = draft.models[feature];
  const change = (field: string, value: string) =>
    setDraft({
      ...draft,
      models: { ...draft.models, [feature]: { ...config, [field]: value } },
    });
  const action = async (which: "backup" | "restore" | "exportCards") => {
    if (dataBusy) return;
    setDataBusy(true);
    try {
      const done = await api[which]();
      if (done) {
        saved();
        report(
          which === "restore" ? "备份已恢复，密钥未包含在备份中" : "文件已保存",
        );
      }
    } catch (e) {
      report(e);
    } finally {
      setDataBusy(false);
    }
  };
  const submit = async () => {
    setBusy(true);
    try {
      await api.saveSettings(draft, keys);
      setKeys({});
      saved();
      report("设置已保存，未发送任何模型请求");
      close();
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <div
        className="modal settings-modal"
        role="dialog"
        aria-label="设置与数据"
      >
        <div className="modal-title">
          <h2>设置与数据</h2>
          <button aria-label="关闭设置" onClick={close}>
            <X size={21} />
          </button>
        </div>
        <p className="muted">
          无密钥即可使用基础功能。密钥由操作系统加密保存，不进入备份。
        </p>
        <label className="field">
          每天学习时长
          <select
            value={draft.dailyMinutes}
            onChange={(e) =>
              setDraft({ ...draft, dailyMinutes: Number(e.target.value) })
            }
          >
            <option value={30}>30 分钟</option>
            <option value={45}>45 分钟</option>
            <option value={60}>60 分钟</option>
          </select>
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={draft.inlineGlosses !== false}
            onChange={(e) => setDraft({ ...draft, inlineGlosses: e.target.checked })}
          />
          默认显示行内中文提示
        </label>
        <p className="small muted">
          离线词典 + 保守长词启发式；同一词根只提示一次，不代表精确考试等级。
        </p>
        <h3>按功能配置模型</h3>
        <div className="model-tabs">
          {(["context", "grammar", "selection"] as Feature[]).map((f) => (
            <button
              key={f}
              className={f === feature ? "active" : ""}
              onClick={() => setFeature(f)}
            >
              {f === "context"
                ? "语境释义"
                : f === "grammar"
                  ? "复杂语法"
                  : "内容筛选"}
            </button>
          ))}
        </div>
        <label className="field">
          提供商
          <select
            value={config.provider}
            onChange={(e) => {
              if (e.target.value === "deepseek")
                setDraft({
                  ...draft,
                  models: {
                    ...draft.models,
                    [feature]: {
                      ...config,
                      provider: "deepseek",
                      baseUrl: "https://api.deepseek.com",
                      model:
                        feature === "grammar"
                          ? "deepseek-reasoner"
                          : "deepseek-chat",
                    },
                  },
                });
              else change("provider", e.target.value);
            }}
          >
            <option value="deepseek">DeepSeek</option>
            <option value="compatible">其他国内模型（OpenAI 兼容接口）</option>
          </select>
        </label>
        <div className="field-grid">
          <label className="field">
            API 基础地址
            <input
              value={config.baseUrl}
              onChange={(e) => change("baseUrl", e.target.value)}
              placeholder="https://api.deepseek.com"
            />
          </label>
          <label className="field">
            模型
            <input
              value={config.model}
              onChange={(e) => change("model", e.target.value)}
            />
          </label>
        </div>
        <label className="field">
          API Key · {config.hasKey ? "已配置（留空不修改）" : "未配置"}
          <input
            type="password"
            autoComplete="off"
            value={keys[feature] ?? ""}
            placeholder={
              config.hasKey ? "留空保留现有密钥" : "输入后仅在本地安全保存"
            }
            onChange={(e) => setKeys({ ...keys, [feature]: e.target.value })}
          />
        </label>
        {config.hasKey && (
          <button
            className="text-button danger"
            onClick={() => setKeys({ ...keys, [feature]: "" })}
          >
            保存时删除本功能密钥
          </button>
        )}
        <p className="small muted">
          基础查词始终使用本地 ECDICT。接口会追加
          /chat/completions。模型可根据官方当前可用名称修改；保存不会调用 API。
        </p>
        <button
          className="text-button"
          onClick={() =>
            void api.openSource("https://api-docs.deepseek.com/").catch(report)
          }
        >
          DeepSeek 官方接口文档 ↗
        </button>
        <hr />
        <UpdateControls />
        <hr />
        <h3>备份与导出</h3>
        <div className="data-actions">
          <button
            className="button"
            disabled={dataBusy}
            onClick={() => void action("backup")}
          >
            <Download size={15} />
            完整备份
          </button>
          <button
            className="button"
            disabled={dataBusy}
            onClick={() => void action("restore")}
          >
            恢复备份
          </button>
          <button
            className="button"
            disabled={dataBusy}
            onClick={() => void action("exportCards")}
          >
            导出生词 CSV
          </button>
        </div>
        <p className="small muted">
          备份包含材料正文、阅读进度、生词例句、复习计划和模型设置，不包含密钥。恢复会替换当前数据，并先保留安全备份。备份含个人学习记录，请妥善保管。
        </p>
        <p className="storage-path">数据目录：{storagePath}</p>
        <p className="small muted">
          新闻按各来源许可收录，详情见材料原文与许可链接；经典为公版作品。开源许可证位于安装目录
          licenses 与 THIRD_PARTY_NOTICES.md。不开机启动。
        </p>
        <div className="modal-actions">
          <button className="button" onClick={close}>
            取消
          </button>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? "保存中…" : "保存设置"}
          </button>
        </div>
      </div>
    </div>
  );
}

function UpdateControls() {
  const [status, setStatus] = useState<import("./types").UpdateStatus | null>(null);
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const running = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const read = () => void api.updateStatus().then(s => {
      if (mounted.current) setStatus(s);
    }).catch(() => {
      if (mounted.current) setError("无法读取更新状态");
    });
    read();
    const timer = setInterval(read, 500);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      void api.cancelUpdate().catch(() => {});
    };
  }, []);
  const busy = status?.phase === "checking" || status?.phase === "downloading";
  const action = async (which: "checkUpdate" | "downloadUpdate") => {
    if (running.current) return;
    running.current = true;
    setError("");
    try {
      const result = await api[which]();
      if (mounted.current) setStatus(result);
    } catch {
      if (mounted.current) setError("更新操作失败，请手动重试。");
    } finally { running.current = false; }
  };
  return <section aria-label="应用更新">
    <h3>应用更新</h3>
    <p>当前版本：{status?.currentVersion || "读取中…"}{status?.latestVersion ? " · 新版本：" + status.latestVersion : ""}</p>
    <p role="status">{error || status?.message}</p>
    {status?.phase === "downloading" && <p>已下载 {Math.round((status.received || 0) / 1024 / 1024)} / {Math.round((status.total || 0) / 1024 / 1024)} MB</p>}
    <div className="data-actions">
      <button className="button" disabled={!status || busy} onClick={() => void action("checkUpdate")}>检查更新</button>
      {(status?.phase === "available" || ((status?.phase === "error" || status?.phase === "cancelled") && status.latestVersion)) &&
        <button className="button" disabled={busy} onClick={() => void action("downloadUpdate")}>下载安装包</button>}
      {busy && <button className="button" onClick={() => void api.cancelUpdate().catch(() => setError("无法取消，请稍后重试。"))}>取消更新操作</button>}
      {status?.phase === "downloaded" && <button className="button" onClick={() => void api.revealUpdate().then(ok => {
        if (!ok && mounted.current) setError("安装包已移动或不可访问，请重新下载。");
      }).catch(() => setError("无法显示安装包，请重新下载。"))}>在文件夹中显示安装包</button>}
    </div>
    <p className="small muted">仅手动检查和下载，不会后台下载、运行安装包或退出时安装。当前安装包未签名；HTTPS 和同源 SHA-256 只校验传输完整性，不能独立验证发布者身份。请遵循 Windows 安全提示。</p>
    <p className="small muted">0.2 旧版需先手动安装一次新版。推荐使用 Setup 安装版；便携版不会自我替换。安装前请使用下方“完整备份”保存学习数据，再退出应用并手动运行安装包。保留原有数据目录；尚未验证真实 Windows 跨版本升级。</p>
  </section>;
}

