import { z } from "zod";

export const appErrorCodes = [
  "UNSUPPORTED_PAGE",
  "EXTRACTION_FAILED",
  "MISSING_API_KEY",
  "INVALID_API_KEY",
  "INVALID_PROVIDER_SETTINGS",
  "INVALID_PROVIDER_REQUEST",
  "MODEL_UNAVAILABLE",
  "NETWORK_FAILED",
  "PROVIDER_SERVICE_UNAVAILABLE",
  "RATE_LIMITED",
  "INSUFFICIENT_BALANCE",
  "MODEL_TIMEOUT",
  "ANALYSIS_CANCELLED",
  "INVALID_MODEL_OUTPUT",
  "JOB_PROFILE_REQUIRED",
  "STORAGE_FAILED",
  "UNKNOWN"
] as const;

export const appErrorCodeSchema = z.enum(appErrorCodes);
export type AppErrorCode = z.infer<typeof appErrorCodeSchema>;

export const appErrorSchema = z.object({
  code: appErrorCodeSchema,
  message: z.string().trim().min(1)
});

export type AppError = z.infer<typeof appErrorSchema>;
