import { access } from "node:fs/promises";
import { chromium, type Browser } from "playwright-core";

export interface PdfRenderer {
  render(url: string): Promise<Buffer>;
  close(): Promise<void>;
}

const executableCandidates = (): string[] => [
  process.env.CHROMIUM_EXECUTABLE_PATH,
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter((item): item is string => Boolean(item));

export async function findChromiumExecutable(): Promise<string> {
  for (const candidate of executableCandidates()) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // 继续检查下一个明确路径，避免依赖 shell PATH 与平台差异。
    }
  }
  throw new Error("未找到 Chromium/Edge/Chrome；请安装浏览器或设置 CHROMIUM_EXECUTABLE_PATH");
}

export class PlaywrightPdfRenderer implements PdfRenderer {
  private browserPromise?: Promise<Browser>;
  private idleTimer?: NodeJS.Timeout;
  private activeRenders = 0;
  private queue: Promise<void> = Promise.resolve();

  private readonly idleTimeoutMs = (() => {
    const configured = Number(process.env.PDF_BROWSER_IDLE_MS ?? 30_000);
    return Number.isFinite(configured) && configured >= 0 ? configured : 30_000;
  })();

  private cancelIdleClose(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private scheduleIdleClose(): void {
    this.cancelIdleClose();
    if (!this.browserPromise || this.activeRenders > 0) return;
    this.idleTimer = setTimeout(() => { void this.close(); }, this.idleTimeoutMs);
    this.idleTimer.unref();
  }

  private browser(): Promise<Browser> {
    this.cancelIdleClose();
    if (!this.browserPromise) {
      const pending = findChromiumExecutable().then((executablePath) => chromium.launch({
        executablePath,
        headless: true,
        args: process.platform === "linux" ? ["--no-sandbox"] : [],
      }));
      this.browserPromise = pending;
      const reset = () => { if (this.browserPromise === pending) this.browserPromise = undefined; };
      void pending.then((browser) => { browser.once("disconnected", reset); }, reset);
    }
    return this.browserPromise;
  }

  render(url: string): Promise<Buffer> {
    // 一次只分页一份文档，避免连续点击将多个 Chromium 页面同时挤入小容器。
    if (this.activeRenders >= 3) return Promise.reject(new Error("PDF 导出繁忙，请稍后重试"));
    this.activeRenders += 1;
    this.cancelIdleClose();
    const result = this.queue.then(() => this.renderPage(url));
    this.queue = result.then(() => undefined, () => undefined);
    return result.finally(() => {
      this.activeRenders -= 1;
      this.scheduleIdleClose();
    });
  }

  private async renderPage(url: string): Promise<Buffer> {
    let page: Awaited<ReturnType<Browser["newPage"]>> | undefined;
    let printTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const browser = await this.browser();
      page = await browser.newPage();
      // 以打印路由的明确完成信号为准；网络空闲不代表字体与分页已完成。
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForFunction(
        () => (document.documentElement.dataset.renderReady === "true" && document.fonts.status === "loaded") || Boolean(document.documentElement.dataset.renderError),
        undefined,
        { timeout: 30_000 },
      );
      const renderError = await page.evaluate(() => document.documentElement.dataset.renderError);
      if (renderError) throw new Error(renderError);
      const pdf = await Promise.race([page.pdf({
        preferCSSPageSize: true,
        printBackground: true,
        displayHeaderFooter: false,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        tagged: true,
      }), new Promise<never>((_, reject) => {
        printTimer = setTimeout(() => reject(new Error("PDF printing timed out")), 30_000);
      })]);
      return Buffer.from(pdf);
    } finally {
      if (printTimer) clearTimeout(printTimer);
      await page?.close().catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    this.cancelIdleClose();
    if (!this.browserPromise) return;
    const browser = await this.browserPromise.catch(() => undefined);
    this.browserPromise = undefined;
    await browser?.close();
  }
}
