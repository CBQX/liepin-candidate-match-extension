import type { JobCriterion, RuleEvaluation } from "../../shared/contracts/matching";
import {
  EDUCATION_LABELS,
  EDUCATION_LEVELS,
  OBJECTIVE_TOKEN_ALIASES,
  type EducationLevel,
  type ObjectiveFacts
} from "./facts";

const evaluation = (
  criterionId: string,
  status: RuleEvaluation["status"],
  evidence: string[] = []
): RuleEvaluation => ({ criterionId, status, evidence });

const REQUIREMENT_PREFIX = String.raw`(?:(?:必须|硬性(?:要求)?|要求|需|需要)\s*)?`;

const isSupportedEducationCriterion = (text: string): boolean => new RegExp(
  String.raw`^${REQUIREMENT_PREFIX}(?:学历\s*[:：]?\s*)?(?:中专|大专|专科|本科|学士|硕士|研究生|博士)(?:及以上|以上)?(?:学历|学位)?$`,
  "u"
).test(text.trim());

const isSupportedYearsCriterion = (text: string): boolean => new RegExp(
  String.raw`^${REQUIREMENT_PREFIX}(?:有|具备|拥有)?\s*\d+(?:\.\d+)?\s*年(?:以上|及以上|\+)?(?:相关|工作|从业)?经验$`,
  "u"
).test(text.trim());

const isSupportedLocationCriterion = (text: string): boolean => {
  const normalized = text.trim();
  const hasUnsupportedClause = /(?:且|并且|同时|以及|和)\s*(?:接受|可|可以|能够|愿意|需|需要|有)/u
    .test(normalized);

  return !hasUnsupportedClause && new RegExp(
    String.raw`^${REQUIREMENT_PREFIX}(?:工作地点|办公地点|常驻地|所在地)\s*[:：]?\s*[^\s,，;；。|/]{2,20}$`,
    "u"
  ).test(normalized);
};

const isSupportedTokenCriterion = (text: string, tokenPattern: RegExp): boolean => new RegExp(
  String.raw`^${REQUIREMENT_PREFIX}(?:(?:持有|具备|拥有|通过)\s*)?(?:${tokenPattern.source})(?:\s*(?:证书|认证|资格))?$`,
  tokenPattern.flags
).test(text.trim());

const requiredEducation = (text: string): EducationLevel | undefined => {
  if (/博士/u.test(text)) return "doctorate";
  if (/硕士|研究生/u.test(text)) return "master";
  if (/本科|学士/u.test(text)) return "bachelor";
  if (/大专|专科/u.test(text)) return "associate";
  if (/中专/u.test(text)) return "secondary";
  return undefined;
};

const requiredYears = (text: string): number | undefined => {
  if (!/经验/u.test(text)) return undefined;
  const match = text.match(/(\d+(?:\.\d+)?)\s*年/u);
  return match ? Number(match[1]) : undefined;
};

const requiredLocation = (text: string): string | undefined => {
  const match = text.match(/(?:工作地点|办公地点|常驻地|所在地)\s*[:：]?\s*([^\s,，;；。|/]{2,20})/u);
  return match?.[1]?.trim();
};

const requiredToken = (text: string) =>
  OBJECTIVE_TOKEN_ALIASES.find(([, , pattern]) => pattern.test(text));

const evaluateCriterion = (criterion: JobCriterion, facts: ObjectiveFacts): RuleEvaluation => {
  const education = isSupportedEducationCriterion(criterion.text)
    ? requiredEducation(criterion.text)
    : undefined;
  if (education) {
    if (!facts.educationLevel) return evaluation(criterion.id, "unknown");

    const actualIndex = EDUCATION_LEVELS.indexOf(facts.educationLevel);
    const requiredIndex = EDUCATION_LEVELS.indexOf(education);
    return evaluation(
      criterion.id,
      actualIndex >= requiredIndex ? "met" : "not_met",
      [`明确学历：${EDUCATION_LABELS[facts.educationLevel]}`]
    );
  }

  const years = isSupportedYearsCriterion(criterion.text)
    ? requiredYears(criterion.text)
    : undefined;
  if (years !== undefined) {
    if (facts.yearsExperience === undefined) return evaluation(criterion.id, "unknown");
    return evaluation(
      criterion.id,
      facts.yearsExperience >= years ? "met" : "not_met",
      [`明确工作经验：${facts.yearsExperience} 年`]
    );
  }

  const location = isSupportedLocationCriterion(criterion.text)
    ? requiredLocation(criterion.text)
    : undefined;
  if (location) {
    const locations = facts.locations ?? new Set<string>();
    if (locations.size === 0) return evaluation(criterion.id, "unknown");
    if (locations.has(location)) {
      return evaluation(criterion.id, "met", [`明确地点：${location}`]);
    }
    return evaluation(criterion.id, "unknown");
  }

  const token = requiredToken(criterion.text);
  if (token && isSupportedTokenCriterion(criterion.text, token[2])) {
    const [normalized, label] = token;
    return facts.tokens.has(normalized)
      ? evaluation(criterion.id, "met", [`明确证书：${label}`])
      : evaluation(criterion.id, "unknown");
  }

  return evaluation(criterion.id, "unknown");
};

export function evaluateObjectiveRules(
  criteria: readonly JobCriterion[],
  facts: ObjectiveFacts
): RuleEvaluation[] {
  return criteria
    .filter(({ priority }) => priority === "hard")
    .map((criterion) => evaluateCriterion(criterion, facts));
}
