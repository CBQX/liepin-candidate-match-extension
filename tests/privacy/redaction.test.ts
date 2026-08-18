import { describe, expect, it } from "vitest";
import {
  prepareCandidateDraftForPreview,
  redactCandidateDraft
} from "../../src/shared/privacy";
import type { CandidateDraft } from "../../src/shared/contracts/candidate";

function candidateDraftWith(basics: string): CandidateDraft {
  return {
    basics: { text: basics, status: "complete" },
    workExperience: {
      text: "张三于 2022 年加入甲公司担任产品经理，完成招聘系统上线",
      status: "complete"
    },
    projects: { text: "招聘系统项目", status: "complete" },
    education: { text: "北京大学 本科", status: "complete" },
    skills: { text: "SaaS、产品规划", status: "complete" },
    other: { text: "QQ：12345678", status: "possibly_incomplete" },
    extractionConfidence: "high"
  };
}

describe("candidate redaction", () => {
  it("recognizes and redacts a bare name followed by age", () => {
    // Break caught: the common `张三 32岁` basics layout could leak a name because it has no explicit 姓名 label.
    const prepared = prepareCandidateDraftForPreview(candidateDraftWith("张三 32岁，现居上海"));

    expect(prepared.draft.basics.text).toBe("候选人 32岁，现居上海");
    expect(prepared.redactionContext).toMatchObject({
      identityTokens: ["张三"],
      identityDetection: "probable"
    });
  });

  it("redacts a recognized identity token exhaustively in every candidate section", () => {
    // Break caught: a name removed only from basics or person-predicate sentences could survive elsewhere in model input.
    const draft = candidateDraftWith("姓名：张三，32岁");
    draft.workExperience.text = "张三负责甲公司产品";
    draft.projects.text = "项目负责人张三";
    draft.education.text = "张三 北京大学本科";
    draft.skills.text = "张三：SaaS";
    draft.other.text = "推荐人提到张三";

    const prepared = prepareCandidateDraftForPreview(draft);
    const allText = Object.values(prepared.draft)
      .filter((value): value is CandidateDraft["basics"] => typeof value === "object")
      .map((section) => section.text)
      .join(" ");

    expect(allText).not.toContain("张三");
    expect(allText.match(/候选人/gu)?.length).toBe(6);
  });

  it("re-redacts recruiter edits with transient identity tokens", () => {
    // Break caught: users can paste the recognized name back into a preview after its first redaction.
    const prepared = prepareCandidateDraftForPreview(candidateDraftWith("姓名：张三，32岁"));
    const edited = structuredClone(prepared.draft);
    edited.projects.text = "张三负责新项目，联系邮箱 new@example.com";

    const submitted = redactCandidateDraft(edited, prepared.redactionContext);

    expect(submitted.projects.text).toBe("候选人负责新项目，联系邮箱 [已移除]");
    expect(submitted).not.toHaveProperty("redactionContext");
  });
  it("removes direct identifiers without removing employment evidence", () => {
    // Break caught: direct identity/contact data could be sent to the model, or broad redaction could erase job evidence.
    const redacted = redactCandidateDraft(candidateDraftWith(
      "张三，手机 13812345678，邮箱 zhangsan@example.com，微信 zhangsan88，曾任甲公司产品经理"
    ));
    const text = [
      redacted.basics,
      redacted.workExperience,
      redacted.projects,
      redacted.education,
      redacted.skills,
      redacted.other
    ].map((section) => section.text).join(" ");

    expect(text).not.toContain("13812345678");
    expect(text).not.toContain("zhangsan@example.com");
    expect(text).not.toContain("zhangsan88");
    expect(text).not.toContain("12345678");
    expect(text).not.toContain("张三");
    expect(text).toContain("候选人");
    expect(text).toContain("甲公司产品经理");
    expect(text).toContain("2022 年加入甲公司担任产品经理");
    expect(text).toContain("北京大学 本科");
    expect(text).toContain("SaaS、产品规划");
  });

  it("replaces a labeled basics name in a clear person-reference context", () => {
    // Break caught: restricting redaction to the basics source span would leak the confirmed name in a clear employment sentence.
    const draft = candidateDraftWith("姓名：李小明 年龄 31");
    draft.workExperience.text = "李小明曾任乙公司技术负责人";

    const redacted = redactCandidateDraft(draft);

    expect(redacted.basics.text).toBe("姓名：候选人 年龄 31");
    expect(redacted.workExperience.text).toBe("候选人曾任乙公司技术负责人");
  });

  it.each([
    ["1、李小明曾任乙公司技术负责人", "1、候选人曾任乙公司技术负责人"],
    ["• 李小明曾任乙公司技术负责人", "• 候选人曾任乙公司技术负责人"],
    ["（李小明曾任乙公司技术负责人）", "（候选人曾任乙公司技术负责人）"],
    ["经历 | 李小明曾任乙公司技术负责人", "经历 | 候选人曾任乙公司技术负责人"]
  ])("redacts a confirmed name after a structured boundary in %s", (source, expected) => {
    // Break caught: list and layout separators copied from a profile could prevent a clear person reference from being redacted.
    const draft = candidateDraftWith("姓名：李小明 年龄 31");
    draft.workExperience.text = source;

    const redacted = redactCandidateDraft(draft);

    expect(redacted.workExperience.text).toBe(expected);
  });

  it("redacts repeated confirmed-name references after collapsed whitespace", () => {
    // Break caught: whitespace collapsed from separate profile rows could leak later repeated references.
    const draft = candidateDraftWith("姓名：李小明 年龄 31");
    draft.workExperience.text = "李小明曾任甲公司产品经理 李小明现任乙公司技术负责人";

    const redacted = redactCandidateDraft(draft);

    expect(redacted.workExperience.text).toBe("候选人曾任甲公司产品经理 候选人现任乙公司技术负责人");
  });

  it.each([
    ["1、李小明品牌项目负责人", "1、候选人品牌项目负责人"],
    ["• 李小明零售业务增长", "• 候选人零售业务增长"],
    ["（李小明路负责区域招聘）", "（候选人路负责区域招聘）"],
    ["经历 | 李小明项目获得奖项", "经历 | 候选人项目获得奖项"],
    ["经历 李小明品牌项目负责人", "经历 候选人品牌项目负责人"],
    ["• 大李小明曾任乙公司技术负责人", "• 大候选人曾任乙公司技术负责人"]
  ])("redacts a confirmed token even without a person predicate in %s", (source, expected) => {
    // Break caught: context-sensitive replacement can miss a recognized identity token in an unexpected section layout.
    const draft = candidateDraftWith("姓名：李小明 年龄 31");
    draft.workExperience.text = source;

    const redacted = redactCandidateDraft(draft);

    expect(redacted.workExperience.text).toBe(expected);
  });

  it.each([
    "+86 138 1234 5678",
    "138-1234-5678",
    "+86-138-1234-5678",
    "138 1234 5678"
  ])("fully removes formatted mainland mobile number %s", (phone) => {
    // Break caught: replacing only a prefix of a formatted phone would still disclose reconstructable number fragments.
    const redacted = redactCandidateDraft(candidateDraftWith(`姓名：张三，联系电话 ${phone}，现居上海`));

    expect(redacted.basics.text).not.toContain("138");
    expect(redacted.basics.text).not.toContain("1234");
    expect(redacted.basics.text).not.toContain("5678");
    expect(redacted.basics.text).toContain("联系电话 [已移除]");
    expect(redacted.basics.text).toContain("现居上海");
  });

  it("does not infer leading titles, employers, or locations as candidate names", () => {
    // Break caught: broad leading-Han inference could globally erase material job evidence that merely appears first in basics.
    const titleDraft = candidateDraftWith("产品经理，负责 SaaS 招聘产品");
    titleDraft.workExperience.text = "产品经理在甲公司负责增长";
    const locationDraft = candidateDraftWith("上海，手机 13812345678");
    locationDraft.workExperience.text = "常驻上海服务甲公司";
    const employerDraft = candidateDraftWith("甲公司产品负责人，10 年经验");
    const surnameLikeLocationDraft = candidateDraftWith("苏州，手机 13812345678");
    surnameLikeLocationDraft.workExperience.text = "在苏州负责制造业客户";
    const surnameLikeEmployerDraft = candidateDraftWith("王公司，手机 13812345678");
    surnameLikeEmployerDraft.workExperience.text = "王公司产品负责人";

    const redactedTitle = redactCandidateDraft(titleDraft);
    const redactedLocation = redactCandidateDraft(locationDraft);
    const redactedEmployer = redactCandidateDraft(employerDraft);
    const redactedSurnameLikeLocation = redactCandidateDraft(surnameLikeLocationDraft);
    const redactedSurnameLikeEmployer = redactCandidateDraft(surnameLikeEmployerDraft);

    expect(redactedTitle.basics.text).toContain("产品经理");
    expect(redactedTitle.workExperience.text).toContain("产品经理在甲公司");
    expect(redactedLocation.workExperience.text).toContain("常驻上海服务甲公司");
    expect(redactedEmployer.basics.text).toContain("甲公司产品负责人");
    expect(redactedSurnameLikeLocation.workExperience.text).toContain("在苏州负责制造业客户");
    expect(redactedSurnameLikeEmployer.workExperience.text).toContain("王公司产品负责人");
  });

  it("fully removes a formatted mainland mobile number without a contact label", () => {
    // Break caught: redaction tied only to contact labels would leak a formatted number copied into free text.
    const draft = candidateDraftWith("姓名：张三，现居上海");
    draft.other.text = "可联系 +86 138 1234 5678";

    const redacted = redactCandidateDraft(draft);

    expect(redacted.other.text).toBe("可联系 [已移除]");
  });

  it("recognizes an unlabeled name only from an unambiguous self-identification phrase", () => {
    // Break caught: eliminating all inference would miss a name in strong person-specific context, while bare leading tokens remain ambiguous.
    const redacted = redactCandidateDraft(candidateDraftWith("本人名叫张三，手机 13812345678，现居上海"));

    expect(redacted.basics.text).toContain("候选人");
    expect(redacted.basics.text).not.toContain("张三");
    expect(redacted.basics.text).toContain("现居上海");
  });

  it.each(["沈阳", "徐州", "江门", "金华", "马鞍山", "黄山"])(
    "preserves ambiguous leading location %s and its employment evidence",
    (location) => {
      // Break caught: surname-shaped locations must not be guessed as names and erased globally.
      const draft = candidateDraftWith(`${location}，手机 13812345678`);
      draft.workExperience.text = `曾在${location}负责区域招聘业务`;

      const redacted = redactCandidateDraft(draft);

      expect(redacted.workExperience.text).toContain(`曾在${location}负责区域招聘业务`);
    }
  );

  it("redacts a probable leading identity everywhere when it also resembles a brand", () => {
    // Break caught: privacy must win after a token has been recognized; the user confirmation handles ambiguous extraction.
    const draft = candidateDraftWith("李宁，手机 13812345678");
    draft.workExperience.text = "曾负责李宁零售业务与渠道增长";

    const redacted = redactCandidateDraft(draft);

    expect(redacted.workExperience.text).toBe("曾负责候选人零售业务与渠道增长");
  });

  it("redacts a strong-field leading identity in basics and every later occurrence", () => {
    // Break caught: a token recovered before preview must remain available for exhaustive submission-time redaction.
    const draft = candidateDraftWith("张三，手机 13812345678");
    draft.workExperience.text = "张三品牌项目负责人";

    const redacted = redactCandidateDraft(draft);

    expect(redacted.basics.text).toContain("候选人");
    expect(redacted.basics.text).not.toContain("张三");
    expect(redacted.workExperience.text).toBe("候选人品牌项目负责人");
    expect(redacted.basics.text).not.toContain("13812345678");
  });
});
