import { Lexer, type Token, type Tokens } from "marked";
import { createDefaultAppearance, normalizeSectionOrder, SCHEMA_VERSION, type Education, type Experience, type Project, type ResumeData, type ResumeSectionId, type SkillGroup } from "../../domain/resume.ts";

interface MarkdownSection {
  name: string;
  tokens: Token[];
}

type SectionKind = "education" | "work" | "skills" | "projects" | "summary";

const isHeading = (token: Token): token is Tokens.Heading => token.type === "heading";
const isParagraph = (token: Token): token is Tokens.Paragraph => token.type === "paragraph";
const isList = (token: Token): token is Tokens.List => token.type === "list";

const plainText = (value: string): string =>
  value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\*\*|__|~~|`/g, "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();

const strongValues = (value: string): string[] =>
  [...value.matchAll(/\*\*(.+?)\*\*|__(.+?)__/g)].map((match) => plainText(match[1] ?? match[2] ?? "")).filter(Boolean);

const sectionKey = (name: string): SectionKind | undefined => {
  const normalized = plainText(name).replace(/\s/g, "");
  if (/教育背景|教育经历/.test(normalized)) return "education";
  if (/工作经历|工作经验/.test(normalized)) return "work";
  if (/专业技能|技能清单|技能专长/.test(normalized)) return "skills";
  if (/项目经历|项目经验/.test(normalized)) return "projects";
  if (/个人概述|个人简介|自我评价/.test(normalized)) return "summary";
  return undefined;
};

/** Markdown 解析层沿用 work，持久化的模块排序统一使用 experiences。 */
const sectionOrderId = (name: string): ResumeSectionId | undefined => {
  const key = sectionKey(name);
  return key === "work" ? "experiences" : key;
};

const collectSections = (tokens: Token[]): MarkdownSection[] => {
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection | undefined;
  for (const token of tokens) {
    if (isHeading(token) && token.depth === 2) {
      current = { name: plainText(token.text), tokens: [] };
      sections.push(current);
    } else if (current && token.type !== "space") {
      current.tokens.push(token);
    }
  }
  return sections;
};

const extractField = (source: string, labels: string): string => {
  const match = source.match(new RegExp(`(?:${labels})[：:]\\s*([^|<\\n]+)`, "i"));
  return plainText(match?.[1] ?? "");
};

const parseHeader = (source: string): ResumeData["contact"] => {
  const htmlName = source.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const markdownName = source.match(/^#(?!#)\s+(.+)$/m)?.[1];
  const age = extractField(source, "年龄");
  const gender = extractField(source, "性别");
  const other = extractField(source, "其他|补充信息");
  const ageText = age ? (age.endsWith("岁") ? age : `${age}岁`) : "";
  return {
    name: plainText(htmlName ?? markdownName ?? ""),
    headline: extractField(source, "求职意向|求职目标|目标岗位"),
    phone: extractField(source, "电话|手机|手机号"),
    email: extractField(source, "邮箱|电子邮箱|Email"),
    website: extractField(source, "博客|网站|主页|个人主页"),
    location: extractField(source, "所在地|城市|现居地"),
    extra: other || [ageText, gender].filter(Boolean).join(" · "),
  };
};

const parseEducation = (section: MarkdownSection | undefined): Education[] => {
  if (!section) return [];
  return section.tokens.filter(isParagraph).flatMap((token, index) => {
    const values = strongValues(token.text);
    if (values.length < 2) return [];
    const [school = "", major = ""] = values[1]!.split(/[｜|]/).map((item) => item.trim());
    return [{
      id: `markdown-education-${index + 1}`,
      period: values[0] ?? "",
      school,
      major: major.replace(/专业$/, ""),
      degree: values[2] ?? "",
    }];
  });
};

const parseWork = (section: MarkdownSection | undefined): Experience[] => {
  if (!section) return [];
  const experiences: Experience[] = [];
  let current: Experience | undefined;
  for (const token of section.tokens) {
    if (isParagraph(token)) {
      const values = strongValues(token.text);
      if (values.length >= 2 && /\d{4}|至今|现在/.test(values[0] ?? "")) {
        const parts = (values[1] ?? "").split(/[｜|]/).map((item) => item.trim()).filter(Boolean);
        current = {
          id: `markdown-work-${experiences.length + 1}`,
          organization: parts.shift() ?? "",
          role: parts.join(" · "),
          period: values[0] ?? "",
          summary: "",
          highlights: [],
        };
        experiences.push(current);
      } else if (current && plainText(token.text)) {
        current.summary = plainText(token.text);
      }
    } else if (current && isList(token)) {
      current.highlights.push(...token.items.map((item) => plainText(item.text)).filter(Boolean));
    }
  }
  return experiences;
};

const parseSkills = (section: MarkdownSection | undefined): SkillGroup[] => {
  if (!section) return [];
  const groups = new Map<string, string[]>();
  const descriptions = section.tokens.filter(isList).flatMap((token) => token.items.map((item) => plainText(item.text))).filter(Boolean);
  for (const description of descriptions) {
    // “分类：内容”写法归入对应分类；无分类前缀的条目统一归入“专业技能”。
    const explicit = description.match(/^([^：:]{1,24})[：:]\s*(.+)$/);
    const label = explicit ? explicit[1]!.trim() : "专业技能";
    const value = explicit ? explicit[2]!.trim() : description;
    groups.set(label, [...(groups.get(label) ?? []), value]);
  }
  return [...groups.entries()].map(([name, items], index) => ({ id: `markdown-skill-${index + 1}`, name, items }));
};

const labeledValue = (text: string, labels: string): string => {
  const cleaned = plainText(text);
  return cleaned.replace(new RegExp(`^(?:${labels})[：:]\\s*`, "i"), "").trim();
};

const parseProjects = (section: MarkdownSection | undefined): Project[] => {
  if (!section) return [];
  const projects: Project[] = [];
  let current: Project | undefined;
  for (const token of section.tokens) {
    if (isHeading(token) && token.depth === 3) {
      current = {
        id: `markdown-project-${projects.length + 1}`,
        name: plainText(token.text),
        role: "",
        period: "",
        summary: "",
        stack: [],
        highlights: [],
      };
      projects.push(current);
      continue;
    }
    if (!current) continue;
    if (isParagraph(token)) {
      const values = strongValues(token.text);
      if (values.length >= 2 && /\d{4}|至今|现在/.test(values[0] ?? "")) {
        current.period = values[0] ?? "";
        current.role = labeledValue(values[1] ?? "", "角色|职责|职位");
        continue;
      }
      const text = plainText(token.text);
      if (/^(?:项目简介|项目概述|项目描述)[：:]/.test(text)) {
        current.summary = labeledValue(text, "项目简介|项目概述|项目描述");
      } else if (/^技术栈[：:]/.test(text)) {
        current.stack = labeledValue(text, "技术栈").split(/\s+\+\s+|[,，]\s*/).map((item) => item.trim()).filter(Boolean);
      }
    } else if (isList(token)) {
      current.highlights.push(...token.items.map((item) => plainText(item.text)).filter(Boolean));
    }
  }
  return projects;
};

const parseSummary = (section: MarkdownSection | undefined): string => {
  if (!section) return "";
  return section.tokens
    .flatMap((token) => isParagraph(token) ? [plainText(token.text)] : isList(token) ? token.items.map((item) => plainText(item.text)) : [])
    .filter(Boolean)
    .join(" ");
};

export function parseResumeMarkdown(source: string): ResumeData {
  if (!source.trim()) throw new Error("Markdown 文件为空");
  const sections = collectSections(Lexer.lex(source, { gfm: true }));
  const sectionOrder = normalizeSectionOrder(
    sections.map((section) => sectionOrderId(section.name)).filter((section): section is ResumeSectionId => section !== undefined),
  );
  const groupedSections = new Map<SectionKind, MarkdownSection>();
  for (const section of sections) {
    const key = sectionKey(section.name);
    if (!key) continue;
    const existing = groupedSections.get(key);
    groupedSections.set(key, existing ? { name: existing.name, tokens: [...existing.tokens, ...section.tokens] } : section);
  }
  const headerEnd = source.search(/^##\s+/m);
  const headerSource = headerEnd >= 0 ? source.slice(0, headerEnd) : source;
  const resume: ResumeData = {
    schemaVersion: SCHEMA_VERSION,
    appearance: createDefaultAppearance(),
    contact: parseHeader(headerSource),
    summary: parseSummary(groupedSections.get("summary")),
    sectionOrder,
    education: parseEducation(groupedSections.get("education")),
    experiences: parseWork(groupedSections.get("work")),
    skills: parseSkills(groupedSections.get("skills")),
    projects: parseProjects(groupedSections.get("projects")),
  };
  const malformedSections = [
    groupedSections.has("education") && !resume.education.length ? "教育背景" : "",
    groupedSections.has("work") && !resume.experiences.length ? "工作经历" : "",
    groupedSections.has("skills") && !resume.skills.length ? "专业技能" : "",
    groupedSections.has("projects") && !resume.projects.length ? "项目经历" : "",
  ].filter(Boolean);
  if (malformedSections.length) throw new Error(`以下章节格式无法识别：${malformedSections.join("、")}`);
  const recognizedBlocks = resume.education.length + resume.experiences.length + resume.skills.length + resume.projects.length;
  if (!recognizedBlocks) throw new Error("未识别到教育、工作、技能或项目章节，请检查 Markdown 标题结构");
  if (!resume.contact.name) throw new Error("未识别到姓名，请使用一级标题或 <h1>姓名</h1>");
  return resume;
}
