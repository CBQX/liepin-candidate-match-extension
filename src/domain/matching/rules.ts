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

const ADMINISTRATIVE_SUFFIX = /(?:特别行政区|自治区|自治州|自治县|自治旗|地区|林区|新区|开发区|盟|省|市|区|县|旗)$/u;
const LOCATION_JOINERS = ["以及", "同时", "及", "与", "或", "并", "和", "且"] as const;
const HAN_LOCATION_ATOM = /^[\p{Script=Han}]{2,20}$/u;
const LATIN_LOCATION_ATOM = /^(?=.{2,20}$)\p{Script=Latin}+(?:[-'’]\p{Script=Latin}+)*$/u;

const resemblesStandaloneHanLocation = (text: string): boolean => {
  const name = text.replace(ADMINISTRATIVE_SUFFIX, "");
  const hasAdministrativeSuffix = name !== text;

  // This deliberately narrow grammar is only for deciding whether both sides
  // of a connector are peer locations; the complete location atom may be longer.
  return /^[\p{Script=Han}]{2,4}$/u.test(name)
    || (hasAdministrativeSuffix && /^[\p{Script=Han}]{2,}$/u.test(name));
};

const hasJoinedLocationNames = (location: string): boolean => LOCATION_JOINERS.some((joiner) => {
  let joinerIndex = location.indexOf(joiner);
  while (joinerIndex >= 0) {
    const before = location.slice(0, joinerIndex);
    const after = location.slice(joinerIndex + joiner.length);
    if (resemblesStandaloneHanLocation(before) && resemblesStandaloneHanLocation(after)) {
      return true;
    }
    joinerIndex = location.indexOf(joiner, joinerIndex + joiner.length);
  }
  return false;
});

const parseSupportedLocation = (text: string): string | undefined => {
  const match = text.trim().match(new RegExp(
    String.raw`^${REQUIREMENT_PREFIX}(?:工作地点|办公地点|常驻地|所在地|Location)\s*[:：]?\s*(.+)$`,
    "iu"
  ));
  const location = match?.[1];
  if (!location) return undefined;

  const hasMobilityOrAvailabilityClause = /接受|愿意|需要|要求|出差|差旅|搬迁|迁居|调动|远程|居家|到岗|入职|驻场|异地|办公方式|办公模式/u
    .test(location);

  if (HAN_LOCATION_ATOM.test(location)) {
    return hasJoinedLocationNames(location) || hasMobilityOrAvailabilityClause
      ? undefined
      : location;
  }

  return LATIN_LOCATION_ATOM.test(location) ? location : undefined;
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
    // Stage C safety breaker: natural-language tenure cannot be proven safely enough
    // for a deterministic hard gate. Keep extracted facts for provider/recruiter evidence.
    return evaluation(criterion.id, "unknown");
  }

  const location = parseSupportedLocation(criterion.text);
  if (location) {
    return evaluation(criterion.id, "unknown");
  }

  const token = requiredToken(criterion.text);
  if (token && isSupportedTokenCriterion(criterion.text, token[2])) {
    // Stage C safety breaker: a credential mention is not a maintained, verified
    // credential record, so it can inform analysis but never a deterministic hard gate.
    return evaluation(criterion.id, "unknown");
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
