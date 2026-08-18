export type LiepinPageLocation = Pick<URL, "protocol" | "hostname" | "pathname">;

const REVIEWED_CANDIDATE_DETAIL_PATH = /^\/candidate\/([^/]+)\/?$/u;
const NUMERIC_CANDIDATE_ID = /^[1-9]\d{5,19}$/u;
const OPAQUE_CANDIDATE_ID = /^(?=.{12,64}$)(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9_-]+$/u;
const RESERVED_CANDIDATE_SEGMENTS = new Set([
  "search", "list", "index", "recommend", "recommended", "batch", "manage", "management"
]);

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

  const routeMatch = location.pathname.match(REVIEWED_CANDIDATE_DETAIL_PATH);
  const candidateId = routeMatch?.[1];
  if (!isLiepinHost || !candidateId || RESERVED_CANDIDATE_SEGMENTS.has(candidateId.toLowerCase())) {
    return false;
  }

  return NUMERIC_CANDIDATE_ID.test(candidateId) || OPAQUE_CANDIDATE_ID.test(candidateId);
}
