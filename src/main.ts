import { serializeResumeMarkdown, serializeResumeText } from "./application/exporters/markdown";
import { serializeResumeHtml } from "./application/exporters/html";
import "./styles.css";
import "./resume.css";
import { ApiError, resumeApi, browserOnly } from "./application/api";
import { addResumeItem, createResumeItemId, isResumeCollection, removeResumeItem, setResumeSectionOrder, updateResumeField } from "./application/editor";
import { importResumeText } from "./application/importer";
import { loadPreference, savePreference } from "./application/preferences";
import { currentRoute, navigate } from "./application/router";
import { SaveScheduler } from "./application/save-scheduler";
import { cloneResume, createDefaultResume, DEFAULT_SECTION_ORDER, type DensityId, type ResumeSectionId } from "./domain/resume";
import { isDensityId } from "./render/theme";
import type { ResumeRecord } from "./domain/record";
import { exportFileName, type ExportFormat } from "./domain/filename";
import { reviewResume } from "./domain/review";
import { isPaperId, isPreviewZoom, type PaperId, type PreviewZoom } from "./domain/paper";
import { isTemplateId, templates, type TemplateId } from "./render/templates";
import { renderEditor } from "./ui/editor";
import { PreviewPane, type PreviewView } from "./ui/preview";
import { renderReviewCard } from "./ui/review";
import { renderEditorShell, renderLibraryShell, renderPreviewShell } from "./ui/shell";
import { renderVersionList } from "./ui/versions";

/* 模板/主题色/密度是文档属性（appearance，随简历保存）；纸张/缩放是本机查看偏好。 */
const PAPER_STORAGE_KEY = "resume-studio:paper";
const ZOOM_STORAGE_KEY = "resume-studio:zoom";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("应用挂载节点不存在");

const storedPaper = loadPreference(PAPER_STORAGE_KEY);
const storedZoom = loadPreference(ZOOM_STORAGE_KEY);
let activeTemplate: TemplateId = "classic";
let activeAccent = "";
let activeDensity: DensityId = "standard";
let activePaper: PaperId = isPaperId(storedPaper) ? storedPaper : "a4";
let activeZoom: PreviewZoom = isPreviewZoom(storedZoom) ? storedZoom : "fit";
let currentRecord: ResumeRecord | null = null;
let routeVersion = 0;
let toastTimer: number | undefined;
const sectionIdSet = new Set<string>(DEFAULT_SECTION_ORDER);

interface SectionDragState {
  element: HTMLElement;
  handle: HTMLButtonElement;
  pointerId: number;
  startX: number;
  startY: number;
  timer: number;
  started: boolean;
}

let sectionDrag: SectionDragState | null = null;

const isResumeSectionId = (value: string | undefined): value is ResumeSectionId =>
  value !== undefined && sectionIdSet.has(value);

const preview = new PreviewPane();
const view = (): PreviewView => ({ template: activeTemplate, paper: activePaper, zoom: activeZoom, accent: activeAccent, density: activeDensity });

/** 从当前简历读入外观设置。 */
const adoptAppearance = (): void => {
  if (!currentRecord) return;
  const appearance = currentRecord.data.appearance;
  activeTemplate = isTemplateId(appearance.template) ? appearance.template : "classic";
  activeAccent = appearance.accent;
  activeDensity = appearance.density;
};

/** 编辑模式下外观改动写回简历数据并触发自动保存；预览模式仅临时生效。 */
const persistAppearance = (): void => {
  if (!currentRecord || currentRoute().mode !== "edit") return;
  currentRecord.data.appearance = { template: activeTemplate, accent: activeAccent, density: activeDensity };
  scheduleSave();
};

const showToast = (message: string): void => {
  const element = document.querySelector<HTMLDivElement>("#toast");
  if (!element) return;
  window.clearTimeout(toastTimer);
  element.textContent = message;
  element.classList.add("visible");
  toastTimer = window.setTimeout(() => element.classList.remove("visible"), 2600);
};

const setSaveStatus = (message: string): void => {
  const element = document.querySelector<HTMLElement>("#save-status");
  if (element) element.textContent = message;
};

