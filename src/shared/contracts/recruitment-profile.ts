import { z } from "zod";
import { dimensionIds } from "./matching";

const requiredText = z.string().trim().min(1);
const protectedCriterion = /年龄|\d+\s*(?:周)?岁|性别|男性|女性|男士|女士|民族|汉族|婚姻|已婚|未婚|婚育|生育|怀孕/u;

export const recruitmentRequirementSchema = z.object({
  id: requiredText,
  text: requiredText,
  priority: z.enum(["hard", "preferred", "standard"]),
  dimensionId: z.enum(dimensionIds),
  weight: z.number().finite().nonnegative(),
  jobEvidence: z.array(requiredText).min(1)
});

const recruitmentProfileShape = {
  version: z.literal(1),
  roleTitle: requiredText,
  roleObjective: requiredText,
  requirements: z.array(recruitmentRequirementSchema).min(1).max(20),
  acceptableAlternatives: z.array(requiredText),
  ambiguities: z.array(requiredText),
  verificationQuestions: z.array(requiredText)
} as const;

const rejectProtectedRecruitmentCriteria = (
  profile: z.infer<z.ZodObject<typeof recruitmentProfileShape>>,
  context: z.RefinementCtx
) => {
  const profileFields = [
    ["roleTitle", profile.roleTitle],
    ["roleObjective", profile.roleObjective],
    ["acceptableAlternatives", profile.acceptableAlternatives.join(" ")],
    ["ambiguities", profile.ambiguities.join(" ")],
    ["verificationQuestions", profile.verificationQuestions.join(" ")]
  ] as const;
  profileFields.forEach(([field, text]) => {
    if (protectedCriterion.test(text)) {
      context.addIssue({
        code: "custom",
        path: [field],
        message: "岗位画像不得包含受保护的个人特征"
      });
    }
  });
  profile.requirements.forEach((requirement, index) => {
    if (protectedCriterion.test([requirement.text, ...requirement.jobEvidence].join(" "))) {
      context.addIssue({
        code: "custom",
        path: ["requirements", index, "text"],
        message: "招聘要求不得包含受保护的个人特征"
      });
    }
  });
};

export const modelRecruitmentProfileSchema = z.object(recruitmentProfileShape)
  .superRefine(rejectProtectedRecruitmentCriteria);

export const confirmedRecruitmentProfileSchema = z.object({
  ...recruitmentProfileShape,
  confirmedAt: requiredText
}).superRefine(rejectProtectedRecruitmentCriteria);

export type RecruitmentRequirement = z.infer<typeof recruitmentRequirementSchema>;
export type ModelRecruitmentProfile = z.infer<typeof modelRecruitmentProfileSchema>;
export type ConfirmedRecruitmentProfile = z.infer<typeof confirmedRecruitmentProfileSchema>;
