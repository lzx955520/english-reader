import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
let directory: string, desktop: ElectronApplication, page: Page;
const launch = async () => {
  desktop = await electron.launch({
    args: ["--no-sandbox", "--disable-gpu", process.env.READER_E2E_APP || "."],
    env: {
      ...process.env,
      DISPLAY: process.env.DISPLAY || ":99",
      READER_E2E: "1",
      READER_TEST_OFFLINE: "1",
      READER_DATA_DIR: directory,
    },
    cwd: process.cwd(),
  });
  page = await desktop.firstWindow();
  await expect(page.getByText("今天，读懂一点世界。")).toBeVisible();
};
test.beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "reader-desktop-"));
  await launch();
});
test.afterEach(async () => {
  await desktop?.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
test("offline desktop: read → bilingual lookup → save once → review → restart → restore", async () => {
  await expect(page.getByText("尚无已缓存的新闻")).toBeVisible();
  await page.getByRole("button", { name: "更新推荐" }).click();
  await expect(page.getByText(/无法更新新闻/).first()).toBeVisible();
  await page.screenshot({ path: "test-results/today.png", fullPage: true });
  await page
    .getByRole("button", { name: /Pride and Prejudice · Chapter 1/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Pride and Prejudice · Chapter 1" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "truth", exact: true })
    .first()
    .click();
  await expect(page.locator(".definition")).toContainText("真");
  await expect(page.locator(".phonetic")).not.toBeEmpty();
  await page.getByRole("button", { name: "收藏生词与例句" }).click();
  await page.getByRole("button", { name: "收藏生词与例句" }).click();
  await expect
    .poll(async () =>
      page.evaluate(async () => (await window.reader.state()).cards.length),
    )
    .toBe(1);
  await page.getByRole("button", { name: "语境 / 短语释义" }).click();
  await expect(page.getByRole("alert")).toContainText("未配置");
  await page.screenshot({ path: "test-results/reader.png", fullPage: true });
  await page.locator(".reading-scroll").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    el.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await expect
    .poll(async () =>
      page.evaluate(
        async () => (await window.reader.state()).articles[0].progress,
      ),
    )
    .toBeGreaterThan(0.9);
  await page.getByRole("button", { name: "返回书架" }).click();
  await page.getByRole("button", { name: /生词复习/ }).click();
  await page.getByRole("button", { name: "显示答案" }).click();
  await expect(page.locator(".review-meaning")).toContainText("真");
  await page.screenshot({ path: "test-results/review.png", fullPage: true });
  await page.getByRole("button", { name: /记住了/ }).click();
  await expect(
    page.getByRole("heading", { name: "本轮复习完成" }),
  ).toBeVisible();
  const before = await page.evaluate(() => window.reader.state());
  expect(before.cards[0].repetitions).toBe(1);
  await desktop.close();
  await launch();
  const after = await page.evaluate(() => window.reader.state());
  expect(after.cards[0].due).toBe(before.cards[0].due);
  expect(after.articles[0].progress).toBe(before.articles[0].progress);
  await page.getByRole("button", { name: "设置与数据" }).click();
  const backupPath = path.join(directory, "backup.json");
  await desktop.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath: file,
    })) as any;
  }, backupPath);
  await page.getByRole("button", { name: "完整备份", exact: true }).click();
  await expect.poll(() => fs.existsSync(backupPath)).toBe(true);
  const backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));
  expect(backup.cards[0].example).toContain("truth");
  expect(JSON.stringify(backup)).not.toContain("hasKey");
  const cardId = after.cards[0].id;
  await page.evaluate((id) => window.reader.deleteCard(id), cardId);
  expect((await page.evaluate(() => window.reader.state())).cards).toHaveLength(
    0,
  );
  await desktop.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [file],
    })) as any;
    dialog.showMessageBox = (async () => ({
      response: 1,
      checkboxChecked: false,
    })) as any;
  }, backupPath);
  await page.getByRole("button", { name: "恢复备份", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.reader.state())).cards.length,
    )
    .toBe(1);
  expect((await page.evaluate(() => window.reader.state())).cards[0].due).toBe(
    before.cards[0].due,
  );
  expect(
    fs
      .readdirSync(directory)
      .some((name) => name.startsWith("before-restore-")),
  ).toBe(true);
  const csvPath = path.join(directory, "vocabulary.csv");
  await desktop.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath: file,
    })) as any;
  }, csvPath);
  await page.getByRole("button", { name: "导出生词 CSV" }).click();
  await expect.poll(() => fs.existsSync(csvPath)).toBe(true);
  expect(fs.readFileSync(csvPath, "utf8")).toContain("truth");
});
test("settings save without API calls; cancel file dialogs does not lose data; renderer stays isolated", async () => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("button", { name: "设置与数据" }).click();
  await page.getByLabel("每天学习时长").selectOption("60");
  await page.getByRole("button", { name: "保存设置" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    (await page.evaluate(() => window.reader.state())).settings.dailyMinutes,
  ).toBe(60);
  expect(await page.evaluate(() => typeof (window as any).require)).toBe(
    "undefined",
  );
  await page.getByRole("button", { name: "设置与数据" }).click();
  await desktop.evaluate(({ dialog }) => {
    dialog.showSaveDialog = (async () => ({ canceled: true })) as any;
    dialog.showOpenDialog = (async () => ({
      canceled: true,
      filePaths: [],
    })) as any;
  });
  await page.getByRole("button", { name: "完整备份", exact: true }).click();
  await page.getByRole("button", { name: "恢复备份", exact: true }).click();
  expect(
    (await page.evaluate(() => window.reader.state())).articles,
  ).toHaveLength(1);
  expect(errors).toEqual([]);
  await page.screenshot({ path: "test-results/settings.png", fullPage: true });
});

