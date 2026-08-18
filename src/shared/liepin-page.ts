export type LiepinPageLocation = Pick<URL, "protocol" | "hostname" | "pathname" | "search">;

const REVIEWED_CANDIDATE_DETAIL_PATH = /^\/candidate\/([^/]+)\/?$/u;
const REVIEWED_RECRUITER_RESUME_DETAIL_PATH = /^\/resume\/showresumedetail\/?$/u;
const NUMERIC_CANDIDATE_ID = /^[1-9]\d{5,19}$/u;
const OPAQUE_CANDIDATE_ID = /^(?=.{12,64}$)(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9_-]+$/u;
const RESERVED_CANDIDATE_SEGMENTS = new Set([
  "search", "list", "index", "recommend", "recommended", "batch", "manage", "management"
]);

function isValidCandidateId(candidateId: string): boolean {
  return NUMERIC_CANDIDATE_ID.test(candidateId) || OPAQUE_CANDIDATE_ID.test(candidateId);
}

function toPageLocation(page: string | LiepinPageLocation): LiepinPageLocation | undefined {
  if (typeof page !== "string") return page;

  try {
    return new URL(page);
  } catch {
    return undefined;
  }
}

/**
 * Central, intentionally conservative boundary for pages that may be read as a
 * candidate profile. Extend only after adding a reviewed real-page fixture and
 * route test; a Liepin hostname alone is never sufficient.
 */
export function isSupportedLiepinCandidateDetailPage(
  page: string | LiepinPageLocation
): boolean {
  const location = toPageLocation(page);
  if (!location || location.protocol !== "https:") return false;

  const hostname = location.hostname.toLowerCase().replace(/\.$/u, "");
  const isLiepinHost = hostname === "liepin.com" || hostname.endsWith(".liepin.com");
  if (!isLiepinHost) return false;

  if (
    hostname === "h.liepin.com"
    && REVIEWED_RECRUITER_RESUME_DETAIL_PATH.test(location.pathname)
  ) {
    const resumeIds = new URLSearchParams(location.search).getAll("res_id_encode");
    return resumeIds.length === 1 && isValidCandidateId(resumeIds[0] ?? "");
  }

  const routeMatch = location.pathname.match(REVIEWED_CANDIDATE_DETAIL_PATH);
  const candidateId = routeMatch?.[1];
  if (!candidateId || RESERVED_CANDIDATE_SEGMENTS.has(candidateId.toLowerCase())) {
    return false;
  }

  return isValidCandidateId(candidateId);
}
