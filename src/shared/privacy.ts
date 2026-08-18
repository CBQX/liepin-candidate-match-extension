import type { CandidateDraft } from "./contracts/candidate";

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

interface ConfirmedIdentity {
  start: number;
  end: number;
  token: string;
}

const identitySourcePatterns = [
  /(?:^|[，,。；;\s])(?:(?:候选人|应聘者)\s*)?(?:姓名|名字)\s*[:：]?\s*([\p{Script=Han}·]{2,8})/u,
  /(?:^|[，,。；;\s])本人(?:名叫|叫)\s*([\p{Script=Han}·]{2,4})(?=[，,。；;\s])/u,
  /^\s*([\p{Script=Han}·]{2,4})(?=\s*[，,|｜]\s*(?:手机|联系电话|电话|邮箱|微信|QQ|年龄|\d{1,2}\s*岁|现居|所在地|城市))/u
] as const;

function confirmedIdentity(basics: string): ConfirmedIdentity | undefined {
  for (const pattern of identitySourcePatterns) {
    const match = pattern.exec(basics);
    const identity = match?.[1];
    if (!match || !identity) continue;

    const offsetWithinMatch = match[0].lastIndexOf(identity);
    const start = match.index + offsetWithinMatch;
    return { start, end: start + identity.length, token: identity };
  }

  return undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactClearPersonReferences(text: string, confirmedToken: string): string {
  const token = escapeRegExp(confirmedToken);
  const personReferencePattern = new RegExp(
    `(^|[\uff0c,\u3002\uff1b;\uff1a:\uff01!\uff1f?\\n\\r])([\\t ]*)${token}(?=\\s*(?:\u4e8e|\u66fe\u4efb|\u52a0\u5165|\u62c5\u4efb|\u4efb\u804c|\u73b0\u4efb))`,
    "gu"
  );

  return text.replace(personReferencePattern, "$1$2候选人");
}

function redactContacts(text: string): string {
  return text
    .replace(emailPattern, "[已移除]")
    .replace(mainlandMobilePattern, "[已移除]")
    .replace(labeledContactPattern, "$1[已移除]");
}

export function redactCandidateDraft(draft: CandidateDraft): CandidateDraft {
  const identity = confirmedIdentity(draft.basics.text);
  const redacted: CandidateDraft = structuredClone(draft);

  for (const key of sectionKeys) {
    const text = key === "basics"
      ? identity
        ? `${redacted[key].text.slice(0, identity.start)}候选人${redacted[key].text.slice(identity.end)}`
        : redacted[key].text
      : identity
        ? redactClearPersonReferences(redacted[key].text, identity.token)
        : redacted[key].text;
    redacted[key].text = redactContacts(text);
  }

  return redacted;
}
