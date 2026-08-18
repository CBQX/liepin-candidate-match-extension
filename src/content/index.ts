import type { RuntimeFailure, RuntimeResponse } from "../shared/contracts/messages";
import { extractCandidate, UnsupportedPageError } from "./extract-candidate";

function failureFrom(error: unknown): RuntimeFailure {
  if (error instanceof UnsupportedPageError) {
    return {
      ok: false,
      error: { code: "UNSUPPORTED_PAGE", message: error.message }
    };
  }

  return {
    ok: false,
    error: {
      code: "EXTRACTION_FAILED",
      message: error instanceof Error ? error.message : "候选人信息提取失败"
    }
  };
}

chrome.runtime.onMessage.addListener((request: unknown, _sender, sendResponse) => {
  if (
    typeof request !== "object" ||
    request === null ||
    !("type" in request) ||
    request.type !== "EXTRACT_CURRENT_CANDIDATE"
  ) {
    return undefined;
  }

  Promise.resolve()
    .then((): RuntimeResponse => ({
      ok: true,
      data: extractCandidate(document, location)
    }))
    .catch(failureFrom)
    .then(sendResponse);

  return true;
});
