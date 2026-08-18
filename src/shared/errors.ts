import { z } from "zod";

export const appErrorCodes = [
  "UNSUPPORTED_PAGE",
  "EXTRACTION_FAILED",
  "MISSING_API_KEY",
  "INVALID_API_KEY",
  "RATE_LIMITED",
  "INSUFFICIENT_BALANCE",
  "MODEL_TIMEOUT",
  "INVALID_MODEL_OUTPUT",
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
