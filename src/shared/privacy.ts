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
const commonSurnameInitials = "王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严赖覃洪武莫孔";
const unlabeledNamePattern = /^\s*([\p{Script=Han}·]{2,3})\s*[，,|｜]\s*(?=(?:手机|联系电话|电话|邮箱|微信|QQ|年龄|\d{1,2}\s*岁|现居|所在地|城市))/u;
const commonLocationTerms = new Set([
  "北京", "上海", "天津", "重庆", "广州", "深圳", "杭州", "南京", "苏州",
  "成都", "武汉", "西安", "长沙", "郑州", "青岛", "厦门", "宁波", "合肥",
  "福州", "济南", "大连", "昆明", "无锡", "佛山"
]);
const evidenceTermSuffix = /(?:公司|集团|经理|总监|主管|负责人|工程师|顾问)$/u;

function extractName(basics: string): string | undefined {
  const labeled = basics.match(/(?:^|[，,。；;\s])(?:姓名|名字)\s*[:：]?\s*([\p{Script=Han}·]{2,8})/u);
  if (labeled?.[1]) return labeled[1];

  const unlabeled = basics.match(unlabeledNamePattern)?.[1];
  if (
    !unlabeled ||
    !commonSurnameInitials.includes(unlabeled[0] ?? "") ||
    commonLocationTerms.has(unlabeled) ||
    evidenceTermSuffix.test(unlabeled)
  ) {
    return undefined;
  }
  return unlabeled;
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
