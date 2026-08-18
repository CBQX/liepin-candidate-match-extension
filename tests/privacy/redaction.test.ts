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

  it("uses a labeled basics name as the neutral replacement across sections", () => {
    // Break caught: relying only on a leading name would leak profiles whose basics use an explicit 姓名 label.
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
    expect(redactedLocation.basics.text).toContain("上海");
    expect(redactedLocation.workExperience.text).toContain("常驻上海服务甲公司");
    expect(redactedEmployer.basics.text).toContain("甲公司产品负责人");
    expect(redactedSurnameLikeLocation.basics.text).toContain("苏州");
    expect(redactedSurnameLikeLocation.workExperience.text).toContain("在苏州负责制造业客户");
    expect(redactedSurnameLikeEmployer.basics.text).toContain("王公司");
    expect(redactedSurnameLikeEmployer.workExperience.text).toContain("王公司产品负责人");
  });

  it("fully removes a formatted mainland mobile number without a contact label", () => {
    // Break caught: redaction tied only to contact labels would leak a formatted number copied into free text.
    const draft = candidateDraftWith("姓名：张三，现居上海");
    draft.other.text = "可联系 +86 138 1234 5678";

    const redacted = redactCandidateDraft(draft);

    expect(redacted.other.text).toBe("可联系 [已移除]");
  });

  it("still recognizes a conservative unlabeled personal-name format", () => {
    // Break caught: eliminating unsafe inference entirely would regress a common basics row whose name precedes a labeled contact field.
    const redacted = redactCandidateDraft(candidateDraftWith("张三，手机 13812345678，现居上海"));

    expect(redacted.basics.text).toContain("候选人");
    expect(redacted.basics.text).not.toContain("张三");
    expect(redacted.basics.text).toContain("现居上海");
  });
});
