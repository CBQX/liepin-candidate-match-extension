import type { CandidateDraft } from "../../shared/contracts/candidate";

export const EDUCATION_LEVELS = [
  "secondary",
  "associate",
  "bachelor",
  "master",
  "doctorate"
] as const;

export type EducationLevel = typeof EDUCATION_LEVELS[number];

export interface ObjectiveFacts {
  tokens: Set<string>;
  tokenEvidence?: Map<string, string[]>;
  educationLevel?: EducationLevel;
  yearsExperience?: number;
  yearsExperienceEvidence?: string;
  locations?: Set<string>;
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
    const fragments = draft[section].text.split(/[。；;\n]/u).map((fragment) => fragment.trim());
    for (const fragment of fragments) {
      const hasNonCandidateContext = nonCandidateOwnershipContext.test(fragment);
      const candidateIsExplicit = explicitCandidateReference.test(fragment)
        || /^(?:工作|从业)经验\s*[:：]/u.test(fragment);
      if (hasNonCandidateContext && !candidateIsExplicit) continue;

      patterns.forEach((pattern) => {
        for (const match of fragment.matchAll(pattern)) {
          const value = Number(match[2]);
          const source = match[1]?.trim();
          if (Number.isFinite(value) && source) {
            values.push({ value, evidence: `${sectionLabels[section]}：${source}` });
          }
        }
      });
    }
  });

  return values.sort((left, right) => right.value - left.value)[0];
};

const candidateOwnedTokenEvidence = (
  draft: CandidateDraft,
  pattern: RegExp
): string[] => {
  const evidence: string[] = [];
  const sections = Object.keys(sectionLabels) as CandidateTextSection[];

  for (const section of sections) {
    const fragments = draft[section].text.split(/[。；;\n]/u).map((fragment) => fragment.trim());
    for (const fragment of fragments) {
      const match = pattern.exec(fragment);
      if (!match) continue;

      const explicitPossession = /持有|具备|拥有|通过|获得|考取/u.test(fragment);
      const labeledPossession = /^\s*(?:[-•·]\s*)?(?:证书|认证|资质|资格)\s*[:：]/u.test(fragment);
      const hasNonCandidateContext = nonCandidateOwnershipContext.test(fragment);
      const candidateIsExplicit = explicitCandidateReference.test(fragment);
      const skillListPossession = section === "skills" && !hasNonCandidateContext;
      if (
        (explicitPossession || labeledPossession || skillListPossession)
        && (!hasNonCandidateContext || candidateIsExplicit)
      ) {
        evidence.push(`${sectionLabels[section]}：${fragment}`);
      }
    }
  }

  return [...new Set(evidence)];
};

const findLocations = (text: string): Set<string> => {
  const locations = new Set<string>();
  const pattern = /(?:现居地|所在地|当前城市|所在城市|工作地点|常驻地|Location)\s*[:：]\s*([^\s,，;；。|/]{2,20})/giu;

  for (const match of text.matchAll(pattern)) {
    const location = match[1]?.trim();
    if (location) locations.add(location);
  }

  return locations;
};

export function extractObjectiveFacts(draft: CandidateDraft): ObjectiveFacts & { locations: Set<string> } {
  const tokens = new Set<string>();
  const tokenEvidence = new Map<string, string[]>();
  OBJECTIVE_TOKEN_ALIASES.forEach(([token, , pattern]) => {
    const evidence = candidateOwnedTokenEvidence(draft, pattern);
    if (evidence.length > 0) {
      tokens.add(token);
      tokenEvidence.set(token, evidence);
    }
  });
  const years = findYearsExperience(draft);

  const text = Object.keys(sectionLabels)
    .map((section) => draft[section as CandidateTextSection].text)
    .join("\n");

  return {
    tokens,
    tokenEvidence,
    educationLevel: findEducationLevel(draft.education.text),
    yearsExperience: years?.value,
    yearsExperienceEvidence: years?.evidence,
    locations: findLocations(text)
  };
}
