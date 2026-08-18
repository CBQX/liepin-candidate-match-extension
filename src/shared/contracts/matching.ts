import { z } from "zod";

export const dimensionIds = [
  "hard_requirements",
  "functional_expertise",
  "industry_business",
  "seniority_impact",
  "trajectory_stability",
  "recruiter_feasibility"
] as const;

export const requirementStatuses = ["met", "not_met", "unknown"] as const;
export const recommendations = [
  "strong_recommend", "recommend", "cautious", "not_recommend"
] as const;

const requiredText = z.string().trim().min(1);

export const jobCriterionSchema = z.object({
  id: requiredText,
  text: requiredText,
  priority: z.enum(["hard", "preferred", "standard"]),
  source: z.enum(["custom", "jd"])
});

export type JobCriterion = z.infer<typeof jobCriterionSchema>;

export const ruleEvaluationSchema = z.object({
  criterionId: requiredText,
  status: z.enum(requirementStatuses),
  evidence: z.array(requiredText)
}).superRefine((evaluation, context) => {
  if (evaluation.status !== "unknown" && evaluation.evidence.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["evidence"],
      message: "A deterministic hard-requirement status requires evidence"
    });
  }
});

export type RuleEvaluation = z.infer<typeof ruleEvaluationSchema>;

export const dimensionScoreSchema = z.object({
  dimensionId: z.enum(dimensionIds),
  score: z.number().int().min(0).max(100),
  evidence: z.array(requiredText).min(1)
});

export type DimensionScore = z.infer<typeof dimensionScoreSchema>;

export const qualitativeEvidenceSchema = z.object({
  claim: requiredText,
  jobEvidence: z.array(requiredText).min(1),
  candidateEvidence: z.array(requiredText).min(1)
});

export type QualitativeEvidence = z.infer<typeof qualitativeEvidenceSchema>;

const modelAnalysisSchema = z.object({
  dimensionScores: z.array(dimensionScoreSchema),
  matches: z.array(qualitativeEvidenceSchema),
  mismatches: z.array(qualitativeEvidenceSchema),
  risks: z.array(qualitativeEvidenceSchema),
  missingInformation: z.array(qualitativeEvidenceSchema),
  verificationQuestions: z.array(requiredText),
  outreachAdvice: z.array(requiredText),
  recruiterConclusion: requiredText
});

export const modelMatchResultSchema = modelAnalysisSchema;
export type ModelMatchResult = z.infer<typeof modelMatchResultSchema>;

export const matchAnalysisSchema = modelAnalysisSchema.extend({
  overallScore: z.number().int().min(0).max(100),
  recommendation: z.enum(recommendations),
  confidence: z.enum(["high", "medium", "low"]),
  hardRequirements: z.array(ruleEvaluationSchema)
});

export type MatchAnalysis = z.infer<typeof matchAnalysisSchema>;
