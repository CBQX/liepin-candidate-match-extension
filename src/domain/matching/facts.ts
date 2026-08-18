import type { CandidateDraft } from "../../shared/contracts/candidate";

export const EDUCATION_LEVELS = [
  "secondary",
  "associate",
  "bachelor",
  "master",
  "doctorate"
] as const;

export type EducationLevel = typeof EDUCATION_LEVELS[number];

export interface ObjectiveSourceEvidence {
  yearsExperience: string[];
  certificates: Map<string, string[]>;
  locations: string[];
}

export interface ObjectiveFacts {
  tokens: Set<string>;
  tokenEvidence?: Map<string, string[]>;
  educationLevel?: EducationLevel;
  yearsExperience?: number;
  yearsExperienceEvidence?: string;
  locations?: Set<string>;
  sourceEvidence?: ObjectiveSourceEvidence;
}

export const EDUCATION_LABELS: Record<EducationLevel, string> = {
  secondary: "中专",
  associate: "大专",
  bachelor: "本科",
  master: "硕士",
  doctorate: "博士"
};

const EDUCATION_PATTERNS: ReadonlyArray<readonly [EducationLevel, RegExp]> = [
  ["secondary", /中专/u],
  ["associate", /大专|专科/u],
  ["bachelor", /本科|学士/u],
  ["master", /硕士|研究生/u],
  ["doctorate", /博士/u]
];

export const OBJECTIVE_TOKEN_ALIASES: ReadonlyArray<readonly [string, string, RegExp]> = [
  ["cet-4", "CET-4", /(?:CET\s*[-－]?\s*4|英语四级)/iu],
  ["cet-6", "CET-6", /(?:CET\s*[-－]?\s*6|英语六级)/iu],
  ["tem-4", "TEM-4", /(?:TEM\s*[-－]?\s*4|英语专四|专业四级)/iu],
  ["tem-8", "TEM-8", /(?:TEM\s*[-－]?\s*8|英语专八|专业八级)/iu],
  ["ielts", "雅思", /IELTS|雅思/iu],
  ["toefl", "托福", /TOEFL|托福/iu],
  ["pmp", "PMP", /\bPMP\b/iu],
  ["cpa", "CPA", /\bCPA\b|注册会计师/iu],
  ["cfa", "CFA", /\bCFA\b/iu],
  ["frm", "FRM", /\bFRM\b/iu],
  ["legal-professional-qualification", "法律职业资格", /法律职业资格|法考/u],
  ["teacher-qualification", "教师资格证", /教师资格证/u],
  ["first-class-constructor", "一级建造师", /一级建造师/u]
];

const findEducationLevel = (text: string): EducationLevel | undefined => {
  let highestIndex = -1;

  EDUCATION_PATTERNS.forEach(([level, pattern]) => {
    if (pattern.test(text)) {
      highestIndex = Math.max(highestIndex, EDUCATION_LEVELS.indexOf(level));
    }
  });

  return highestIndex < 0 ? undefined : EDUCATION_LEVELS[highestIndex];
};

const sectionLabels = {
  basics: "基本信息",
  workExperience: "工作经历",
  projects: "项目经历",
  education: "教育经历",
  skills: "技能",
  other: "其他内容"
} as const;

type CandidateTextSection = keyof typeof sectionLabels;

const nonCandidateOwnershipContext = /客户|学员|团队|成员|员工|同事|下属|供应商|合作方|公司|企业|部门|岗位要求|培训|课程|项目(?:周期)?/u;
const explicitCandidateReference = /本人|候选人/u;

const candidateClauses = (text: string): string[] =>
  text.split(/[。；;\n]/u).map((clause) => clause.trim()).filter(Boolean);

const uniqueEvidence = (evidence: readonly string[]): string[] => [...new Set(evidence)];

type ExperienceClauseClassification = "clear" | "qualified";

const classifyExperienceClause = (clause: string): ExperienceClauseClassification => {
  const compact = clause.replace(/\s+/gu, "");
  const hasYears = /\d+(?:\.\d+)?年/u.test(compact);
  if (!hasYears) return "qualified";

  if (/\d+(?:\.\d+)?(?:年)?(?:[-－–—~～至到])\d+(?:\.\d+)?年/u.test(compact)) {
    return "qualified";
  }
  if (/\d+(?:\.\d+)?年(?:以下|以内|内|左右|上下|封顶)/u.test(compact)) {
    return "qualified";
  }

  const withoutClearLowerBounds = compact.replace(/不少于|不低于/gu, "");
  return /不到|不足|不满|少于|低于|最多|至多|不超过|不多于|未满|仅有|只有|约|大约|近|上限/u
    .test(withoutClearLowerBounds)
    ? "qualified"
    : "clear";
};