const saver = new SaveScheduler({
  delayMs: 550,
  async save() {
    if (!currentRecord) return;
    const snapshot = {
      id: currentRecord.id,
      title: currentRecord.title,
      data: cloneResume(currentRecord.data),
      expectedUpdatedAt: currentRecord.updatedAt,
    };
    setSaveStatus("正在保存…");
    const saved = await resumeApi.update(snapshot.id, snapshot);
    if (currentRecord?.id === saved.id) currentRecord = { ...saved, data: currentRecord.data };
    setSaveStatus(browserOnly ? "已保存到此浏览器" : "已保存到服务端");
  },
  onError(error) {
    if (error instanceof ApiError && error.status === 409) {
      setSaveStatus("保存冲突");
      showToast(error.message);
      return;
    }
    setSaveStatus("保存失败");
    showToast(error instanceof Error ? error.message : "保存失败");
  },
});

const scheduleSave = (): void => {
  setSaveStatus("有未保存修改");
  saver.markDirty();
};

const refreshVersions = async (): Promise<void> => {
  if (!currentRecord) return;
  const list = document.querySelector<HTMLElement>("#version-list");
  if (!list) return;
  list.innerHTML = `<p class="version-empty">正在读取版本…</p>`;
  try {
    list.innerHTML = renderVersionList(await resumeApi.listVersions(currentRecord.id), currentRecord);
  } catch {
    list.innerHTML = `<p class="version-empty">版本读取失败，请稍后再试。</p>`;
  }
};

const renderEditData = (): void => {
  if (!currentRecord) return;
  const editor = document.querySelector<HTMLDivElement>("#editor");
  const review = document.querySelector<HTMLDivElement>("#resume-review");
  const title = document.querySelector<HTMLInputElement>("#resume-title");
  if (editor) editor.innerHTML = renderEditor(currentRecord.data);
  if (review) review.innerHTML = renderReviewCard(reviewResume(currentRecord.data));
  if (title) title.value = currentRecord.title;
  void preview.render(currentRecord.data, view());
};

const sectionOrderFromEditor = (): ResumeSectionId[] => {
  const editor = document.querySelector<HTMLElement>("#editor");
  if (!editor) return [];
  return [...editor.querySelectorAll<HTMLElement>(".editor-section[data-section-id]")]
    .map((section) => section.dataset.sectionId)
    .filter(isResumeSectionId);
};

const persistSectionOrderFromEditor = (): void => {
  if (!currentRecord) return;
  const order = sectionOrderFromEditor();
  if (!order.length || order.join(",") === currentRecord.data.sectionOrder.join(",")) return;
  setResumeSectionOrder(currentRecord.data, order);
  void preview.render(currentRecord.data, view());
  scheduleSave();
};

const moveSectionWithKeyboard = (sectionId: ResumeSectionId, direction: -1 | 1): void => {
  if (!currentRecord) return;
  const order = [...currentRecord.data.sectionOrder];
  const index = order.indexOf(sectionId);
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= order.length) return;
  const current = order[index];
  const next = order[destination];
  if (!current || !next) return;
  order[index] = next;
  order[destination] = current;
  setResumeSectionOrder(currentRecord.data, order);
  renderEditData();
  scheduleSave();
  window.requestAnimationFrame(() =>
    document.querySelector<HTMLButtonElement>(`[data-section-id="${sectionId}"] [data-section-drag-handle]`)?.focus(),
  );
};

const clearSectionDrag = (): SectionDragState | null => {
  const drag = sectionDrag;
  if (!drag) return null;
  window.clearTimeout(drag.timer);
  drag.element.classList.remove("is-dragging");
  drag.handle.setAttribute("aria-grabbed", "false");
  document.body.classList.remove("is-section-dragging");
  sectionDrag = null;
  return drag;
};

const startSectionDrag = (drag: SectionDragState): void => {
  if (sectionDrag !== drag) return;
  drag.started = true;
  drag.element.classList.add("is-dragging");
  drag.handle.setAttribute("aria-grabbed", "true");
  document.body.classList.add("is-section-dragging");
};

