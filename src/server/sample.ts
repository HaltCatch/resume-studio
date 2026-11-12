import { createDefaultAppearance, DEFAULT_SECTION_ORDER, SCHEMA_VERSION, type ResumeData } from "../domain/resume.ts";

/**
 * 首次启动时写入的数据示例：内容通用、可直接删改，
 * 仅用于演示各章节的推荐写法，不包含真实个人信息。
 */
export const createSampleResume = (): ResumeData => ({
  schemaVersion: SCHEMA_VERSION,
  appearance: createDefaultAppearance(),
  contact: {
    name: "张三",
    headline: "后端开发工程师",
    phone: "13800000000",
    email: "hello@example.com",
    website: "https://example.com",
    location: "上海",
    extra: "",
  },
  summary: "示例简历：展示各章节的推荐写法。要点建议使用“动作 + 难点 + 结果”结构，并尽量补充可量化的数据。",
  sectionOrder: [...DEFAULT_SECTION_ORDER],
  skills: [
    { id: "sample-skill-1", name: "编程语言", items: ["熟练掌握 Java 基础与并发编程，熟悉常用设计模式与问题定位方法。"] },
    { id: "sample-skill-2", name: "工程能力", items: ["熟悉 Docker、Kubernetes、CI/CD 流程，能够独立搭建持续交付链路。"] },
  ],
  experiences: [
    {
      id: "sample-experience-1",
      organization: "某软件公司",
      role: "后端开发工程师",
      period: "2022.07 - 至今",
      summary: "",
      highlights: [
        "负责核心业务模块的需求分析、接口设计与开发交付。",
        "推动服务构建与部署流程标准化，将发布耗时从 2 小时缩短到 15 分钟。",
      ],
    },
  ],
  projects: [
    {
      id: "sample-project-1",
      name: "示例项目：订单中心重构",
      role: "核心开发",
      period: "2023.03 - 2023.12",
      summary: "将单体订单模块拆分为独立服务，支撑大促期间的峰值流量。",
      stack: ["Java", "Spring Boot", "MySQL", "Redis"],
      highlights: [
        "设计分库分表方案，单表数据量下降 80%，查询 P99 从 1.2s 降至 180ms。",
        "引入消息队列异步化非关键链路，大促期间零故障。",
      ],
    },
  ],
  education: [
    { id: "sample-education-1", school: "某理工大学", degree: "本科", major: "软件工程", period: "2018.09 - 2022.06" },
  ],
});