const findYearsExperience = (
  draft: CandidateDraft
): { value: number; evidence: string } | undefined => {
  const values: Array<{ value: number; evidence: string }> = [];
  const patterns = [
    /((?:(?:本人|候选人)\s*)?(?:明确|累计|拥有|具备|已有)?\s*(\d+(?:\.\d+)?)\s*年(?:以上|及以上)?(?:相关|工作|行业|产品|开发|销售|管理|从业)?经验)/gu,
    /((?:工作|从业)经验\s*[:：]\s*(\d+(?:\.\d+)?)\s*年)/gu,
    /((?:明确|累计|拥有|具备|已有)\s*(\d+(?:\.\d+)?)\s*年(?:以上|及以上)?工作经验)/gu
  ];

  (["basics", "workExperience"] as const).forEach((section) => {
    for (const clause of candidateClauses(draft[section].text)) {
      if (classifyExperienceClause(clause) !== "clear") continue;
      const hasNonCandidateContext = nonCandidateOwnershipContext.test(clause);
      const candidateIsExplicit = explicitCandidateReference.test(clause)
        || /^(?:工作|从业)经验\s*[:：]/u.test(clause);
      if (hasNonCandidateContext && !candidateIsExplicit) continue;

      patterns.forEach((pattern) => {
        for (const match of clause.matchAll(pattern)) {
          const value = Number(match[2]);
          const source = match[1]?.trim();
          if (Number.isFinite(value) && source) {
            values.push({ value, evidence: `${sectionLabels[section]}：${clause}` });
          }
        }
      });
    }
  });

  return values.sort((left, right) => right.value - left.value)[0];
};

const findYearsExperienceSourceEvidence = (draft: CandidateDraft): string[] => {
  const evidence: string[] = [];

  for (const section of ["basics", "workExperience"] as const) {
    for (const clause of candidateClauses(draft[section].text)) {
      const compact = clause.replace(/\s+/gu, "");
      if (!/\d+(?:\.\d+)?年/u.test(compact) || !/经验/u.test(compact)) continue;

      const hasNonCandidateContext = nonCandidateOwnershipContext.test(clause);
      const candidateIsExplicit = explicitCandidateReference.test(clause)
        || /^(?:工作|从业)经验\s*[:：]/u.test(clause)
        || /^(?:明确|累计|拥有|具备|已有|不到|不足|不满|最多|至多|不超过|少于|低于|未满|\d)/u
          .test(clause);
      if (hasNonCandidateContext && !candidateIsExplicit) continue;

      evidence.push(`${sectionLabels[section]}：${clause}`);
    }
  }

  return uniqueEvidence(evidence);
};

type CredentialClauseClassification = "positive" | "qualified" | "unsupported";

const isObjectiveCredentialItem = (item: string): boolean =>
  OBJECTIVE_TOKEN_ALIASES.some(([, , tokenPattern]) => new RegExp(
    String.raw`^(?:${tokenPattern.source})(?:\s*(?:证书|认证|资格|资质))?$`,
    tokenPattern.flags.replace(/[gy]/gu, "")
  ).test(item.trim()));

const isGenuinelyListLikeCredentialClause = (clause: string): boolean => {
  const content = clause
    .replace(/^\s*(?:[-•·]\s*)?(?:(?:证书|认证|资质|资格|技能)\s*[:：]\s*)?/u, "")
    .trim();
  const items = content.split(/[、,，/|｜]+/u).map((item) => item.trim()).filter(Boolean);
  return items.length > 0 && items.every(isObjectiveCredentialItem);
};

