import type { CandidateDraft } from "../../shared/contracts/candidate";
import {
  dimensionIds,
  type MatchAnalysis,
  type ModelMatchResult,
  type RuleEvaluation
} from "../../shared/contracts/matching";
import { DIMENSION_WEIGHTS } from "./weights";

type Confidence = CandidateDraft["extractionConfidence"];
type Recommendation = MatchAnalysis["recommendation"];

const scoreRecommendation = (score: number): Recommendation => {
  if (score >= 85) return "strong_recommend";
  if (score >= 70) return "recommend";
  if (score >= 55) return "cautious";
  return "not_recommend";
};

const downgrade = (recommendation: Recommendation): Recommendation => {
  const levels: readonly Recommendation[] = [
    "strong_recommend",
    "recommend",
    "cautious",
    "not_recommend"
  ];
  const index = levels.indexOf(recommendation);
  return levels[Math.min(index + 1, levels.length - 1)]!;
};

const validateDimensions = (modelResult: ModelMatchResult): void => {
  const counts = new Map<string, number>();
  modelResult.dimensionScores.forEach(({ dimensionId }) => {
    counts.set(dimensionId, (counts.get(dimensionId) ?? 0) + 1);
  });

  const valid = modelResult.dimensionScores.length === dimensionIds.length
    && dimensionIds.every((dimensionId) => counts.get(dimensionId) === 1)
    && [...counts.keys()].every((dimensionId) => dimensionIds.includes(
      dimensionId as typeof dimensionIds[number]
    ));

  if (!valid) {
    throw new Error("Model result must contain every matching dimension exactly once");
  }
};

const rank: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

const lowestConfidence = (...values: readonly Confidence[]): Confidence => values.reduce(
  (lowest, value) => rank[value] < rank[lowest] ? value : lowest,
  "high" as Confidence
);

const confidenceForSections = (draft: CandidateDraft): Confidence => {
  if (draft.basics.status === "missing" || draft.workExperience.status === "missing") {
    return "low";
  }
  if (
    draft.basics.status === "possibly_incomplete"
    || draft.workExperience.status === "possibly_incomplete"
  ) {
    return "medium";
  }

  const supportingGaps = (["projects", "education", "skills"] as const)
    .filter((section) => draft[section].status !== "complete").length;
  return supportingGaps >= 2 ? "low" : supportingGaps === 1 ? "medium" : "high";
};

const confidenceForModelGaps = (modelResult: ModelMatchResult): Confidence => {
  const criticalGap = modelResult.missingInformation.some(({ claim }) =>
    /核心|关键|硬性|工作经历|任职|年限|学历|证书/u.test(claim)
  );
  if (criticalGap || modelResult.missingInformation.length >= 3) return "low";
  return modelResult.missingInformation.length > 0 ? "medium" : "high";
};

const deriveConfidence = (
  modelResult: ModelMatchResult,
  candidate: CandidateDraft | Confidence,
  unknownCount: number
): Confidence => {
  const confidenceForUnknowns: Confidence = unknownCount >= 2
    ? "low"
    : unknownCount === 1
      ? "medium"
      : "high";
  const extractionConfidence = typeof candidate === "string"
    ? candidate
    : candidate.extractionConfidence;
  const sectionConfidence = typeof candidate === "string"
    ? "high"
    : confidenceForSections(candidate);

  return lowestConfidence(
    extractionConfidence,
    sectionConfidence,
    confidenceForUnknowns,
    confidenceForModelGaps(modelResult)
  );
};

export function composeAnalysis(
  modelResult: ModelMatchResult,
  ruleResults: readonly RuleEvaluation[],
  candidate: CandidateDraft | Confidence
): MatchAnalysis {
  validateDimensions(modelResult);

  const overallScore = Math.round(modelResult.dimensionScores.reduce(
    (total, dimension) => total + dimension.score * DIMENSION_WEIGHTS[dimension.dimensionId],
    0
  ));
  const failureCount = ruleResults.filter(({ status }) => status === "not_met").length;
  const unknownCount = ruleResults.filter(({ status }) => status === "unknown").length;
  const scoreBand = scoreRecommendation(overallScore);
  const recommendation = failureCount >= 2
    ? "not_recommend"
    : failureCount === 1
      ? downgrade(scoreBand)
      : scoreBand;

  return {
    ...modelResult,
    overallScore,
    recommendation,
    confidence: deriveConfidence(modelResult, candidate, unknownCount),
    hardRequirements: [...ruleResults]
  };
}
