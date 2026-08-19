import { dimensionIds } from "../../shared/contracts/matching";
import type { ConfirmedRecruitmentProfile } from "../../shared/contracts/recruitment-profile";

export type DimensionWeights = Record<typeof dimensionIds[number], number>;

export function dimensionWeightsFromProfile(
  profile: ConfirmedRecruitmentProfile
): DimensionWeights {
  const weights = Object.fromEntries(
    dimensionIds.map((dimensionId) => [dimensionId, 0])
  ) as DimensionWeights;

  for (const requirement of profile.requirements) {
    weights[requirement.dimensionId] += requirement.weight / 100;
  }
  return weights;
}
