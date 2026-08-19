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
export const contactRecommendations = [
  "contact", "verify_before_contact", "deprioritize"
] as const;

const requiredText = z.string().trim().min(1);
const conciseAnalysisText = requiredText.max(300);
const conciseConclusion = requiredText.max(600);

export const jobCriterionSchema = z.object({
  id: requiredText,
  text: requiredText,
  priority: z.enum(["hard", "preferred", "standard"]),
  source: z.enum(["custom", "jd", "profile"])
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

export const qualitativeEvidenceSchema = z.object({
  claim: conciseAnalysisText,
  jobEvidence: z.array(conciseAnalysisText).min(1).max(2),
  candidateEvidence: z.array(conciseAnalysisText).min(1).max(2)
});

export type QualitativeEvidence = z.infer<typeof qualitativeEvidenceSchema>;

const modelAnalysisSchema = z.object({
  overallScore: z.number().int().min(0).max(100),
  recommendation: z.enum(contactRecommendations),
  matches: z.array(qualitativeEvidenceSchema).min(2).max(5),
  concerns: z.array(qualitativeEvidenceSchema).max(3),
  verificationQuestions: z.array(conciseAnalysisText).max(3),
  recruiterConclusion: conciseConclusion
});

export const modelMatchResultSchema = modelAnalysisSchema;
export type ModelMatchResult = z.infer<typeof modelMatchResultSchema>;

export const matchAnalysisSchema = modelAnalysisSchema;

export type MatchAnalysis = z.infer<typeof matchAnalysisSchema>;
