import type { ResumeData } from "../../domain/resume.ts";
import { escapeHtml } from "../../domain/text.ts";
import { renderResume, type RenderOptions, type TemplateId } from "../../render/templates.ts";
import { paperById, type PaperId } from "../../domain/paper.ts";

/*
 * 独立 HTML 导出的简化样式表。颜色一律引用主题令牌变量
 * （默认值与 resume.css 的 classic 基底一致），renderResume 注入的
 * 内联 tokens（模板变体 / 用户主题色 / 密度）因此对导出同样生效。
 */
const exportCss = (paperId: PaperId): string => {
  const paper = paperById(paperId);
  return `
*{box-sizing:border-box}body{margin:0;background:#eef1ef;color:#1e2421;font-family:Arial,"PingFang SC","Microsoft YaHei",sans-serif}.resume-document{--accent-rule:#1c5942;--accent-ink:#184e39;--accent-soft:#b9cbc2;--headline-ink:#315f4c;width:${paper.widthMm}mm;min-height:${paper.heightMm}mm;margin:20px auto;padding:14mm 16mm;background:#fff;font-size:calc(10pt * var(--density-font,1));line-height:1.52}.resume-header{padding-bottom:calc(6mm * var(--density-space,1));border-bottom:2px solid var(--accent-rule);display:flex;align-items:flex-end;justify-content:space-between;gap:20px}.name-block h1{margin:0;color:var(--name-ink,inherit);font-size:26pt}.name-block p{margin:3mm 0 0;color:var(--headline-ink);font-weight:700}.contact-line{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:2mm 5mm;color:#525d58;font-size:8.5pt}.resume-section{margin-top:calc(5mm * var(--density-space,1))}.resume-section h2{margin:0 0 calc(2.2mm * var(--density-space,1));padding-bottom:1mm;border-bottom:1px solid var(--accent-soft);color:var(--accent-ink);font-size:11.5pt}.resume-entry{margin-top:calc(3.3mm * var(--density-space,1));break-inside:avoid;page-break-inside:avoid}.project-entry{break-inside:auto;page-break-inside:auto}.project-entry .entry-intro{break-inside:avoid;page-break-inside:avoid;break-after:avoid;page-break-after:avoid}.project-entry li{break-inside:avoid;page-break-inside:avoid}.entry-heading,.education-row{display:flex;justify-content:space-between;gap:12px;align-items:baseline}.entry-heading h3{margin:0}.entry-role{display:inline;margin-left:2mm;color:#54605a}.entry-heading time,.education-row time{white-space:nowrap;color:#59645e}.resume-entry ul{padding-left:4.5mm}.tech-stack{display:flex;flex-wrap:wrap;gap:1mm 2.5mm}.tech-stack strong{color:var(--accent-ink)}.skill-row{display:grid;grid-template-columns:25mm 1fr;gap:3mm}.skill-row p{margin:0}.template-editorial{--banner-bg:#183b32;--banner-ink:#f8f3e8;--banner-muted:#cfe3da;--accent-ink:#183b32;padding:0}.template-editorial .resume-header{padding:12mm 16mm 9mm;color:var(--banner-ink);background:var(--banner-bg);border:0}.template-editorial .name-block p,.template-editorial .contact-line{color:var(--banner-muted)}.template-editorial main{padding:5mm 16mm 15mm}@page{size:${paper.printSize};margin:0}@media print{body{background:#fff}.resume-document{margin:0;print-color-adjust:exact;-webkit-print-color-adjust:exact}}`;
};

export function serializeResumeHtml(data: ResumeData, options: TemplateId | RenderOptions, paperId: PaperId = "a4"): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(data.contact.name)} - 简历</title><style>${exportCss(paperId)}</style></head><body>${renderResume(data, options)}</body></html>`;
}
