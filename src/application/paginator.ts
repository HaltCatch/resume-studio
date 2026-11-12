import resumeCss from "../resume.css?raw";
import { paperById, type PaperId } from "../domain/paper";
import { templateById, type TemplateBase, type TemplateId } from "../render/templates";

let previewerModule: Promise<typeof import("pagedjs")> | undefined;

const loadPreviewer = () => previewerModule ??= import("pagedjs");

/*
 * 每个布局基底的 @page 规则（主题变体共享其基底的分页契约）。
 * 注意：模板根节点/子元素的 padding 属于内容流，只在文档开头结尾出现一次；
 * 第 2 页起的纵向留白必须由 @page margin 提供，否则内容会顶到纸边（展示版历史 bug）。
 * 首页需要出血效果（如通栏 banner）时，用 @page :first 单独归零上边距。
 */
const pageRules: Record<TemplateBase, string> = {
  classic: "@page { margin: 12mm 16mm 10mm; }",
  engineering: "@page { margin: 9mm 13mm 11mm; }",
  academic: "@page { margin: 13mm 16mm 15mm; }",
  // :first 在 Paged.js 中是独立边距集而非级联覆盖，必须显式声明完整边距，
  // 否则只写 margin-top 会把首页底边距一并归零（首页底部文字被裁的历史 bug）。
  editorial: "@page { margin: 10mm 0 12mm; }\n@page :first { margin: 0 0 12mm; }",
  gallery: "@page { margin: 15mm 18mm 13mm; }",
};

const pagedStyles = (paperId: PaperId, templateId: TemplateId): string => {
  const paper = paperById(paperId);
  const base = templateById(templateId).base;
  const resetsRootPadding = base !== "editorial";
  return `${resumeCss}
@page { size: ${paper.printSize}; }
${pageRules[base]}
.resume-document { page: auto;${resetsRootPadding ? " padding: 0;" : ""} }
`;
};

export async function paginateResume(
  html: string,
  target: HTMLElement,
  paperId: PaperId,
  templateId: TemplateId,
): Promise<number> {
  const { Previewer } = await loadPreviewer();
  const template = document.createElement("template");
  template.innerHTML = html;
  document.querySelectorAll("style[data-pagedjs-inserted-styles]").forEach((style) => style.remove());
  target.replaceChildren();
  target.dataset.template = templateId;
  target.dataset.state = "rendering";

  const previewer = new Previewer();
  const flow = await previewer.preview(
    template.content,
    [{ [location.href]: pagedStyles(paperId, templateId) }],
    target,
  );
  target.dataset.state = "ready";
  target.dataset.pages = String(flow.total);
  return flow.total;
}
