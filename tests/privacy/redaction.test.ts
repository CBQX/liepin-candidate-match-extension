import { describe, expect, it } from "vitest";
import { redactCandidateDraft } from "../../src/shared/privacy";
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

  it("preserves an ambiguous leading employer brand and all employment evidence", () => {
    // Break caught: a brand that resembles a personal name must not trigger global evidence deletion.
    const draft = candidateDraftWith("李宁，手机 13812345678");
    draft.workExperience.text = "曾负责李宁零售业务与渠道增长";

    const redacted = redactCandidateDraft(draft);

    expect(redacted.workExperience.text).toBe("曾负责李宁零售业务与渠道增长");
  });

  it("redacts a strong-field leading identity only in basics and preserves the same token as evidence elsewhere", () => {
    // Break caught: refusing all leading identity sources leaks a mandated name, while global replacement destroys brand evidence.
    const draft = candidateDraftWith("张三，手机 13812345678");
    draft.workExperience.text = "张三品牌项目负责人";

    const redacted = redactCandidateDraft(draft);

    expect(redacted.basics.text).toContain("候选人");
    expect(redacted.basics.text).not.toContain("张三");
    expect(redacted.workExperience.text).toBe("张三品牌项目负责人");
    expect(redacted.basics.text).not.toContain("13812345678");
  });
});
