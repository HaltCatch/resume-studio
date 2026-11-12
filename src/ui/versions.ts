import type { ResumeRecord, ResumeVersionSummary } from "../domain/record";
import { escapeHtml as h } from "../domain/text";

const formatTime = (iso: string): string => {
  const time = new Date(iso);
  return Number.isNaN(time.getTime())
    ? iso
    : time.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
};

const fullTime = (iso: string): string => {
  const time = new Date(iso);
  return Number.isNaN(time.getTime()) ? iso : time.toLocaleString("zh-CN");
};

export function renderVersionList(items: ResumeVersionSummary[], current: ResumeRecord | null): string {
  const currentRow = current ? `<li class="version-row">
    <span class="version-chip" title="保存于 ${h(fullTime(current.updatedAt))}">v${current.version ?? "?"}</span>
    <div class="version-meta"><strong>${h(formatTime(current.updatedAt))}</strong><span>${h(current.note || "当前内容")}</span></div>
    <span class="version-badge">最近</span>
  </li>` : "";
  if (!items.length) {
    return `${currentRow ? `<ul class="version-list">${currentRow}</ul>` : ""}
      <p class="version-empty">还没有历史版本。持续编辑一段时间后会自动记录，恢复历史版本前也会先保存当前状态。</p>`;
  }
  return `<ul class="version-list">${currentRow}${items.map((item) => `<li class="version-row">
    <span class="version-chip" title="保存于 ${h(fullTime(item.savedAt))}">v${item.version}</span>
    <div class="version-meta"><strong>${h(formatTime(item.savedAt))}</strong><span>${h(item.note || item.title)}</span></div>
    <button type="button" class="text-action" data-command="restore-version" data-version="${h(item.versionId)}">还原</button>
  </li>`).join("")}</ul>`;
}
