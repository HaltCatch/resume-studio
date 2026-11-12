import type { ResumeRecord, ResumeSummary } from "../domain/record";
import { paperSizes, previewZooms } from "../domain/paper";
import { accentPresets, densities } from "../render/theme";
import type { ResumeTemplate } from "../render/templates";
import { escapeHtml as h } from "../domain/text";
import { exportFileName } from "../domain/filename";

const templateSwitcher = (templates: ResumeTemplate[]): string => `<div class="template-switcher" role="tablist" aria-label="简历模板">
  ${templates.map((template) => `<button type="button" role="tab" aria-controls="resume-pages" data-template="${template.id}" title="${h(template.description)}"><span>${h(template.name)}</span><small>${h(template.usage)}</small></button>`).join("")}
</div>`;

const paperControls = (): string => `<div class="paper-controls" aria-label="纸张与预览设置">
  <label class="paper-select"><span>纸张</span><select id="paper-size" aria-label="纸张大小">${paperSizes.map((paper) => `<option value="${paper.id}">${paper.name}</option>`).join("")}</select></label>
  <span class="paper-dimensions" id="paper-dimensions"></span>
  <label class="paper-select"><span>密度</span><select id="density-select" aria-label="排版密度">${densities.map((density) => `<option value="${density.id}">${density.name}</option>`).join("")}</select></label>
  <div class="accent-picker" role="group" aria-label="主题色">
    ${accentPresets.map((preset) => `<button type="button" class="accent-swatch${preset.value ? "" : " swatch-default"}" data-accent="${preset.value}" title="${h(preset.name)}"${preset.value ? ` style="--swatch:${preset.value}"` : ""}></button>`).join("")}
    <input type="color" id="accent-custom" class="accent-custom" title="自定义主题色" aria-label="自定义主题色" value="#1c5942" />
  </div>
  <label class="paper-select"><span>缩放</span><select id="preview-zoom" aria-label="预览缩放">${previewZooms.map((zoom) => `<option value="${zoom.id}">${zoom.name}</option>`).join("")}</select></label>
</div>`;

const paperStage = (): string => `<div class="paper-stage"><div class="paper-frame" id="paper-frame"><div id="resume-pages" class="paged-preview" aria-live="polite"></div></div></div>`;

const exportMenu = (title: string): string => `<details class="export-menu">
  <summary class="primary-button">导出 <span aria-hidden="true">⌄</span></summary>
  <div class="export-menu-panel" role="menu">
    <div class="export-file-name">导出文件名<strong>${h(exportFileName(title, "pdf"))}</strong></div>
    <button type="button" role="menuitem" data-export="markdown"><strong>Markdown</strong><small>可继续编辑的源文件</small></button>
    <button type="button" role="menuitem" data-export="html"><strong>HTML</strong><small>独立网页文件</small></button>
    <button type="button" role="menuitem" data-export="pdf"><strong>PDF</strong><small>按当前模板与纸张精确生成</small></button>
    <button type="button" role="menuitem" data-export="json"><strong>JSON</strong><small>完整结构化备份</small></button>
    <button type="button" role="menuitem" data-export="text"><strong>纯文本</strong><small>适合招聘平台粘贴</small></button>
  </div>
</details>`;

const toast = `<div class="toast" id="toast" role="status" aria-live="polite"></div>`;
const importInput = `<input class="visually-hidden" id="import-file" type="file" accept="application/json,text/markdown,.json,.md,.markdown" />`;

export function renderLibraryShell(items: ResumeSummary[]): string {
  const cards = items.map((item) => `<article class="resume-card" data-resume-id="${h(item.id)}">
    <button type="button" class="resume-card-main" data-command="open" data-id="${h(item.id)}">
      <span class="resume-card-kicker">${h(item.headline || "未设置求职方向")}</span>
      <strong>${h(item.title)}</strong>
      <span class="resume-card-name">${h(item.name)}</span>
      <span class="resume-card-meta">${item.experienceCount} 段经历 · ${item.projectCount} 个项目 · 更新于 ${h(new Date(item.updatedAt).toLocaleDateString("zh-CN"))}</span>
    </button>
    <div class="resume-card-actions">
      <button type="button" class="text-action" data-command="open" data-id="${h(item.id)}">预览</button>
      <button type="button" class="text-action" data-command="edit" data-id="${h(item.id)}">编辑</button>
      <button type="button" class="text-action danger" data-command="delete" data-id="${h(item.id)}">删除</button>
    </div>
  </article>`).join("");
  return `
    <header class="app-header">
      <h1 class="app-title">我的简历</h1>
      <div class="header-actions">
        <button type="button" class="secondary-button" data-command="import">导入简历</button>
        <button type="button" class="primary-button" data-command="create">新建简历</button>
      </div>
    </header>
    <main class="library-page">
      <section class="library-hero"><p>简历库</p><h2>选择一份简历开始</h2><span>每份简历独立管理，可随时预览、编辑和导出。</span></section>
      <section class="resume-grid" aria-label="简历列表">${cards || `<div class="empty-state"><strong>还没有简历</strong><p>新建一份，或从 Markdown / JSON 导入。</p></div>`}</section>
    </main>${importInput}${toast}`;
}

const documentHeader = (record: ResumeRecord, mode: "preview" | "edit"): string => `<header class="app-header">
  <div class="document-heading">
    <button type="button" class="back-button" data-command="library" aria-label="返回简历库">←</button>
    ${mode === "edit" ? `<label class="title-field"><span>简历名称 · 同步作为导出文件名</span><input id="resume-title" aria-label="简历名称（同时作为导出文件名）" value="${h(record.title)}" /></label>` : `<h1 class="app-title">${h(record.title)}</h1>`}
  </div>
  <div class="header-actions">
    ${mode === "edit" ? `<button type="button" class="secondary-button" data-command="import">导入覆盖</button><button type="button" class="secondary-button" data-command="preview">完成编辑</button>` : `<button type="button" class="secondary-button" data-command="edit" data-id="${h(record.id)}">编辑</button>`}
    ${exportMenu(record.title)}
  </div>
</header>`;

export function renderPreviewShell(record: ResumeRecord, templates: ResumeTemplate[]): string {
  return `${documentHeader(record, "preview")}
    <main class="document-preview-page">
      <div class="preview-toolbar">${templateSwitcher(templates)}<div class="preview-options">${paperControls()}<span class="page-count" id="page-count"></span><span class="save-status">已保存</span></div></div>
      ${paperStage()}
    </main>${toast}`;
}

export function renderEditorShell(record: ResumeRecord, templates: ResumeTemplate[]): string {
  return `${documentHeader(record, "edit")}
    <main class="workspace">
      <aside class="editor-pane">
        <div id="resume-review"></div>
        <div id="editor"></div>
        <details class="editor-section version-panel" id="version-panel">
          <summary><span>版本历史</span><span class="summary-meta">自动记录 · 可回滚</span></summary>
          <div class="section-content" id="version-list"></div>
        </details>
      </aside>
      <section class="preview-pane">
        <div class="preview-toolbar">
          ${templateSwitcher(templates)}
          <div class="preview-options">${paperControls()}<span class="page-count" id="page-count"></span><span class="save-status" id="save-status">已保存</span></div>
        </div>
        ${paperStage()}
      </section>
    </main>${importInput}${toast}`;
}