test("inline hints: first lemma only, original-word lookup, clean selection/copy and persisted toggle", async () => {
  const article = (await page.evaluate(() => window.reader.state())).articles.find((a) => a.kind === "classic")!;
  const rawParagraphs = article.text.split(/\n\n+/);
  await page.getByRole("button", { name: /Pride and Prejudice · Chapter 1/ }).click();
  const toggle = page.getByLabel("行内中文提示", { exact: true });
  await expect(toggle).toBeChecked();
  await expect.poll(() => page.locator(".inline-gloss").count()).toBeGreaterThan(0);
  const lemmas = await page.locator(".inline-gloss").evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-lemma")),
  );
  expect(new Set(lemmas).size).toBe(lemmas.length);
  expect(await page.locator(".inline-gloss").first().getAttribute("aria-hidden")).toBe("true");
  expect(await page.locator(".inline-gloss").first().evaluate((node) => getComputedStyle(node).userSelect)).toBe("none");

  const firstToken = page.locator(".reader-token").filter({ has: page.locator(".inline-gloss") }).first();
  const word = await firstToken.locator(".word").innerText();
  await firstToken.locator(".word").click();
  await expect(page.locator(".selected-word")).toHaveText(word);
  await expect(page.locator(".definition")).toContainText("ECDICT");
  await page.getByRole("button", { name: "收藏生词与例句" }).click();
  await expect.poll(async () => (await page.evaluate(() => window.reader.state())).cards.length).toBe(1);
  const saved = (await page.evaluate(() => window.reader.state())).cards[0];
  expect(saved.word).toBe(word.toLowerCase());
  expect(rawParagraphs).toContain(saved.example);
  expect(saved.example).not.toMatch(/[\u3400-\u9fff]/);

  // Programmatic ranges intentionally include non-selectable hint DOM: copy
  // and capture must strip it even when Chromium range.textContent includes it.
  const copiedWord = await firstToken.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    const clipboardData = new DataTransfer();
    node.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData }));
    return clipboardData.getData("text/plain");
  });
  expect(copiedWord).toBe(word);
  await expect(page.locator(".selected-word")).toHaveText(word);

  const copiedArticle = await page.locator(".article-body").evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const clipboardData = new DataTransfer();
    node.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData }));
    const value = clipboardData.getData("text/plain");
    selection.removeAllRanges();
    return value;
  });
  expect(copiedArticle).toBe(article.text);

  // A click on the visual hint must not replace the original selected word.
  await page.locator(".inline-gloss").first().click();
  await expect(page.locator(".selected-word")).toHaveText(word);
  await toggle.uncheck();
  await expect(page.locator(".inline-gloss")).toHaveCount(0);
  expect((await page.evaluate(() => window.reader.state())).settings.inlineGlosses).toBe(false);
  await desktop.close();
  await launch();
  expect((await page.evaluate(() => window.reader.state())).settings.inlineGlosses).toBe(false);
  await page.getByRole("button", { name: /Pride and Prejudice · Chapter 1/ }).click();
  await expect(page.getByLabel("行内中文提示", { exact: true })).not.toBeChecked();
  await expect(page.locator(".inline-gloss")).toHaveCount(0);
  await page.getByLabel("行内中文提示", { exact: true }).check();
  await expect.poll(() => page.locator(".inline-gloss").count()).toBeGreaterThan(0);
  expect((await page.evaluate(() => window.reader.state())).articles.find((a) => a.id === article.id)?.text).toBe(article.text);
  await page.getByRole("button", { name: "设置与数据" }).click();
  await expect(page.getByLabel("默认显示行内中文提示", { exact: true })).toBeChecked();
  await page.getByLabel("默认显示行内中文提示", { exact: true }).uncheck();
  await page.getByRole("button", { name: "保存设置" }).click();
  await expect(page.locator(".inline-gloss")).toHaveCount(0);
});

