import { z } from "zod";

export const extractedSectionStatuses = [
  "complete",
  "possibly_incomplete",
  "missing"
] as const;

export const extractedSectionSchema = z.object({
  text: z.string(),
  status: z.enum(extractedSectionStatuses)
});

export type ExtractedSection = z.infer<typeof extractedSectionSchema>;

export const candidateDraftSchema = z.object({
  basics: extractedSectionSchema,
  workExperience: extractedSectionSchema,
  projects: extractedSectionSchema,
  education: extractedSectionSchema,
  skills: extractedSectionSchema,
  other: extractedSectionSchema,
  extractionConfidence: z.enum(["high", "medium", "low"])
});

export type CandidateDraft = z.infer<typeof candidateDraftSchema>;

export const candidateRedactionContextSchema = z.object({
  identityTokens: z.array(z.string().trim().min(2).max(32)).max(4),
  identityDetection: z.enum(["confirmed", "probable", "undetected"])
});

export type CandidateRedactionContext = z.infer<typeof candidateRedactionContextSchema>;