const classifyCredentialClause = (
  clause: string,
  section: CandidateTextSection
): CredentialClauseClassification => {
  const deniesPossession = /不具备|(?:尚)?未(?:持有|拥有|具备|取得|获得|通过|考取)|没有|无法|(?:^|[\s，,：:])无(?=\s|[A-Za-z])/u
    .test(clause);
  const plansPossession = /计划|准备|打算|拟(?:考|考取|报考|取得|获得|通过|持有)|待(?:考|考取|报考|取得|获得|通过|认证|续期)|备考|报考/u
    .test(clause);
  const invalidatesPossession = /过期|失效|作废|注销|吊销|未续期/u.test(clause);
  if (deniesPossession || plansPossession || invalidatesPossession) return "qualified";

  const explicitPossession = /持有|具备|拥有|通过|获得|取得|考取/u.test(clause);
  const labeledPossession = /^\s*(?:[-•·]\s*)?(?:证书|认证|资质|资格)\s*[:：]/u.test(clause);
  const hasNonCandidateContext = nonCandidateOwnershipContext.test(clause);
  const candidateIsExplicit = explicitCandidateReference.test(clause);
  if (
    (explicitPossession || labeledPossession)
    && (!hasNonCandidateContext || candidateIsExplicit)
  ) {
    return "positive";
  }
  if (
    section === "skills"
    && !hasNonCandidateContext
    && isGenuinelyListLikeCredentialClause(clause)
  ) {
    return "positive";
  }
  return "unsupported";
};

const candidateOwnedTokenEvidence = (
  draft: CandidateDraft,
  pattern: RegExp
): string[] => {
  const evidence: string[] = [];
  const sections = Object.keys(sectionLabels) as CandidateTextSection[];

  for (const section of sections) {
    for (const clause of candidateClauses(draft[section].text)) {
      const match = pattern.exec(clause);
      if (!match) continue;
      if (classifyCredentialClause(clause, section) === "positive") {
        evidence.push(`${sectionLabels[section]}：${clause}`);
      }
    }
  }

  return [...new Set(evidence)];
};

const candidateMentionedTokenEvidence = (
  draft: CandidateDraft,
  pattern: RegExp
): string[] => {
  const evidence: string[] = [];
  const sections = Object.keys(sectionLabels) as CandidateTextSection[];
  const tokenPattern = new RegExp(pattern.source, pattern.flags.replace(/[gy]/gu, ""));

  for (const section of sections) {
    for (const clause of candidateClauses(draft[section].text)) {
      if (!tokenPattern.test(clause)) continue;
      const hasNonCandidateContext = nonCandidateOwnershipContext.test(clause);
      if (hasNonCandidateContext && !explicitCandidateReference.test(clause)) continue;
      evidence.push(`${sectionLabels[section]}：${clause}`);
    }
  }

  return uniqueEvidence(evidence);
};

const findLocationFacts = (draft: CandidateDraft): {
  locations: Set<string>;
  evidence: string[];
} => {
  const locations = new Set<string>();
  const evidence: string[] = [];
  const sections = Object.keys(sectionLabels) as CandidateTextSection[];

  for (const section of sections) {
    const pattern = /(?:现居地|所在地|当前城市|所在城市|工作地点|常驻地|Location)\s*[:：]\s*([^\s,，;；。|/]{2,20})/giu;
    for (const match of draft[section].text.matchAll(pattern)) {
      const location = match[1]?.trim();
      const source = match[0]?.trim();
      if (!location || !source) continue;
      locations.add(location);
      evidence.push(`${sectionLabels[section]}：${source}`);
    }
  }

  return { locations, evidence: uniqueEvidence(evidence) };
};

export function extractObjectiveFacts(draft: CandidateDraft): ObjectiveFacts & {
  locations: Set<string>;
  sourceEvidence: ObjectiveSourceEvidence;
} {
  const tokens = new Set<string>();
  const tokenEvidence = new Map<string, string[]>();
  const certificateSourceEvidence = new Map<string, string[]>();
  OBJECTIVE_TOKEN_ALIASES.forEach(([token, , pattern]) => {
    const evidence = candidateOwnedTokenEvidence(draft, pattern);
    if (evidence.length > 0) {
      tokens.add(token);
      tokenEvidence.set(token, evidence);
    }
    const sourceEvidence = candidateMentionedTokenEvidence(draft, pattern);
    if (sourceEvidence.length > 0) {
      certificateSourceEvidence.set(token, sourceEvidence);
    }
  });
  const years = findYearsExperience(draft);
  const locationFacts = findLocationFacts(draft);

  return {
    tokens,
    tokenEvidence,
    educationLevel: findEducationLevel(draft.education.text),
    yearsExperience: years?.value,
    yearsExperienceEvidence: years?.evidence,
    locations: locationFacts.locations,
    sourceEvidence: {
      yearsExperience: findYearsExperienceSourceEvidence(draft),
      certificates: certificateSourceEvidence,
      locations: locationFacts.evidence
    }
  };
}