const renderRoute = async (): Promise<void> => {
  const version = ++routeVersion;
  preview.invalidate();
  preview.detach();
  const route = currentRoute();
  document.documentElement.removeAttribute("data-render-ready");
  document.documentElement.removeAttribute("data-render-error");
  document.body.classList.toggle("print-mode", route.mode === "print");
  app.innerHTML = `<main class="loading-state">正在读取简历…</main>`;
  try {
    if (route.mode === "library") {
      currentRecord = null;
      saver.reset();
      const items = await resumeApi.list();
      if (version !== routeVersion) return;
      app.innerHTML = renderLibraryShell(items);
      return;
    }
    currentRecord = await resumeApi.get(route.id!);
    saver.reset();
    adoptAppearance();
    if (version !== routeVersion) return;
    if (route.mode === "print") {
      // 打印路由参数已由服务端归一化：accent 缺省即“无主题色”，不回退到文档设置。
      activeTemplate = route.template ?? "classic";
      activePaper = route.paper ?? "a4";
      activeAccent = route.accent ?? "";
      activeDensity = route.density ?? "standard";
      app.innerHTML = `<main class="print-document"><div class="paper-stage"><div class="paper-frame" id="paper-frame"><div id="resume-pages" class="paged-preview"></div></div></div></main>`;
      preview.attach();
      await preview.render(currentRecord.data, view());
      if (version === routeVersion) document.documentElement.dataset.renderReady = "true";
      return;
    }
    app.innerHTML = route.mode === "edit" ? renderEditorShell(currentRecord, templates) : renderPreviewShell(currentRecord, templates);
    preview.attach();
    if (route.mode === "edit") renderEditData();
    else await preview.render(currentRecord.data, view());
  } catch (error) {
    document.documentElement.dataset.renderError = error instanceof Error ? error.message : "渲染失败";
    app.innerHTML = `<main class="error-state"><strong>暂时无法打开</strong><p>${error instanceof Error ? error.message : "未知错误"}</p><button class="primary-button" data-command="library">返回简历库</button></main>`;
  }
};

document.addEventListener("input", (event) => {
  if (!currentRecord || currentRoute().mode !== "edit") return;
  const target = event.target as HTMLInputElement | HTMLTextAreaElement;
  if (target.id === "resume-title") {
    currentRecord.title = target.value;
    scheduleSave();
    return;
  }
  if (!target.dataset.path) return;
  if (updateResumeField(currentRecord.data, target.dataset.path, target.value)) {
    void preview.render(currentRecord.data, view(), { debounceMs: 90 });
    const review = document.querySelector<HTMLDivElement>("#resume-review");
    if (review) review.innerHTML = renderReviewCard(reviewResume(currentRecord.data));
    scheduleSave();
  }
});

document.addEventListener("keydown", (event) => {
  const handle = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-section-drag-handle]");
  if (handle && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
    const sectionId = handle.closest<HTMLElement>("[data-section-id]")?.dataset.sectionId;
    if (!isResumeSectionId(sectionId)) return;
    event.preventDefault();
    moveSectionWithKeyboard(sectionId, event.key === "ArrowUp" ? -1 : 1);
    return;
  }
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  const switcher = (event.target as HTMLElement).closest<HTMLElement>(".template-switcher");
  if (!switcher) return;
  const buttons = [...switcher.querySelectorAll<HTMLButtonElement>("[data-template]")];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (index < 0) return;
  event.preventDefault();
  const next = buttons[(index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length];
  next?.click();
  next?.focus();
});

document.addEventListener("pointerdown", (event) => {
  const handle = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-section-drag-handle]");
  const section = handle?.closest<HTMLElement>(".editor-section[data-section-id]");
  if (!handle || !section || !currentRecord || currentRoute().mode !== "edit" || event.button !== 0) return;
  event.preventDefault();
  clearSectionDrag();
  const drag: SectionDragState = {
    element: section,
    handle,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    timer: 0,
    started: false,
  };
  sectionDrag = drag;
  drag.timer = window.setTimeout(() => startSectionDrag(drag), 180);
  handle.setPointerCapture(event.pointerId);
});

