export type LiepinPageLocation = Pick<URL, "protocol" | "hostname" | "pathname">;

const REVIEWED_CANDIDATE_DETAIL_PATH = /^\/candidate\/[^/]+\/?$/u;

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

  return isLiepinHost && REVIEWED_CANDIDATE_DETAIL_PATH.test(location.pathname);
}
