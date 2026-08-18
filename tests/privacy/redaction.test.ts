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
});