document.addEventListener("pointermove", (event) => {
  const drag = sectionDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  if (!drag.started) {
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 8) clearSectionDrag();
    return;
  }
  event.preventDefault();
  const editor = document.querySelector<HTMLElement>("#editor");
  if (!editor) return;
  const sections = [...editor.querySelectorAll<HTMLElement>(".editor-section[data-section-id]")];
  const before = sections.find((section) => section !== drag.element && event.clientY < section.getBoundingClientRect().top + section.getBoundingClientRect().height / 2);
  if (before) editor.insertBefore(drag.element, before);
  else editor.append(drag.element);
});

const finishSectionDrag = (event: PointerEvent): void => {
  const drag = sectionDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  const completed = clearSectionDrag();
  if (completed?.started) persistSectionOrderFromEditor();
};

document.addEventListener("pointerup", finishSectionDrag);
document.addEventListener("pointercancel", finishSectionDrag);
document.addEventListener("click", (event) => {
  if ((event.target as HTMLElement).closest("[data-section-drag-handle]")) event.preventDefault();
});

let exportingPdf = false;

document.addEventListener("click", async (event) => {
  const target = event.target as HTMLElement;
  const versionSummary = target.closest<HTMLElement>("#version-panel summary");
  if (versionSummary) {
    const panel = versionSummary.closest<HTMLDetailsElement>("#version-panel");
    if (panel && !panel.open) void refreshVersions();
  }

  const button = target.closest<HTMLButtonElement>("button");
  if (!button) return;

  if (isTemplateId(button.dataset.template)) {
    activeTemplate = button.dataset.template;
    persistAppearance();
    if (currentRecord) void preview.render(currentRecord.data, view());
    return;
  }

  if (button.classList.contains("accent-swatch") && button.dataset.accent !== undefined) {
    activeAccent = button.dataset.accent;
    persistAppearance();
    if (currentRecord) void preview.render(currentRecord.data, view());
    return;
  }

  if (button.dataset.action && isResumeCollection(button.dataset.list) && currentRecord) {
    const list = button.dataset.list;
    if (button.dataset.action === "remove") removeResumeItem(currentRecord.data, list, Number(button.dataset.index));
    if (button.dataset.action === "add") addResumeItem(currentRecord.data, list, createResumeItemId(list));
    renderEditData();
    scheduleSave();
    return;
  }

  if (button.dataset.command === "restore-version" && currentRecord && button.dataset.version) {
    if (!window.confirm("恢复到该版本？当前内容会先自动存为一个新版本。")) return;
    try {
      await saver.flush();
      const restored = await resumeApi.restoreVersion(currentRecord.id, button.dataset.version);
      currentRecord = restored;
      saver.reset();
      renderEditData();
      showToast("已恢复所选版本");
      void refreshVersions();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "恢复失败");
    }
    return;
  }

  const id = button.dataset.id;
  switch (button.dataset.command) {
    case "library":
      await saver.flush();
      navigate("#/");
      break;
    case "open": navigate(`#/resume/${encodeURIComponent(id ?? "")}`); break;
    case "edit": navigate(`#/resume/${encodeURIComponent(id ?? currentRecord?.id ?? "")}/edit`); break;
    case "preview":
      await saver.flush();
      navigate(`#/resume/${encodeURIComponent(currentRecord?.id ?? "")}`);
      break;
    case "create": {
      try {
        const created = await resumeApi.create({ title: "新简历", data: createDefaultResume() });
        navigate(`#/resume/${encodeURIComponent(created.id)}/edit`);
      } catch (error) {
        showToast(error instanceof Error ? error.message : "新建失败");
      }
      break;
    }
    case "import": document.querySelector<HTMLInputElement>("#import-file")?.click(); break;
    case "delete":
      if (id && window.confirm("确认删除这份简历？请先导出需要保留的备份。")) {
        await resumeApi.remove(id);
        showToast("简历已删除");
        await renderRoute();
      }
      break;
  }

  const format = button.dataset.export;
  if (format && currentRecord) {
    if (format === "pdf" && exportingPdf) {
      showToast("PDF 正在生成，请稍候。");
      return;
    }
    const summary = button.closest("details")?.querySelector("summary");
    const summaryHtml = summary?.innerHTML;
    if (format === "pdf") {
      exportingPdf = true;
      button.disabled = true;
      if (summary) {
        summary.textContent = "正在生成 PDF…";
        summary.setAttribute("aria-busy", "true");
      }
    }
    button.closest("details")?.removeAttribute("open");
    try {
      await saver.flush();
      if (browserOnly && format === "pdf") {
        window.print();
        return;
      }
      const anchor = document.createElement("a");
      const exportParams = new URLSearchParams({ template: activeTemplate, paper: activePaper, accent: activeAccent, density: activeDensity });
      const url = `/api/resumes/${encodeURIComponent(currentRecord.id)}/export/${format}?${exportParams}`;
      const fileName = exportFileName(currentRecord.title, format as ExportFormat);
      const browserContent = browserOnly ? (
        format === "json" ? JSON.stringify(currentRecord.data, null, 2) :
        format === "html" ? serializeResumeHtml(currentRecord.data, {template: activeTemplate, accent: activeAccent, density: activeDensity}, activePaper) :
        format === "text" || format === "txt" ? serializeResumeText(currentRecord.data) : serializeResumeMarkdown(currentRecord.data)
      ) : undefined;
      const blobUrl = browserContent !== undefined ? URL.createObjectURL(new Blob([browserContent], {type: format === "html" ? "text/html;charset=utf-8" : "text/plain;charset=utf-8"})) : format === "pdf" ? URL.createObjectURL(await resumeApi.exportPdf(url)) : undefined;
      anchor.href = blobUrl ?? url;
      anchor.download = fileName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      if (blobUrl) window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      if (format === "pdf") showToast("PDF 已生成，下载已开始。");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "导出失败，请稍后重试。");
    } finally {
      if (format === "pdf") {
        exportingPdf = false;
        button.disabled = false;
        if (summary && summaryHtml !== undefined) {
          summary.innerHTML = summaryHtml;
          summary.removeAttribute("aria-busy");
        }
      }
    }
  }
});

