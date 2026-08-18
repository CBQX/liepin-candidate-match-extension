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
  educationLevel?: EducationLevel;
  yearsExperience?: number;
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

const findYearsExperience = (text: string): number | undefined => {
  const values: number[] = [];
  const patterns = [
    /(\d+(?:\.\d+)?)\s*年(?:以上|及以上)?(?:相关|工作|行业|产品|开发|销售|管理|从业)?经验/gu,
    /(?:工作|从业)经验\s*[:：]?\s*(\d+(?:\.\d+)?)\s*年/gu
  ];

  patterns.forEach((pattern) => {
    for (const match of text.matchAll(pattern)) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) values.push(value);
    }
  });

  return values.length === 0 ? undefined : Math.max(...values);
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
  const text = [
    draft.basics.text,
    draft.workExperience.text,
    draft.projects.text,
    draft.education.text,
    draft.skills.text,
    draft.other.text
  ].join("\n");

  const tokens = new Set<string>();
  OBJECTIVE_TOKEN_ALIASES.forEach(([token, , pattern]) => {
    if (pattern.test(text)) tokens.add(token);
  });

  return {
    tokens,
    educationLevel: findEducationLevel(draft.education.text),
    yearsExperience: findYearsExperience(text),
    locations: findLocations(text)
  };
}
