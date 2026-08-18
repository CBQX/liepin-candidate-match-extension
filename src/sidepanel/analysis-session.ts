import type {
  CandidateDraft,
  CandidateRedactionContext
} from "../shared/contracts/candidate";
import type { MatchAnalysis } from "../shared/contracts/matching";

type CandidateSectionKey = Exclude<keyof CandidateDraft, "extractionConfidence">;

export interface AnalysisSessionState {
  draft?: CandidateDraft;
  redactionContext?: CandidateRedactionContext;
  result?: MatchAnalysis;
}

export type AnalysisSessionAction =
  | { type: "DRAFT_LOADED"; draft: CandidateDraft; redactionContext: CandidateRedactionContext }
  | { type: "DRAFT_EDITED"; section: CandidateSectionKey; text: string }
  | { type: "RESULT_LOADED"; result: MatchAnalysis }
  | { type: "ANALYSIS_CANCELLED" }
  | { type: "JOB_CHANGED" }
  | { type: "PAGE_CHANGED" }
  | { type: "SESSION_ENDED" };

export const analysisSessionInitialState: AnalysisSessionState = {};

export function analysisSessionReducer(
  state: AnalysisSessionState,
  action: AnalysisSessionAction
): AnalysisSessionState {
  switch (action.type) {
    case "DRAFT_LOADED":
      return { draft: action.draft, redactionContext: action.redactionContext };
    case "DRAFT_EDITED":
      if (!state.draft) return state;
      return {
        ...state,
        draft: {
          ...state.draft,
          [action.section]: {
            ...state.draft[action.section],
            text: action.text,
            status: action.text.trim() ? "complete" : "missing"
          }
        }
      };
    case "RESULT_LOADED":
      return { ...state, result: action.result };
    case "ANALYSIS_CANCELLED":
      return state.draft ? { draft: state.draft } : analysisSessionInitialState;
    case "JOB_CHANGED":
    case "PAGE_CHANGED":
    case "SESSION_ENDED":
      return analysisSessionInitialState;
  }
}
