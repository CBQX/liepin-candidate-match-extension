import { z } from "zod";

const requiredText = z.string().trim().min(1);

export const jobSchema = z.object({
  id: requiredText,
  company: requiredText,
  jd: requiredText,
  customRequirements: requiredText,
  createdAt: requiredText,
  updatedAt: requiredText
});

export type Job = z.infer<typeof jobSchema>;
