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
    args: ["--no-sandbox", "--disable-gpu", "."],
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
