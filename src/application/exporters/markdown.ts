import type { ResumeData } from "../../domain/resume";

const line = (value: string): string => value.replace(/[\r\n]+/g, " ").trim();
const list = (items: string[]): string => items.filter(Boolean).map((item) => `- ${line(item)}`).join("\n");

export function serializeResumeMarkdown(data: ResumeData): string {
  const contact = [
    data.contact.phone && `电话：${line(data.contact.phone)}`,
    data.contact.email && `邮箱：${line(data.contact.email)}`,
    data.contact.website && `网站：${line(data.contact.website)}`,
    data.contact.location && `所在地：${line(data.contact.location)}`,
    data.contact.headline && `求职意向：${line(data.contact.headline)}`,
    data.contact.extra && `其他：${line(data.contact.extra)}`,
  ].filter(Boolean).join("\n");

  const summary = data.summary ? `## 个人概述\n\n${line(data.summary)}` : "";
  const experiences = data.experiences.length ? `## 工作经历\n\n${data.experiences.map((item) => [
    `**${line(item.period)}** **${line(item.organization)}｜${line(item.role)}**`,
    item.summary ? line(item.summary) : "",
    list(item.highlights),
  ].filter(Boolean).join("\n\n")).join("\n\n")}` : "";
  const skills = data.skills.length ? `## 专业技能\n\n${list(data.skills.flatMap((group) => group.items.map((item) => `${group.name}：${item}`)))}` : "";
  const projects = data.projects.length ? `## 项目经历\n\n${data.projects.map((item) => [
    `### ${line(item.name)}`,
    `**${line(item.period)}** **角色：${line(item.role)}**`,
    item.summary ? `**项目简介：** ${line(item.summary)}` : "",
    item.stack.length ? `**技术栈：** ${item.stack.map(line).join(" + ")}` : "",
    list(item.highlights),
  ].filter(Boolean).join("\n\n")).join("\n\n")}` : "";
  const education = data.education.length ? `## 教育背景\n\n${data.education.map((item) =>
    `**${line(item.period)}** **${line(item.school)}｜${line(item.major)}** **${line(item.degree)}**`,
  ).join("\n\n")}` : "";

  const sections = { summary, education, experiences, skills, projects };
  return [`# ${line(data.contact.name)}`, contact, ...data.sectionOrder.map((sectionId) => sections[sectionId])]
    .filter(Boolean)
    .join("\n\n")
    .trim() + "\n";
}

export function serializeResumeText(data: ResumeData): string {
  return serializeResumeMarkdown(data)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*/g, "")
    .replace(/^-\s+/gm, "• ");
}
