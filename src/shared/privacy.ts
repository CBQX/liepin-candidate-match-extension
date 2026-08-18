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
const mainlandMobilePattern = /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/gu;
const labeledContactPattern = /((?:微信(?:号)?|wechat|QQ(?:号)?|联系方式|联系电话|手机(?:号码)?|邮箱)\s*[:：]?\s*)(?!\[已移除\])(?:[A-Z0-9._+@-]{2,})/giu;

function extractName(basics: string): string | undefined {
  const labeled = basics.match(/(?:^|[，,。；;\s])(?:姓名|名字)\s*[:：]?\s*([\p{Script=Han}·]{2,8})/u);
  if (labeled?.[1]) return labeled[1];

  return basics.match(/^\s*([\p{Script=Han}·]{2,4})(?=[，,、。；;\s])/u)?.[1];
}

function redactText(text: string, name: string | undefined): string {
  const withoutName = name ? text.split(name).join("候选人") : text;
  return withoutName
    .replace(emailPattern, "[已移除]")
    .replace(mainlandMobilePattern, "[已移除]")
    .replace(labeledContactPattern, "$1[已移除]");
}

export function redactCandidateDraft(draft: CandidateDraft): CandidateDraft {
  const name = extractName(draft.basics.text);
  const redacted: CandidateDraft = structuredClone(draft);

  for (const key of sectionKeys) {
    redacted[key].text = redactText(redacted[key].text, name);
  }

  return redacted;
}
