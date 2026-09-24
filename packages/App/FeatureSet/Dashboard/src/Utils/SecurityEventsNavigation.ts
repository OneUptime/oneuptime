/*
 * Which Security Events tab a route is on.
 *
 * The product used to hang its seven destinations off a left side menu, which
 * put it out of step with every other telemetry signal: Logs, Traces, Metrics
 * and Exceptions all carry their destinations as tabs in the page header, and
 * the events list under this one is now the same explorer those pages render.
 * Keeping the mapping here (rather than inside the layout) is what lets
 * App/Tests pin every route to its tab without rendering a page.
 *
 * Matching is done on the path SEGMENT after `/security-events/`, not with a
 * substring test on the whole path: a project id, a saved-view name or a
 * query string that happened to contain "monitors" would otherwise light up
 * the wrong tab.
 */

export type SecurityEventsTabKey =
  | "events"
  | "correlate"
  | "detection-rules"
  | "threat-intel"
  | "monitors"
  | "connections"
  | "setup";

const SEGMENT_TO_TAB: Record<string, SecurityEventsTabKey> = {
  correlate: "correlate",
  "detection-rules": "detection-rules",
  "threat-intel": "threat-intel",
  monitors: "monitors",
  connections: "connections",
  documentation: "setup",
};

const ROOT_SEGMENT: string = "security-events";

/**
 * The segment that follows `security-events` in a path, or "" when the path
 * IS the product root (with or without a trailing slash, and with or without
 * the `/*` react-router leaves on a wildcard route).
 *
 * Returns null when the path is not a Security Events route at all, so a
 * caller can tell "the events list" apart from "not ours".
 */
export function getSecurityEventsPathSegment(path: string): string | null {
  const withoutQuery: string = (path || "").split("?")[0] || "";
  const segments: Array<string> = withoutQuery
    .split("/")
    .filter((segment: string): boolean => {
      return segment.length > 0 && segment !== "*";
    });

  const rootIndex: number = segments.lastIndexOf(ROOT_SEGMENT);

  if (rootIndex === -1) {
    return null;
  }

  return segments[rootIndex + 1] || "";
}

export function getActiveSecurityEventsTab(path: string): SecurityEventsTabKey {
  const segment: string | null = getSecurityEventsPathSegment(path);

  if (segment === null) {
    return "events";
  }

  return SEGMENT_TO_TAB[segment] || "events";
}
