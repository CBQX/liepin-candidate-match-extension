import { z } from "zod";
import {
  candidateDraftSchema,
  candidateRedactionContextSchema
} from "./candidate";
import { appErrorSchema } from "../errors";
import { jobSchema } from "./job";
import { modelRecruitmentProfileSchema } from "./recruitment-profile";

export const runtimeRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("EXTRACT_CURRENT_CANDIDATE") }),
  z.object({ type: z.literal("VALIDATE_PROVIDER") }),
  z.object({
    type: z.literal("ANALYZE_CANDIDATE"),
    requestId: z.string().trim().min(1).max(128),
    job: jobSchema,
    candidateDraft: candidateDraftSchema,
    redactionContext: candidateRedactionContextSchema
  }),
  z.object({
    type: z.literal("CANCEL_ANALYSIS"),
    requestId: z.string().trim().min(1).max(128)
  }),
  z.object({
    type: z.literal("GENERATE_JOB_PROFILE"),
    requestId: z.string().trim().min(1).max(128),
    job: jobSchema
  }),
  z.object({
    type: z.literal("CANCEL_JOB_PROFILE"),
    requestId: z.string().trim().min(1).max(128)
  }),
  z.object({
    type: z.literal("CONFIRM_JOB_PROFILE"),
    jobId: z.string().trim().min(1).max(128),
    profile: modelRecruitmentProfileSchema
  })
]);

export type RuntimeRequest = z.infer<typeof runtimeRequestSchema>;

export const pageContextChangedEventSchema = z.object({
  type: z.literal("PAGE_CONTEXT_CHANGED")
});

export type PageContextChangedEvent = z.infer<typeof pageContextChangedEventSchema>;

export const runtimeResponseSchema = z.union([
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({ ok: z.literal(false), error: appErrorSchema })
]);

export type RuntimeSuccess<T> = { ok: true; data: T };
export type RuntimeFailure = { ok: false; error: z.infer<typeof appErrorSchema> };
export type RuntimeResponse<T = unknown> = RuntimeSuccess<T> | RuntimeFailure;
