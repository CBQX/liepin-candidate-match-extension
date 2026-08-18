import type {
  CandidateDraft,
  CandidateRedactionContext
} from "./contracts/candidate";

const sectionKeys = [
  "basics",
  "workExperience",
  "projects",
  "education",
  "skills",
  "other"
] as const;

const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const mainlandMobilePattern = /(?<!\d)(?:\+?86[\s-]*)?1[3-9]\d(?:[\s-]*\d){8}(?!\d)/gu;
const labeledContactPattern = /((?:微信(?:号)?|wechat|QQ(?:号)?|联系方式|联系电话|手机(?:号码)?|邮箱)\s*[:：]?\s*)(?!\[已移除\])(?:[A-Z0-9._+@-]{2,})/giu;
const liepinUrlPattern = /https?:\/\/(?:[A-Z0-9-]+\.)*liepin\.com(?::\d+)?(?:[/?#][^\s<>{}\[\]"'，。；;]*)?/giu;
const liepinPathPattern = /(^|[\s，。；;（(])\/(?:candidate|resume|profile|cv)(?:[/?#][^\s<>{}\[\]"'，。；;]*)?/giu;
const labeledPlatformIdPattern = /((?:(?:简历|候选人|人选|档案|猎聘|profile|resume|candidate)\s*(?:ID|编号|标识))\s*[:：#]?\s*)(?!\[已移除\])[A-Z0-9_-]{2,}/giu;

const confirmedIdentityPatterns = [
  /(?:^|[，,。；;\s])(?:(?:候选人|应聘者)\s*)?(?:姓名|名字)\s*[:：]?\s*([\p{Script=Han}·]{2,8})(?=[，,。；;\s]|$)/u,
  /(?:^|[，,。；;\s])本人(?:名叫|叫)\s*([\p{Script=Han}·]{2,4})(?=[，,。；;\s]|$)/u
] as const;

const probableIdentityPatterns = [
  /^\s*([\p{Script=Han}·]{2,4})(?=\s*[，,|｜]?\s*\d{1,2}\s*岁(?:[，,。；;\s]|$))/u,
  /^\s*([\p{Script=Han}·]{2,4})(?=\s*[，,|｜]\s*(?:手机|联系电话|电话|邮箱|微信|QQ|年龄|现居|所在地|城市))/u
] as const;

const ambiguousNonPersonTokens = new Set([
  "上海", "北京", "天津", "重庆", "深圳", "广州", "杭州", "南京", "苏州",
  "沈阳", "徐州", "江门", "金华", "马鞍山", "黄山", "王公司", "产品经理"
]);

function firstIdentityMatch(basics: string, patterns: readonly RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const token = pattern.exec(basics)?.[1]?.trim();
    if (token && !ambiguousNonPersonTokens.has(token) && !/(?:公司|大学|学院)$/u.test(token)) {
      return token;
    }
  }
  return undefined;
}

export function detectCandidateRedactionContext(basics: string): CandidateRedactionContext {
  const confirmed = firstIdentityMatch(basics, confirmedIdentityPatterns);
  if (confirmed) return { identityTokens: [confirmed], identityDetection: "confirmed" };

  const probable = firstIdentityMatch(basics, probableIdentityPatterns);
  return probable
    ? { identityTokens: [probable], identityDetection: "probable" }
    : { identityTokens: [], identityDetection: "undetected" };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactIdentityTokens(text: string, tokens: readonly string[]): string {
  return tokens.reduce((redacted, token) => redacted.replace(
    new RegExp(escapeRegExp(token), "gu"),
    "候选人"
  ), text);
}

function redactContacts(text: string): string {
  return text
    .replace(emailPattern, "[已移除]")
    .replace(mainlandMobilePattern, "[已移除]")
    .replace(labeledContactPattern, "$1[已移除]")
    .replace(liepinUrlPattern, "[已移除]")
    .replace(liepinPathPattern, "$1[已移除]")
    .replace(labeledPlatformIdPattern, "$1[已移除]");
}

export function redactCandidateDraft(
  draft: CandidateDraft,
  context: CandidateRedactionContext = detectCandidateRedactionContext(draft.basics.text)
): CandidateDraft {
  const redacted: CandidateDraft = structuredClone(draft);

  for (const key of sectionKeys) {
    redacted[key].text = redactContacts(redactIdentityTokens(
      redacted[key].text,
      context.identityTokens
    ));
  }

  return redacted;
}

export function prepareCandidateDraftForPreview(draft: CandidateDraft): {
  draft: CandidateDraft;
  redactionContext: CandidateRedactionContext;
} {
  const redactionContext = detectCandidateRedactionContext(draft.basics.text);
  return {
    draft: redactCandidateDraft(draft, redactionContext),
    redactionContext
  };
}
