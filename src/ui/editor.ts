import type { Education, Experience, Project, ResumeData, ResumeSectionId, SkillGroup } from "../domain/resume";
import { escapeHtml as h } from "../domain/text";

const input = (label: string, path: string, value: string, type = "text") => `
  <label class="field"><span>${h(label)}</span><input type="${type}" data-path="${path}" value="${h(value)}" /></label>`;

const textarea = (label: string, path: string, value: string, rows = 3) => `
  <label class="field field-wide"><span>${h(label)}</span><textarea rows="${rows}" data-path="${path}">${h(value)}</textarea></label>`;

const cardHeader = (title: string, list: string, index: number) =>
  `<div class="card-heading"><strong>${h(title || "未命名")}</strong><button class="icon-button danger" type="button" data-action="remove" data-list="${list}" data-index="${index}" aria-label="删除">删除</button></div>`;

const experienceCard = (item: Experience, index: number) => `<div class="editor-card">
  ${cardHeader(item.organization, "experiences", index)}
  <div class="field-grid">${input("公司/组织", `experiences.${index}.organization`, item.organization)}${input("职位", `experiences.${index}.role`, item.role)}${input("时间", `experiences.${index}.period`, item.period)}${textarea("概述", `experiences.${index}.summary`, item.summary)}${textarea("亮点（每行一条）", `experiences.${index}.highlights`, item.highlights.join("\n"), 4)}</div>
</div>`;

const projectCard = (item: Project, index: number) => `<div class="editor-card">
  ${cardHeader(item.name, "projects", index)}
  <div class="field-grid">${input("项目名称", `projects.${index}.name`, item.name)}${input("角色", `projects.${index}.role`, item.role)}${input("时间", `projects.${index}.period`, item.period)}${textarea("项目简介", `projects.${index}.summary`, item.summary)}${textarea("技术栈（逗号分隔）", `projects.${index}.stack`, item.stack.join(", "))}${textarea("工作亮点（每行一条）", `projects.${index}.highlights`, item.highlights.join("\n"), 5)}</div>
</div>`;

const skillCard = (item: SkillGroup, index: number) => `<div class="editor-card compact-card">
  ${cardHeader(item.name, "skills", index)}
  <div class="field-grid">${input("分类", `skills.${index}.name`, item.name)}${textarea("技能（逗号分隔）", `skills.${index}.items`, item.items.join(", "), 2)}</div>
</div>`;

const educationCard = (item: Education, index: number) => `<div class="editor-card compact-card">
  ${cardHeader(item.school, "education", index)}
  <div class="field-grid">${input("学校", `education.${index}.school`, item.school)}${input("专业", `education.${index}.major`, item.major)}${input("学历", `education.${index}.degree`, item.degree)}${input("时间", `education.${index}.period`, item.period)}</div>
</div>`;

const panel = (title: string, list: string | null, content: string, options: { open?: boolean; sectionId?: ResumeSectionId } = {}) => `<details class="editor-section"${options.sectionId ? ` data-section-id="${options.sectionId}"` : ""} ${options.open ? "open" : ""}>
  <summary><span class="section-title">${options.sectionId ? `<button class="section-drag-handle" type="button" data-section-drag-handle aria-label="拖动调整${h(title)}顺序" title="长按拖动调整顺序" aria-grabbed="false"><span aria-hidden="true">⠿</span></button>` : ""}<span>${h(title)}</span></span><span class="summary-meta">展开编辑</span></summary>
  <div class="section-content">${content}${list ? `<button type="button" class="add-button" data-action="add" data-list="${list}">＋ 添加${h(title.replace("信息", ""))}</button>` : ""}</div>
</details>`;

export function renderEditor(data: ResumeData): string {
  const contact = `<div class="field-grid">${input("姓名", "contact.name", data.contact.name)}${input("求职标题", "contact.headline", data.contact.headline)}${input("电话", "contact.phone", data.contact.phone)}${input("邮箱", "contact.email", data.contact.email, "email")}${input("网站", "contact.website", data.contact.website, "url")}${input("所在地", "contact.location", data.contact.location)}${input("其他", "contact.extra", data.contact.extra)}</div>`;
  return [
    panel("基本信息", null, contact, { open: true }),
    ...data.sectionOrder.map((sectionId) => {
      if (sectionId === "summary") return panel("个人概述", null, textarea("一句话定位", "summary", data.summary, 4), { sectionId });
      if (sectionId === "education") return panel("教育信息", "education", data.education.map(educationCard).join(""), { sectionId });
      if (sectionId === "experiences") return panel("工作经历", "experiences", data.experiences.map(experienceCard).join(""), { sectionId });
      if (sectionId === "skills") return panel("专业技能", "skills", data.skills.map(skillCard).join(""), { sectionId });
      return panel("项目经历", "projects", data.projects.map(projectCard).join(""), { sectionId });
    }),
  ].join("");
}
