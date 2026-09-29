/*
 * Pure resolution of breadcrumb destinations.
 *
 * A breadcrumb trail mirrors the URL segments of the current page: crumb `i`
 * conceptually corresponds to the URL truncated to `i + 3` segments (the
 * leading "", "dashboard" and the project id account for the first three).
 *
 * Historically each crumb linked to that truncated URL directly. That is wrong
 * for the many intermediate segments that are only section *prefixes* with no
 * page of their own — `/user-settings`, `/on-call-duty`, `/<product>/settings`,
 * `/ai`, `/llm`. Linking to such a prefix navigates to a route that matches
 * nothing and renders a blank page. Leaf detail pages (`/traces/view/:id`) have
 * the mirror problem: the last crumb's truncated URL drops the id.
 *
 * This module contains the pure, framework-agnostic decision of *what* each
 * crumb should point at, expressed as a `BreadcrumbTarget` descriptor. It has no
 * dependency on the router or the app's route table so it can be unit-tested in
 * isolation. Callers translate the descriptor into a concrete route.
 */

export enum BreadcrumbTargetKind {
  // Link to the project home (URL truncated to its first 3 segments).
  Home = "home",
  // The current page — rendered as plain text, never a link.
  CurrentPage = "current",
  // Link to an ancestor page that lies on the current path, at `depth` segments.
  Ancestor = "ancestor",
  // Link to a real page on a different branch (the section's landing page).
  SectionLanding = "landing",
}

export interface BreadcrumbTarget {
  kind: BreadcrumbTargetKind;
  /*
   * Number of URL segments to keep (including the leading empty segment) when
   * building the link. Present for Home and Ancestor.
   */
  depth?: number | undefined;
  /*
   * Fully-qualified route pattern (may still contain `:params`) of the section
   * landing page. Present only for SectionLanding.
   */
  routePattern?: string | undefined;
}

export interface ResolveBreadcrumbTrailOptions {
  // Route pattern of the page the trail is for, e.g. "/dashboard/:projectId/x".
  pagePattern: string;
  // Number of crumbs in the trail.
  crumbCount: number;
  // Every real, navigable route pattern, in declaration order.
  realRoutePatterns: ReadonlyArray<string>;
}

/*
 * Strip a trailing slash so "/a/b/" and "/a/b" compare equal. The root "/" is
 * left intact.
 */
export function normalizeRoutePath(path: string): string {
  if (path.length > 1 && path.endsWith("/")) {
    return path.replace(/\/+$/, "");
  }
  return path;
}

/*
 * Resolve the destination of a single crumb.
 *
 *  - First crumb ("Project")            -> Home.
 *  - Last crumb                         -> CurrentPage (plain text).
 *  - Intermediate crumb                 -> the nearest real ancestor route on the
 *                                          current path; else the section's
 *                                          landing page; else CurrentPage. It
 *                                          never points at a non-existent route.
 */
export function resolveBreadcrumbTarget(options: {
  index: number;
  crumbCount: number;
  pagePattern: string;
  realRoutePatterns: ReadonlyArray<string>;
}): BreadcrumbTarget {
  const { index, crumbCount, pagePattern, realRoutePatterns } = options;

  if (index <= 0) {
    return { kind: BreadcrumbTargetKind.Home, depth: 3 };
  }

  if (index >= crumbCount - 1) {
    return { kind: BreadcrumbTargetKind.CurrentPage };
  }

  const normalizedPage: string = normalizeRoutePath(pagePattern);
  const pageSegments: Array<string> = normalizedPage.split("/");
  const realRouteSet: Set<string> = new Set(
    realRoutePatterns.map(normalizeRoutePath),
  );

  // Depth (segment count) of this crumb's own URL prefix.
  const crumbDepth: number = index + 3;

  /*
   * Walk from this crumb's prefix depth toward — but not including — the current
   * page and link to the nearest ancestor that is a real page. This links
   * "Insights" to /ai/insights on an /ai/insights/settings page, and keeps
   * section list pages (e.g. "Traces" -> /traces) linkable as before.
   */
  for (let depth: number = crumbDepth; depth < pageSegments.length; depth++) {
    const ancestorPattern: string = pageSegments.slice(0, depth).join("/");
    if (realRouteSet.has(ancestorPattern)) {
      return { kind: BreadcrumbTargetKind.Ancestor, depth };
    }
  }

  /*
   * The crumb sits at or beyond the current page's own depth — either a "packed"
   * trail with more crumbs than URL segments (e.g. Project > Profiler > Overview
   * on /profiles, where "Profiler" and "Overview" share the single /profiles
   * segment), or exactly the page depth. There is no distinct ancestor page to
   * point at, so render it as plain text like the current page's own crumb
   * rather than inventing a link to a sibling.
   */
  if (crumbDepth >= pageSegments.length) {
    return { kind: BreadcrumbTargetKind.CurrentPage };
  }

  /*
   * The prefix is a bare section root with no page above the current page (e.g.
   * /user-settings). Fall back to the section's landing page — the first
   * declared real route under the prefix — so the crumb still navigates
   * somewhere useful.
   */
  const prefixWithSlash: string =
    pageSegments.slice(0, crumbDepth).join("/") + "/";
  const landingPattern: string | undefined = realRoutePatterns
    .map(normalizeRoutePath)
    .find((pattern: string): boolean => {
      return pattern.startsWith(prefixWithSlash);
    });

  // No page under the prefix, or the landing is the current page -> plain text.
  if (!landingPattern || landingPattern === normalizedPage) {
    return { kind: BreadcrumbTargetKind.CurrentPage };
  }

  /*
   * The landing is a real page on a different branch of this section (e.g.
   * "On-Call Duty" -> /policies while viewing /schedules). A landing that lay on
   * the current path would already have been returned as an Ancestor by the loop
   * above, so at this point it is always off-path; the caller fills in the
   * project id.
   */
  return {
    kind: BreadcrumbTargetKind.SectionLanding,
    routePattern: landingPattern,
  };
}

// Resolve the destination of every crumb in a trail.
export function resolveBreadcrumbTrail(
  options: ResolveBreadcrumbTrailOptions,
): Array<BreadcrumbTarget> {
  const { pagePattern, crumbCount, realRoutePatterns } = options;

  const targets: Array<BreadcrumbTarget> = [];
  for (let index: number = 0; index < crumbCount; index++) {
    targets.push(
      resolveBreadcrumbTarget({
        index,
        crumbCount,
        pagePattern,
        realRoutePatterns,
      }),
    );
  }
  return targets;
}
