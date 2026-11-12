import type { ResumeData } from "./resume";

export type ReviewLevel = "attention" | "suggestion";

export interface ReviewItem {
  level: ReviewLevel;
  message: string;
}

export interface ResumeReview {
  score: number;
  label: string;
  items: ReviewItem[];
}

const placeholderPattern = /(?:x{3,}|待填写|待补充|example\.com)/i;
const measurablePattern = /(?:\d+(?:\.\d+)?\s*(?:%|倍|个|项|套|条|人|天|小时|分钟|ms|qps|tps|台|种)|(?:qps|tps)\s*\d+)/i;

const resumeTextValues = (data: ResumeData): string[] => [
  ...Object.values(data.contact),
  data.summary,
  ...data.skills.flatMap((group) => [group.name, ...group.items]),
  ...data.experiences.flatMap((item) => [item.organization, item.role, item.period, item.summary, ...item.highlights]),
  ...data.projects.flatMap((item) => [item.name, item.role, item.period, item.summary, ...item.stack, ...item.highlights]),
  ...data.education.flatMap((item) => [item.school, item.degree, item.major, item.period]),
];

export function reviewResume(data: ResumeData): ResumeReview {
  const items: ReviewItem[] = [];
  let score = 100;
  const placeholderCount = resumeTextValues(data).reduce((count, value) => {
    const matches = value.match(new RegExp(placeholderPattern.source, "gi"));
    return count + (matches?.length ?? 0);
  }, 0);

  if (placeholderCount) {
    score -= Math.min(24, 4 + placeholderCount * 4);
    items.push({ level: "attention", message: `仍有 ${placeholderCount} 处 XXX / 待填写等占位内容，投递前需要替换。` });
  }
  if (!data.contact.phone.trim() || !data.contact.email.trim()) {
    score -= 18;
    items.push({ level: "attention", message: "至少保留可用的手机号和邮箱，方便招聘方联系。" });
  }
  if (!data.experiences.length) {
    score -= 24;
    items.push({ level: "attention", message: "社招简历应以工作经历为核心，不建议留空。" });
  }
  if (!data.skills.length) {
    score -= 12;
    items.push({ level: "attention", message: "补充与目标岗位匹配的技能关键词。" });
  }
  if (!data.education.length) {
    score -= 8;
    items.push({ level: "suggestion", message: "建议保留精简的教育背景，便于完整展示履历。" });
  }

  const highlights = [...data.experiences, ...data.projects].flatMap((item) => item.highlights).filter(Boolean);
  if (highlights.length && highlights.filter((item) => measurablePattern.test(item)).length < Math.ceil(highlights.length / 4)) {
    score -= 10;
    items.push({ level: "suggestion", message: "量化成果偏少；可补充效率、规模、稳定性或交付周期数据。" });
  }
  if (highlights.some((item) => item.length > 90)) {
    score -= 6;
    items.push({ level: "suggestion", message: "部分要点超过 90 字，建议拆成“行动 + 结果”的短句。" });
  }
  if (data.summary.length > 180) {
    score -= 5;
    items.push({ level: "suggestion", message: "个人概述略长，建议控制在 2–4 行并贴合目标岗位。" });
  }
  if (!data.contact.website.trim()) {
    score -= 3;
    items.push({ level: "suggestion", message: "技术岗位可加入 GitHub、博客或作品链接。" });
  }

  const finalScore = Math.max(0, score);
  return {
    score: finalScore,
    label: finalScore >= 85 ? "可投递" : finalScore >= 65 ? "待完善" : "需补充",
    items: items.length ? items : [{ level: "suggestion", message: "核心信息完整，可继续按目标岗位微调关键词。" }],
  };
}