test("source diagnostics retain cache context and give per-source offline failure details", async () => {
  await page.getByRole("button", { name: "更新推荐" }).click();
  await expect.poll(async () => (await page.evaluate(() => window.reader.state())).sourceDiagnostics?.length || 0).toBeGreaterThan(1);
  await page.locator(".source-diagnostics summary").click();
  await expect(page.locator(".source-diagnostics li")).toHaveCount(
    (await page.evaluate(() => window.reader.state())).sourceDiagnostics!.length,
  );
  await expect(page.locator(".source-diagnostics")).toContainText("最近尝试");
  await expect(page.locator(".source-diagnostics")).toContainText("最近成功");
  await expect(page.locator(".source-diagnostics")).toContainText("缓存");
  await expect(page.locator(".source-diagnostics .source-status.failed").first()).toBeVisible();
  expect((await page.evaluate(() => window.reader.state())).articles.some((a) => a.kind === "news")).toBe(false);
});

test("update controls show installed version and unpublished channel without changing learning data", async () => {
  const before = await page.evaluate(() => window.reader.state());
  await page.getByRole("button", { name: "设置与数据" }).click();
  const updates = page.getByRole("region", { name: "应用更新" });
  await expect(updates).toContainText("当前版本：0.3.1");
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await expect(updates).toContainText("公开更新渠道尚未发布");
  await expect(page.getByRole("button", { name: "下载安装包", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "关闭设置" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "设置与数据" }).click();
  await expect(updates).toContainText("公开更新渠道尚未发布");
  expect((await page.evaluate(() => window.reader.state())).cards).toEqual(before.cards);
});


// Native dialogs and transport are mocked in the Electron main process; no real
// credentials or paid requests are used. Production exposes none of these mocks.
async function mockAI() {
  await desktop.evaluate(({ dialog, net, safeStorage }) => {
    const g = globalThis as any;
    g.aiTest = { dialogs: [], requests: [], response: 1, holdDialog: false, holdRequest: false };
    safeStorage.isEncryptionAvailable = () => true;
    safeStorage.getSelectedStorageBackend = () => "gnome_libsecret";
    safeStorage.encryptString = value => Buffer.from(value);
    safeStorage.decryptString = value => value.toString();
    dialog.showMessageBox = (async (_owner: unknown, options: unknown) => {
      g.aiTest.dialogs.push(options);
      if (g.aiTest.holdDialog) return new Promise(resolve => { g.aiTest.resolveDialog = resolve; });
      return { response: g.aiTest.response, checkboxChecked: false };
    }) as any;
    net.fetch = (async (url: unknown, options: any) => {
      g.aiTest.requests.push({ url, options });
      if (g.aiTest.holdRequest) return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(Error("aborted")), { once: true });
      });
      return new Response(JSON.stringify({ choices: [{ message: { content: "mock result" } }] }), { status: 200 });
    }) as any;
  });
  await page.evaluate(async () => {
    const s = await window.reader.state();
    await window.reader.saveSettings(s.settings, { context: "test-only", grammar: "test-only", selection: "test-only" });
  });
}
const ai = (feature: "context" | "grammar" | "selection" = "context") => page.evaluate(async f => {
  try { return await window.reader.ai({ feature: f, text: "original text", context: "original paragraph", operationId: "consent-test" }); }
  catch (error) { return String(error); }
}, feature);

