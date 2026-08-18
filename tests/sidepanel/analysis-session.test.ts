import { describe, expect, it } from "vitest";
import type { CandidateDraft } from "../../src/shared/contracts/candidate";
import type { MatchAnalysis } from "../../src/shared/contracts/matching";
import {
  analysisSessionInitialState,
  analysisSessionReducer
} from "../../src/sidepanel/analysis-session";

const draft: CandidateDraft = {
  basics: { text: "候选人，上海", status: "complete" },
  workExperience: { text: "甲公司产品经理", status: "complete" },
  projects: { text: "招聘系统", status: "complete" },
  education: { text: "本科", status: "complete" },
  skills: { text: "SaaS", status: "complete" },
  other: { text: "", status: "missing" },
  extractionConfidence: "high"
};

const result: MatchAnalysis = {
  overallScore: 80,
  recommendation: "recommend",
  confidence: "high",
  dimensionScores: [],
  hardRequirements: [],
  matches: [],
  mismatches: [],
  risks: [],
  missingInformation: [],
  verificationQuestions: [],
  outreachAdvice: [],
  recruiterConclusion: "建议推进"
};

const redactionContext = {
  identityTokens: ["张三"],
  identityDetection: "confirmed" as const
};

describe("analysis session reducer", () => {
  it.each(["JOB_CHANGED", "PAGE_CHANGED", "SESSION_ENDED"] as const)(
    "%s clears both the candidate draft and analysis result",
    (type) => {
      // Break caught: stale candidate or result data could survive a context boundary and be reused for another job/page/session.
      const populated = { draft, result };

      expect(analysisSessionReducer(populated, { type })).toEqual(analysisSessionInitialState);
    }
  );

  it("keeps edited candidate content only in the current transient state", () => {
    // Break caught: preview edits could be ignored, leaving the uncorrected extracted content for analysis.
    const loaded = analysisSessionReducer(analysisSessionInitialState, {
      type: "DRAFT_LOADED",
      draft,
      redactionContext
    });
    const edited = analysisSessionReducer(loaded, {
      type: "DRAFT_EDITED",
      section: "skills",
      text: "SaaS、AI"
    });

    expect(edited.draft?.skills.text).toBe("SaaS、AI");
    expect(edited.draft?.skills.status).toBe("complete");
    expect(loaded.draft?.skills.text).toBe("SaaS");
    expect(edited.redactionContext).toEqual(redactionContext);
  });

  it("preserves the preview and its redaction context after analysis cancellation", () => {
    // Break caught: retrying a retained preview without its recognized identity token could leak a pasted name.
    const populated = { draft, redactionContext };

    expect(analysisSessionReducer(populated, { type: "ANALYSIS_CANCELLED" })).toEqual(populated);
  });
});
