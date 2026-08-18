import type { CandidateDraft } from "../shared/contracts/candidate";

export type CandidateSection = Exclude<keyof CandidateDraft, "extractionConfidence">;

export const sectionAliases: Readonly<Record<CandidateSection, readonly string[]>> = {
  basics: ["基本信息", "基本资料", "个人信息", "个人资料"],
  workExperience: ["工作经历", "工作经验", "职业经历", "任职经历"],
  projects: ["项目经历", "项目经验", "项目介绍"],
  education: ["教育经历", "教育背景", "教育经验"],
  skills: ["专业技能", "技能特长", "擅长技能", "专业特长"],
  other: ["其他信息", "附加信息", "补充信息", "自我评价"]
};

const aliasesByHeading = new Map<string, CandidateSection>();

for (const [section, aliases] of Object.entries(sectionAliases)) {
  for (const alias of aliases) {
    aliasesByHeading.set(alias, section as CandidateSection);
  }
}

export function sectionForHeading(text: string): CandidateSection | undefined {
  return aliasesByHeading.get(text.replace(/[::：]\s*$/u, "").trim());
}