test("session consent covers explicit requests, survives reload, revokes, and expires on exit", async () => {
  await mockAI();
  const toggle = page.getByRole("switch", { name: /本次 AI 授权/ });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  const details = await desktop.evaluate(() => (globalThis as any).aiTest.dialogs[0].detail);
  expect(details).toContain("语境释义"); expect(details).toContain("语法分析"); expect(details).toContain("新闻筛选");
  expect(await desktop.evaluate(() => (globalThis as any).aiTest.requests.length)).toBe(0);
  for (const feature of ["context", "grammar", "selection"] as const) expect(await ai(feature)).toBe("mock result");
  expect(await desktop.evaluate(() => (globalThis as any).aiTest.dialogs.length)).toBe(1);
  expect(await desktop.evaluate(() => (globalThis as any).aiTest.requests.every((r: any) => r.options.redirect === "error"))).toBe(true);
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await page.evaluate(async () => {
    const s = await window.reader.state(); s.settings.dailyMinutes = 45;
    await window.reader.saveSettings(s.settings, {});
  });
  expect((await page.evaluate(() => window.reader.aiConsentStatus())).enabled).toBe(true);
  await desktop.evaluate(() => { (globalThis as any).aiTest.holdRequest = true; });
  const pending = ai();
  await expect.poll(() => desktop.evaluate(() => (globalThis as any).aiTest.requests.length)).toBe(4);
  await toggle.click();
  expect(await pending).toContain("取消");
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await desktop.evaluate(() => { (globalThis as any).aiTest.response = 0; });
  expect(await ai()).toContain("取消");
  expect(await desktop.evaluate(() => (globalThis as any).aiTest.requests.length)).toBe(4);
  await desktop.evaluate(() => { (globalThis as any).aiTest.response = 1; });
  await toggle.click();
  await desktop.close(); await launch();
  await expect(page.getByRole("switch", { name: /本次 AI 授权/ })).toHaveAttribute("aria-checked", "false");
});

test("native per-request confirmation cannot be bypassed; configuration and restore invalidate grants", async () => {
  await mockAI();
  await desktop.evaluate(() => { (globalThis as any).aiTest.response = 0; });
  const denied = await page.evaluate(async () => {
    try { return await window.reader.ai({ feature: "context", text: "text", approved: true, operationId: "forged" } as any); }
    catch (error) { return String(error); }
  });
  expect(denied).toContain("取消");
  expect(await desktop.evaluate(() => (globalThis as any).aiTest.requests.length)).toBe(0);
  await desktop.evaluate(() => { (globalThis as any).aiTest.response = 1; });
  expect(await ai()).toBe("mock result");
  expect((await page.evaluate(() => window.reader.aiConsentStatus())).enabled).toBe(false);
  for (const field of ["model", "baseUrl", "provider", "key"] as const) {
    await page.evaluate(() => window.reader.setAIConsent(true));
    await page.evaluate(async field => {
      const s = await window.reader.state();
      const c = s.settings.models.grammar;
      if (field === "model") c.model = "other-model";
      if (field === "baseUrl") c.baseUrl = "https://other.example/v1";
      if (field === "provider") c.provider = c.provider === "deepseek" ? "compatible" : "deepseek";
      await window.reader.saveSettings(s.settings, field === "key" ? { grammar: "another-test-key" } : {});
    }, field);
    expect((await page.evaluate(() => window.reader.aiConsentStatus())).enabled).toBe(false);
  }
  await page.evaluate(() => window.reader.setAIConsent(true));
  const backupPath = path.join(directory, "consent-backup.json");
  await desktop.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as any;
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as any;
  }, backupPath);
  await page.evaluate(() => window.reader.backup());
  const backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));
  expect(JSON.stringify(backup)).not.toMatch(/aiConsent|sessionAI|revision/);
  await page.evaluate(() => window.reader.restore());
  expect((await page.evaluate(() => window.reader.aiConsentStatus())).enabled).toBe(false);
});

test("revocation or settings change while dialog is open cannot grant stale consent or send stale requests", async () => {
  await mockAI();
  await desktop.evaluate(() => { (globalThis as any).aiTest.holdDialog = true; });
  const grant = page.evaluate(() => window.reader.setAIConsent(true));
  await expect.poll(() => desktop.evaluate(() => !!(globalThis as any).aiTest.resolveDialog)).toBe(true);
  await page.evaluate(() => window.reader.setAIConsent(false));
  await desktop.evaluate(() => { (globalThis as any).aiTest.resolveDialog({ response: 1 }); });
  expect((await grant).enabled).toBe(false);
  await desktop.evaluate(() => { delete (globalThis as any).aiTest.resolveDialog; });
  const pending = ai();
  await expect.poll(() => desktop.evaluate(() => !!(globalThis as any).aiTest.resolveDialog)).toBe(true);
  await page.evaluate(async () => {
    const s = await window.reader.state(); s.settings.models.context.baseUrl = "https://changed.example/v1";
    await window.reader.saveSettings(s.settings, {});
  });
  await desktop.evaluate(() => { (globalThis as any).aiTest.resolveDialog({ response: 1 }); });
  expect(await pending).toContain("取消");
  expect(await desktop.evaluate(() => (globalThis as any).aiTest.requests.length)).toBe(0);
});
