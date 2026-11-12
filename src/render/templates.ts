import type { DensityId, ResumeData } from "../domain/resume.ts";
import { escapeHtml as h } from "../domain/text.ts";
import { appearanceTokens } from "./theme.ts";

/**
 * 模板 = 布局基底（layout base）× 主题令牌（tokens）。
 * 基底承载结构与分页规则（resume.css 中的 .template-<base> 与 paginator 的 @page），
 * tokens 是注入到 .resume-document 内联样式的 CSS 变量，预览 / PDF / HTML 导出三路同源。
 * 新增“同构变体”只需一条 tokens 记录；新增基底才需要写 CSS 与分页契约。
 */
export type TemplateBase = "classic" | "engineering" | "academic" | "editorial" | "gallery";

export type TemplateId = "classic" | "engineering" | "academic" | "editorial" | "gallery";

export interface ResumeTemplate {
  id: TemplateId;
  name: string;
  description: string;
  usage: "ATS 友好" | "展示版";
  density: "舒展" | "标准" | "紧凑";
  base: TemplateBase;
  /** CSS 变量覆盖；键必须是 resume.css 中声明的 --token。 */
  tokens?: Record<string, string>;
}

/* 配色差异交给工具栏的主题色选择（appearance.accent），模板清单只保留布局有实质差异的基底。 */
export const templates: ResumeTemplate[] = [
  { id: "classic", name: "专业单栏", description: "清晰、均衡，适合大多数正式投递", usage: "ATS 友好", density: "标准", base: "classic" },
  { id: "engineering", name: "工程单栏", description: "高信息密度，突出经历、项目与技术栈", usage: "ATS 友好", density: "紧凑", base: "engineering" },
  { id: "academic", name: "学院经典", description: "克制的衬线排版，适合资深与研究型表达", usage: "ATS 友好", density: "标准", base: "academic" },
  { id: "editorial", name: "墨绿编辑", description: "强化个人品牌与阅读层次，适合直投", usage: "展示版", density: "舒展", base: "editorial" },
  { id: "gallery", name: "雅白现代", description: "大留白与克制强调色，适合设计感直投", usage: "展示版", density: "舒展", base: "gallery" },
];

export const isTemplateId = (value: string | null | undefined): value is TemplateId =>
  value !== null && value !== undefined && templates.some((template) => template.id === value);

export const templateById = (id: TemplateId): ResumeTemplate =>
  templates.find((template) => template.id === id) ?? templates[0]!;

const clean = (items: string[]) => items.filter(Boolean);
const bullets = (items: string[]) => {
  const values = clean(items);
  return values.length ? `<ul>${values.map((item) => `<li>${h(item)}</li>`).join("")}</ul>` : "";
};

const contactLine = (data: ResumeData) =>
  clean([data.contact.phone, data.contact.email, data.contact.website, data.contact.location, data.contact.extra])
    .map((item) => `<span>${h(item)}</span>`)
    .join("");

const section = (id: string, title: string, body: string) =>
  body ? `<section class="resume-section" data-section="${id}"><h2>${h(title)}</h2>${body}</section>` : "";

const experienceMarkup = (data: ResumeData) =>
  data.experiences
    .map(
      (item) => `<article class="resume-entry">
        <div class="entry-heading"><div><h3>${h(item.organization)}</h3><p class="entry-role">${h(item.role)}</p></div><time>${h(item.period)}</time></div>
        ${item.summary ? `<p class="entry-summary">${h(item.summary)}</p>` : ""}${bullets(item.highlights)}
      </article>`,
    )
    .join("");

const projectMarkup = (data: ResumeData) =>
  data.projects
    .map(
      (item) => `<article class="resume-entry project-entry">
        <div class="entry-intro">
          <div class="entry-heading"><div><h3>${h(item.name)}</h3><p class="entry-role">${h(item.role)}</p></div><time>${h(item.period)}</time></div>
          ${item.summary ? `<p class="entry-summary">${h(item.summary)}</p>` : ""}
          ${item.stack.length ? `<p class="tech-stack"><strong>技术栈</strong>${item.stack.map((tech) => `<span>${h(tech)}</span>`).join("")}</p>` : ""}
        </div>
        ${bullets(item.highlights)}
      </article>`,
    )
    .join("");

const skillsMarkup = (data: ResumeData) =>
  data.skills
    .map((group) => `<div class="skill-row"><strong>${h(group.name)}</strong><p>${group.items.map(h).join(" · ")}</p></div>`)
    .join("");

const educationMarkup = (data: ResumeData) =>
  data.education
    .map(
      (item) => `<article class="education-row"><div><strong>${h(item.school)}</strong><span>${h([item.major, item.degree].filter(Boolean).join(" · "))}</span></div><time>${h(item.period)}</time></article>`,
    )
    .join("");

export interface RenderOptions {
  template: TemplateId;
  /** 六位 hex 主题色；空/缺省用模板自带配色。 */
  accent?: string;
  density?: DensityId;
}

const tokenStyle = (tokens: Record<string, string>): string => {
  const declarations = Object.entries(tokens).map(([key, value]) => `${key}:${value}`).join(";");
  return declarations ? ` style="${h(declarations)}"` : "";
};

export function renderResume(data: ResumeData, options: TemplateId | RenderOptions): string {
  const resolved = typeof options === "string" ? { template: options } : options;
  const template = templateById(resolved.template);
  // 用户主题色/密度派生的变量后置，覆盖模板变体自带 tokens。
  const tokens = {
    ...template.tokens,
    ...appearanceTokens(template.base, resolved.accent ?? "", resolved.density ?? "standard"),
  };
  const header = `<header class="resume-header"><div class="name-block"><h1>${h(data.contact.name)}</h1><p>${h(data.contact.headline)}</p></div><div class="contact-line">${contactLine(data)}</div></header>`;
  const sections = {
    summary: data.summary ? section("summary", "个人概述", `<p class="profile-summary">${h(data.summary)}</p>`) : "",
    education: section("education", "教育背景", educationMarkup(data)),
    experiences: section("work", "工作经历", experienceMarkup(data)),
    skills: section("skills", "专业技能", skillsMarkup(data)),
    projects: section("projects", "项目经历", projectMarkup(data)),
  };
  const body = data.sectionOrder.map((sectionId) => sections[sectionId]).join("");
  return `<div class="resume-document template-${template.base}" data-template="${template.id}"${tokenStyle(tokens)}>${header}<main>${body}</main></div>`;
}
