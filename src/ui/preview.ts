import { paginateResume } from "../application/paginator";
import { paperById, zoomScale, type PaperId, type PreviewZoom } from "../domain/paper";
import type { DensityId, ResumeData } from "../domain/resume";
import { renderResume, type TemplateId } from "../render/templates";

const MM_TO_CSS_PX = 96 / 25.4;

export interface PreviewView {
  template: TemplateId;
  paper: PaperId;
  zoom: PreviewZoom;
  accent: string;
  density: DensityId;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * 预览管线：模板渲染 → Paged.js 分页 → 缩放视图。
 * 高度同步由 ResizeObserver 驱动：分页容器（transform 缩放不改变布局尺寸，
 * 外框必须用显式高度撑出滚动范围）每次内容变化都会重新同步；
 * 分页进行中跳过测量，避免高度被锁在一页（安卓地址栏收起触发 resize 时的历史 bug）。
 */
export class PreviewPane {
  private version = 0;
  private queue: Promise<number | undefined> = Promise.resolve(undefined);
  private observer: ResizeObserver | undefined;
  private scale = 1;

  /** 路由重建 DOM 后调用。 */
  attach(): void {
    this.detach();
    const pages = document.querySelector<HTMLElement>("#resume-pages");
    if (!pages || typeof ResizeObserver === "undefined") return;
    this.observer = new ResizeObserver(() => this.syncFrameHeight());
    this.observer.observe(pages);
  }

  detach(): void {
    this.observer?.disconnect();
    this.observer = undefined;
  }

  /** 使在途渲染失效（路由切换时调用）。 */
  invalidate(): void {
    this.version += 1;
  }

  applyView(view: PreviewView): void {
    const stage = document.querySelector<HTMLElement>(".paper-stage");
    const frame = document.querySelector<HTMLElement>("#paper-frame");
    if (!stage || !frame) return;
    const paper = paperById(view.paper);
    const availableWidth = Math.max(280, stage.clientWidth - 60);
    const naturalWidth = paper.widthMm * MM_TO_CSS_PX;
    this.scale = zoomScale(view.zoom, Math.min(1, availableWidth / naturalWidth));
    stage.style.setProperty("--paper-width", `${paper.widthMm}mm`);
    stage.style.setProperty("--paper-height", `${paper.heightMm}mm`);
    stage.style.setProperty("--preview-scale", this.scale.toFixed(4));
    document.body.dataset.paper = view.paper;
    const select = document.querySelector<HTMLSelectElement>("#paper-size");
    if (select) select.value = view.paper;
    const dimensions = document.querySelector<HTMLElement>("#paper-dimensions");
    if (dimensions) dimensions.textContent = `${paper.widthMm} × ${paper.heightMm} mm`;
    const zoomSelect = document.querySelector<HTMLSelectElement>("#preview-zoom");
    if (zoomSelect) zoomSelect.value = view.zoom;
    const densitySelect = document.querySelector<HTMLSelectElement>("#density-select");
    if (densitySelect) densitySelect.value = view.density;
    let presetMatched = false;
    document.querySelectorAll<HTMLButtonElement>(".accent-swatch").forEach((button) => {
      const active = button.dataset.accent === view.accent;
      presetMatched ||= active;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    const custom = document.querySelector<HTMLInputElement>("#accent-custom");
    if (custom) {
      custom.classList.toggle("active", !presetMatched && view.accent !== "");
      if (view.accent) custom.value = view.accent;
    }
    frame.style.width = `${Math.ceil(naturalWidth * this.scale)}px`;
    frame.style.minHeight = `${Math.ceil(paper.heightMm * MM_TO_CSS_PX * this.scale)}px`;
    this.syncFrameHeight();
  }

  async render(data: ResumeData, view: PreviewView, options: { debounceMs?: number } = {}): Promise<void> {
    const version = ++this.version;
    if (options.debounceMs) await delay(options.debounceMs);
    if (version !== this.version) return;
    const pages = document.querySelector<HTMLDivElement>("#resume-pages");
    if (!pages) return;
    this.applyView(view);
    const html = renderResume(data, { template: view.template, accent: view.accent, density: view.density });
    document.querySelectorAll<HTMLButtonElement>("[data-template]").forEach((button) => {
      const active = button.dataset.template === view.template;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    this.queue = this.queue.catch(() => undefined).then(async () => {
      if (version !== this.version || !pages.isConnected) return undefined;
      return paginateResume(html, pages, view.paper, view.template);
    });
    const count = await this.queue;
    if (version !== this.version || count === undefined || !pages.isConnected) return;
    const pageCount = document.querySelector<HTMLElement>("#page-count");
    if (pageCount) pageCount.textContent = `${count} 页`;
    this.applyView(view);
  }

  private syncFrameHeight(): void {
    const frame = document.querySelector<HTMLElement>("#paper-frame");
    const pages = document.querySelector<HTMLElement>("#resume-pages");
    if (!frame || !pages) return;
    // 分页进行中不锁定高度；完成后内容尺寸变化会再次触发 ResizeObserver。
    if (pages.dataset.state === "rendering") return;
    frame.style.height = `${Math.ceil(pages.scrollHeight * this.scale)}px`;
  }
}
