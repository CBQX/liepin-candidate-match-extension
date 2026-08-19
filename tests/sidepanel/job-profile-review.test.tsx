import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobProfileReview } from "../../src/sidepanel/components/JobProfileReview";
import type { ModelRecruitmentProfile } from "../../src/shared/contracts/recruitment-profile";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const modelProfile: ModelRecruitmentProfile = {
  version: 1,
  roleTitle: "企业软件产品经理",
  roleObjective: "负责虚构企业软件产品规划与交付",
  requirements: [
    {
      id: "requirement-1",
      text: "具备企业软件产品经验",
      priority: "hard",
      dimensionId: "functional_expertise",
      weight: 70,
      jobEvidence: ["岗位要求企业软件产品经验"]
    },
    {
      id: "requirement-2",
      text: "理解订阅业务",
      priority: "preferred",
      dimensionId: "industry_business",
      weight: 30,
      jobEvidence: ["订阅业务经验优先"]
    }
  ],
  acceptableAlternatives: ["复杂 B2B 平台经验"],
  ambiguities: ["团队规模未说明"],
  verificationQuestions: ["请确认团队规模"]
};

describe("JobProfileReview", () => {
  it("edits, adds, deletes, reprioritizes, recategorizes, and confirms once", async () => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "manual-requirement") });
    const onConfirm = vi.fn<(profile: ModelRecruitmentProfile) => Promise<string | undefined>>(
      async () => undefined
    );
    const user = userEvent.setup();
    render(<JobProfileReview profile={modelProfile} onConfirm={onConfirm} onRegenerate={vi.fn()} />);

    await user.clear(screen.getByLabelText("岗位名称"));
    await user.type(screen.getByLabelText("岗位名称"), "海外产品经理");
    await user.selectOptions(screen.getByLabelText("要求 1 优先级"), "preferred");
    await user.click(screen.getByRole("button", { name: "删除要求 2" }));
    await user.click(screen.getByRole("button", { name: "增加招聘要求" }));
    await user.type(screen.getByLabelText("要求 2 内容"), "具备跨区域协作经验");
    await user.selectOptions(screen.getByLabelText("要求 2 匹配维度"), "recruiter_feasibility");
    await user.click(screen.getByRole("button", { name: "确认岗位画像" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm.mock.calls[0]?.[0]).toMatchObject({
      roleTitle: "海外产品经理",
      requirements: [
        { id: "requirement-1", priority: "preferred" },
        {
          id: "manual-requirement",
          text: "具备跨区域协作经验",
          priority: "standard",
          dimensionId: "recruiter_feasibility",
          jobEvidence: ["猎头手动补充要求：具备跨区域协作经验"]
        }
      ]
    });
  });

  it("shows adjacent errors for blank profile fields without discarding edits", async () => {
    const onConfirm = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(<JobProfileReview profile={modelProfile} onConfirm={onConfirm} onRegenerate={vi.fn()} />);

    await user.clear(screen.getByLabelText("岗位名称"));
    await user.clear(screen.getByLabelText("岗位目标"));
    await user.clear(screen.getByLabelText("要求 1 内容"));
    await user.click(screen.getByRole("button", { name: "确认岗位画像" }));

    expect(screen.getByText("请输入岗位名称")).toBeTruthy();
    expect(screen.getByText("请输入岗位目标")).toBeTruthy();
    expect(screen.getByText("请输入招聘要求")).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
    expect((screen.getByLabelText("要求 2 内容") as HTMLTextAreaElement).value).toBe("理解订阅业务");
  });

  it("requires at least one requirement", async () => {
    const onConfirm = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(<JobProfileReview profile={{
      ...modelProfile,
      requirements: [modelProfile.requirements[0]!]
    }} onConfirm={onConfirm} onRegenerate={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "删除要求 1" }));
    await user.click(screen.getByRole("button", { name: "确认岗位画像" }));

    expect(screen.getByText("请至少保留一条招聘要求")).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("rejects protected criteria before confirmation", async () => {
    const onConfirm = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(<JobProfileReview profile={modelProfile} onConfirm={onConfirm} onRegenerate={vi.fn()} />);

    const requirement = screen.getByLabelText("要求 1 内容");
    await user.clear(requirement);
    await user.type(requirement, "只招男性");
    await user.click(screen.getByRole("button", { name: "确认岗位画像" }));

    expect(screen.getByText("招聘要求不得包含受保护的个人特征")).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("explains protected characteristics in the editable profile summary", async () => {
    const onConfirm = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(<JobProfileReview profile={modelProfile} onConfirm={onConfirm} onRegenerate={vi.fn()} />);

    const title = screen.getByLabelText("岗位名称");
    await user.clear(title);
    await user.type(title, "只招男性的产品经理");
    await user.click(screen.getByRole("button", { name: "确认岗位画像" }));

    expect(screen.getByText("岗位画像不得包含受保护的个人特征")).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("retains edited fields when confirmation storage fails", async () => {
    const onConfirm = vi.fn(async () => "岗位画像保存失败，请重试。");
    const user = userEvent.setup();
    render(<JobProfileReview profile={modelProfile} onConfirm={onConfirm} onRegenerate={vi.fn()} />);

    const title = screen.getByLabelText("岗位名称");
    await user.clear(title);
    await user.type(title, "编辑后的岗位");
    await user.click(screen.getByRole("button", { name: "确认岗位画像" }));

    expect(await screen.findByText("岗位画像保存失败，请重试。")).toBeTruthy();
    expect((title as HTMLInputElement).value).toBe("编辑后的岗位");
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