document.addEventListener("change", async (event) => {
  const input = event.target as HTMLInputElement;
  if (input.id === "paper-size" && isPaperId(input.value)) {
    activePaper = input.value;
    savePreference(PAPER_STORAGE_KEY, activePaper);
    if (currentRecord) await preview.render(currentRecord.data, view());
    return;
  }
  if (input.id === "preview-zoom" && isPreviewZoom(input.value)) {
    activeZoom = input.value;
    savePreference(ZOOM_STORAGE_KEY, activeZoom);
    preview.applyView(view());
    return;
  }
  if (input.id === "density-select" && isDensityId(input.value)) {
    activeDensity = input.value;
    persistAppearance();
    if (currentRecord) await preview.render(currentRecord.data, view());
    return;
  }
  if (input.id === "accent-custom") {
    activeAccent = input.value;
    persistAppearance();
    if (currentRecord) await preview.render(currentRecord.data, view());
    return;
  }
  if (input.id !== "import-file") return;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const imported = importResumeText(file.name, file.type, await file.text());
    const title = file.name.replace(/\.(md|markdown|json)$/i, "") || "导入的简历";
    if (currentRecord && currentRoute().mode === "edit") {
      currentRecord.data = imported.data;
      currentRecord.title = title;
      renderEditData();
      saver.markDirty();
      await saver.flush();
    } else {
      const created = await resumeApi.create({ title, data: imported.data });
      navigate(`#/resume/${encodeURIComponent(created.id)}`);
    }
    showToast(imported.message);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "导入失败");
  } finally {
    input.value = "";
  }
});

window.addEventListener("hashchange", () => { void saver.flush().then(renderRoute); });
window.addEventListener("resize", () => { if (activeZoom === "fit") preview.applyView(view()); });
if (!location.hash) history.replaceState(null, "", "#/");
void renderRoute();

if (browserOnly) {
 const notice = document.createElement("div");
 notice.className = "browser-storage-notice";
 notice.textContent = "浏览器版 · 简历仅保存在此浏览器，请定期导出备份。PDF 使用浏览器打印。";
 document.body.prepend(notice);
}
