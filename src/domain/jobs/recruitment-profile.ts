import {
  confirmedRecruitmentProfileSchema,
  modelRecruitmentProfileSchema,
  type ConfirmedRecruitmentProfile,
  type ModelRecruitmentProfile
} from "../../shared/contracts/recruitment-profile";

export function normalizeRecruitmentProfileWeights(
  input: ModelRecruitmentProfile
): ModelRecruitmentProfile {
  const profile = modelRecruitmentProfileSchema.parse(input);
  const total = profile.requirements.reduce((sum, requirement) => sum + requirement.weight, 0);
  if (total <= 0) {
    throw new Error("岗位画像权重总和必须大于 0");
  }

  const allocated = profile.requirements.map((requirement, index) => {
    const exact = requirement.weight / total * 100;
    return { index, floor: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let pointsLeft = 100 - allocated.reduce((sum, item) => sum + item.floor, 0);
  const allocationOrder = [...allocated].sort(
    (left, right) => right.remainder - left.remainder || left.index - right.index
  );
  for (const item of allocationOrder) {
    if (pointsLeft <= 0) break;
    allocated[item.index]!.floor += 1;
    pointsLeft -= 1;
  }

  return modelRecruitmentProfileSchema.parse({
    ...profile,
    requirements: profile.requirements.map((requirement, index) => ({
      ...requirement,
      weight: allocated[index]!.floor
    }))
  });
}

export function confirmRecruitmentProfile(
  input: ModelRecruitmentProfile,
  confirmedAt: string
): ConfirmedRecruitmentProfile {
  return confirmedRecruitmentProfileSchema.parse({
    ...normalizeRecruitmentProfileWeights(input),
    confirmedAt
  });
}
