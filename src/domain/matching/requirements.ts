import type { Job } from "../../shared/contracts/job";
import type { JobCriterion } from "../../shared/contracts/matching";

const HARD_MARKERS = /必须|硬性|不接受|不可/;
const PREFERRED_MARKERS = /优先|加分|最好|优选/;

const splitRequirements = (text: string): string[] =>
  text
    .split(/[\r\n。；;！？!?]+/u)
    .map((part) => part.trim())
    .filter(Boolean);

const priorityOf = (text: string): JobCriterion["priority"] => {
  if (HARD_MARKERS.test(text)) return "hard";
  if (PREFERRED_MARKERS.test(text)) return "preferred";
  return "standard";
};

export function parseJobCriteria(job: Job): JobCriterion[] {
  const sources = [
    ["custom", job.customRequirements],
    ["jd", job.jd]
  ] as const;

  return sources.flatMap(([source, text]) =>
    splitRequirements(text).map((criterionText, index) => ({
      id: `${source}-${index + 1}`,
      text: criterionText,
      priority: priorityOf(criterionText),
      source
    }))
  );
}
