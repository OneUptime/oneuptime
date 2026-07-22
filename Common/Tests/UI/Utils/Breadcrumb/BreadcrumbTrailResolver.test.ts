import { describe, expect, test } from "@jest/globals";
import realBreadcrumbTrails, {
  BreadcrumbTrailFixture,
} from "./fixtures/RealBreadcrumbTrails";
import rawRealRoutePatterns from "./fixtures/RealRoutePatterns";
import {
  BreadcrumbTarget,
  BreadcrumbTargetKind,
  normalizeRoutePath,
  resolveBreadcrumbTarget,
  resolveBreadcrumbTrail,
} from "../../../../UI/Utils/Breadcrumb/BreadcrumbTrailResolver";

/*
 * Callers pass only real, navigable route patterns — mount points that only
 * nest child routers ("/foo/*") are not pages. The Dashboard adapter filters
 * them out before calling the resolver; the tests mirror that contract.
 */
const REAL_ROUTES: Array<string> = rawRealRoutePatterns.filter(
  (pattern: string): boolean => {
    return !pattern.endsWith("/*");
  },
);

const REAL_ROUTE_SET: Set<string> = new Set(
  REAL_ROUTES.map(normalizeRoutePath),
);

const PROJECT: string = "/dashboard/:projectId";

/*
 * The concrete route pattern a resolved target points at, so we can assert it is
 * a real, navigable route.
 */
function resolvedPattern(
  target: BreadcrumbTarget,
  pagePattern: string,
): string {
  const segments: Array<string> = normalizeRoutePath(pagePattern).split("/");
  switch (target.kind) {
    case BreadcrumbTargetKind.Home:
      return segments.slice(0, target.depth ?? 3).join("/");
    case BreadcrumbTargetKind.Ancestor:
      return segments.slice(0, target.depth ?? 3).join("/");
    case BreadcrumbTargetKind.SectionLanding:
      return target.routePattern ?? "";
    case BreadcrumbTargetKind.CurrentPage:
    default:
      return normalizeRoutePath(pagePattern);
  }
}

// Home / Ancestor / SectionLanding render as links; CurrentPage renders as text.
function isLink(target: BreadcrumbTarget): boolean {
  return target.kind !== BreadcrumbTargetKind.CurrentPage;
}

function resolveOne(options: {
  index: number;
  crumbCount: number;
  pagePattern: string;
  realRoutePatterns?: Array<string>;
}): BreadcrumbTarget {
  return resolveBreadcrumbTarget({
    index: options.index,
    crumbCount: options.crumbCount,
    pagePattern: options.pagePattern,
    realRoutePatterns: options.realRoutePatterns ?? REAL_ROUTES,
  });
}

describe("BreadcrumbTrailResolver", () => {
  describe("normalizeRoutePath", () => {
    test("strips a single trailing slash", () => {
      expect(normalizeRoutePath("/dashboard/:projectId/settings/")).toBe(
        "/dashboard/:projectId/settings",
      );
    });

    test("strips repeated trailing slashes", () => {
      expect(normalizeRoutePath("/a/b///")).toBe("/a/b");
    });

    test("leaves a path without a trailing slash unchanged", () => {
      expect(normalizeRoutePath("/a/b")).toBe("/a/b");
    });

    test("keeps the root path intact", () => {
      expect(normalizeRoutePath("/")).toBe("/");
    });

    test("handles an empty string", () => {
      expect(normalizeRoutePath("")).toBe("");
    });
  });

  describe("crumb position rules", () => {
    test("the first crumb always links to the project home", () => {
      const target: BreadcrumbTarget = resolveOne({
        index: 0,
        crumbCount: 3,
        pagePattern: `${PROJECT}/user-settings/notification-methods`,
      });
      expect(target.kind).toBe(BreadcrumbTargetKind.Home);
      expect(target.depth).toBe(3);
      expect(resolvedPattern(target, `${PROJECT}/anything`)).toBe(PROJECT);
    });

    test("the last crumb is always the current page (plain text)", () => {
      const target: BreadcrumbTarget = resolveOne({
        index: 2,
        crumbCount: 3,
        pagePattern: `${PROJECT}/user-settings/notification-methods`,
      });
      expect(target.kind).toBe(BreadcrumbTargetKind.CurrentPage);
      expect(isLink(target)).toBe(false);
    });

    test("a two-crumb trail is home then current page", () => {
      const targets: Array<BreadcrumbTarget> = resolveBreadcrumbTrail({
        pagePattern: `${PROJECT}/monitors`,
        crumbCount: 2,
        realRoutePatterns: REAL_ROUTES,
      });
      expect(
        targets.map((t: BreadcrumbTarget) => {
          return t.kind;
        }),
      ).toEqual([BreadcrumbTargetKind.Home, BreadcrumbTargetKind.CurrentPage]);
    });
  });

  describe("intermediate crumb pointing at a real section list page", () => {
    test('"Traces" links to /traces on a /traces/settings/pipelines page', () => {
      const target: BreadcrumbTarget = resolveOne({
        index: 1,
        crumbCount: 4,
        pagePattern: `${PROJECT}/traces/settings/pipelines`,
      });
      expect(target.kind).toBe(BreadcrumbTargetKind.Ancestor);
      expect(
        resolvedPattern(target, `${PROJECT}/traces/settings/pipelines`),
      ).toBe(`${PROJECT}/traces`);
    });
  });

  describe("the reported bug: User Settings middle crumb", () => {
    const page: string = `${PROJECT}/user-settings/notification-methods`;

    test('"User Settings" never links to the bare /user-settings prefix', () => {
      const target: BreadcrumbTarget = resolveOne({
        index: 1,
        crumbCount: 3,
        pagePattern: page,
      });
      // The bare prefix has no page — that is exactly what blanked the dashboard.
      expect(resolvedPattern(target, page)).not.toBe(
        `${PROJECT}/user-settings`,
      );
    });

    test('"User Settings" is plain text on the User Settings landing page', () => {
      // notification-methods IS the section landing, so its own crumb is text.
      const target: BreadcrumbTarget = resolveOne({
        index: 1,
        crumbCount: 3,
        pagePattern: page,
      });
      expect(target.kind).toBe(BreadcrumbTargetKind.CurrentPage);
    });

    test('"User Settings" links to the landing page from a sibling settings page', () => {
      const target: BreadcrumbTarget = resolveOne({
        index: 1,
        crumbCount: 3,
        pagePattern: `${PROJECT}/user-settings/notification-settings`,
      });
      expect(target.kind).toBe(BreadcrumbTargetKind.SectionLanding);
      expect(target.routePattern).toBe(
        `${PROJECT}/user-settings/notification-methods`,
      );
      expect(REAL_ROUTE_SET.has(target.routePattern ?? "")).toBe(true);
    });
  });

  describe("bare section prefix with an off-path landing", () => {
    test('"On-Call Duty" links to /policies while viewing /schedules', () => {
      const target: BreadcrumbTarget = resolveOne({
        index: 1,
        crumbCount: 3,
        pagePattern: `${PROJECT}/on-call-duty/schedules`,
      });
      expect(target.kind).toBe(BreadcrumbTargetKind.SectionLanding);
      expect(target.routePattern).toBe(`${PROJECT}/on-call-duty/policies`);
    });

    test('"On-Call Duty" is plain text on the /policies landing page itself', () => {
      const target: BreadcrumbTarget = resolveOne({
        index: 1,
        crumbCount: 3,
        pagePattern: `${PROJECT}/on-call-duty/policies`,
      });
      expect(target.kind).toBe(BreadcrumbTargetKind.CurrentPage);
    });

    test('"Settings" links to a real settings tab on a /monitors/settings/probes page', () => {
      const target: BreadcrumbTarget = resolveOne({
        index: 2,
        crumbCount: 4,
        pagePattern: `${PROJECT}/monitors/settings/probes`,
      });
      // /monitors/settings has no page of its own; land on the first real tab.
      expect(target.kind).toBe(BreadcrumbTargetKind.SectionLanding);
      expect(target.routePattern).toBe(`${PROJECT}/monitors/settings/status`);
      expect(REAL_ROUTE_SET.has(target.routePattern ?? "")).toBe(true);
    });
  });

  describe("nearest real ancestor on the current path", () => {
    test('"Insights" links to /ai/insights on an /ai/insights/settings page', () => {
      const target: BreadcrumbTarget = resolveOne({
        index: 1,
        crumbCount: 3,
        pagePattern: `${PROJECT}/ai/insights/settings`,
      });
      expect(target.kind).toBe(BreadcrumbTargetKind.Ancestor);
      expect(resolvedPattern(target, `${PROJECT}/ai/insights/settings`)).toBe(
        `${PROJECT}/ai/insights`,
      );
    });

    test('"AI Tasks" links to /ai/agents on an /ai/agents/:id page', () => {
      const target: BreadcrumbTarget = resolveOne({
        index: 1,
        crumbCount: 3,
        pagePattern: `${PROJECT}/ai/agents/:id`,
      });
      expect(target.kind).toBe(BreadcrumbTargetKind.Ancestor);
      expect(resolvedPattern(target, `${PROJECT}/ai/agents/:id`)).toBe(
        `${PROJECT}/ai/agents`,
      );
    });
  });

  describe("leaf detail pages (the truncated-id bug)", () => {
    test('"Trace Details" is plain text, not a link to /traces/view', () => {
      const target: BreadcrumbTarget = resolveOne({
        index: 2,
        crumbCount: 3,
        pagePattern: `${PROJECT}/traces/view/:id`,
      });
      // The naive truncation would have produced the non-existent /traces/view.
      expect(target.kind).toBe(BreadcrumbTargetKind.CurrentPage);
    });

    test('"Traces" still links to /traces on a /traces/view/:id page', () => {
      const target: BreadcrumbTarget = resolveOne({
        index: 1,
        crumbCount: 3,
        pagePattern: `${PROJECT}/traces/view/:id`,
      });
      expect(target.kind).toBe(BreadcrumbTargetKind.Ancestor);
      expect(resolvedPattern(target, `${PROJECT}/traces/view/:id`)).toBe(
        `${PROJECT}/traces`,
      );
    });
  });

  describe("defensive fallbacks on synthetic route tables", () => {
    test("a prefix with no page at all resolves to plain text", () => {
      const target: BreadcrumbTarget = resolveOne({
        index: 1,
        crumbCount: 3,
        pagePattern: "/dashboard/:projectId/ghost/leaf",
        realRoutePatterns: ["/dashboard/:projectId/ghost/leaf"],
      });
      // Only the page itself exists; the "ghost" prefix has no landing.
      expect(target.kind).toBe(BreadcrumbTargetKind.CurrentPage);
    });

    test("trailing-slash-only page routes are matched after normalization", () => {
      const target: BreadcrumbTarget = resolveOne({
        index: 1,
        crumbCount: 3,
        pagePattern: "/dashboard/:projectId/section/leaf",
        realRoutePatterns: [
          "/dashboard/:projectId/section/", // real, only differs by trailing slash
          "/dashboard/:projectId/section/leaf",
        ],
      });
      expect(target.kind).toBe(BreadcrumbTargetKind.Ancestor);
      expect(
        resolvedPattern(target, "/dashboard/:projectId/section/leaf"),
      ).toBe("/dashboard/:projectId/section");
    });

    test("more titles than URL segments resolves to plain text, never a broken link", () => {
      const target: BreadcrumbTarget = resolveOne({
        index: 2,
        crumbCount: 5,
        pagePattern: "/dashboard/:projectId/short",
        realRoutePatterns: ["/dashboard/:projectId/short"],
      });
      expect(target.kind).toBe(BreadcrumbTargetKind.CurrentPage);
    });

    test("a packed trail crumb sharing the page's terminal segment stays plain text", () => {
      /*
       * Profiles Overview: "Project > Profiler > Overview" on /profiles, where
       * "Profiler" and "Overview" both map onto the single /profiles segment.
       * "Profiler" must not become a link to a sibling like /profiles/insights.
       */
      const target: BreadcrumbTarget = resolveOne({
        index: 1,
        crumbCount: 3,
        pagePattern: `${PROJECT}/profiles`,
        realRoutePatterns: [
          `${PROJECT}/profiles`,
          `${PROJECT}/profiles/insights`,
        ],
      });
      expect(target.kind).toBe(BreadcrumbTargetKind.CurrentPage);
    });

    test("a bare section prefix picks the first declared child as its landing", () => {
      const target: BreadcrumbTarget = resolveOne({
        index: 1,
        crumbCount: 3,
        pagePattern: "/dashboard/:projectId/sect/two",
        realRoutePatterns: [
          "/dashboard/:projectId/sect/one", // first declared -> landing
          "/dashboard/:projectId/sect/two",
        ],
      });
      expect(target.kind).toBe(BreadcrumbTargetKind.SectionLanding);
      expect(target.routePattern).toBe("/dashboard/:projectId/sect/one");
    });
  });

  /*
   * The core guarantee. For every real breadcrumb trail in the app, no crumb may
   * ever resolve to a route that does not exist — that is precisely the class of
   * bug that blanked the dashboard.
   */
  describe("invariant: no crumb links to a non-existent route (all real trails)", () => {
    test("the fixture covers a broad, representative set of the app's trails", () => {
      expect(realBreadcrumbTrails.length).toBeGreaterThan(400);
      const sections: Set<string> = new Set(
        realBreadcrumbTrails.map((trail: BreadcrumbTrailFixture): string => {
          return normalizeRoutePath(trail.pagePattern).split("/")[3] ?? "";
        }),
      );
      /*
       * Every top-level product section should be represented, including the
       * originally-reported user-settings section.
       */
      expect(sections.has("user-settings")).toBe(true);
      expect(sections.has("on-call-duty")).toBe(true);
      expect(sections.size).toBeGreaterThan(25);
    });

    test.each(
      realBreadcrumbTrails.map((trail: BreadcrumbTrailFixture) => {
        return [`${trail.getter} :: ${trail.pagePattern}`, trail] as [
          string,
          BreadcrumbTrailFixture,
        ];
      }),
    )("%s", (_label: string, trail: BreadcrumbTrailFixture) => {
      const targets: Array<BreadcrumbTarget> = resolveBreadcrumbTrail({
        pagePattern: trail.pagePattern,
        crumbCount: trail.titles.length,
        realRoutePatterns: REAL_ROUTES,
      });

      expect(targets).toHaveLength(trail.titles.length);

      // First crumb -> home; last crumb -> current page.
      expect(targets[0]?.kind).toBe(BreadcrumbTargetKind.Home);
      expect(targets[targets.length - 1]?.kind).toBe(
        BreadcrumbTargetKind.CurrentPage,
      );

      const normalizedPage: string = normalizeRoutePath(trail.pagePattern);

      targets.forEach((target: BreadcrumbTarget) => {
        if (!isLink(target)) {
          return;
        }
        const pattern: string = normalizeRoutePath(
          resolvedPattern(target, trail.pagePattern),
        );

        // A link must always resolve to a real, navigable route.
        expect(REAL_ROUTE_SET.has(pattern)).toBe(true);

        /*
         * An intermediate link must not point at the current page (that would be
         * rendered as plain text instead).
         */
        if (target.kind === BreadcrumbTargetKind.SectionLanding) {
          expect(pattern).not.toBe(normalizedPage);
        }
      });
    });

    test("no real trail produces a link to a bare, page-less section prefix", () => {
      const deadPrefixes: Array<string> = [
        `${PROJECT}/user-settings`,
        `${PROJECT}/on-call-duty`,
        `${PROJECT}/ai`,
        `${PROJECT}/llm`,
        `${PROJECT}/monitors/settings`,
        `${PROJECT}/incidents/settings`,
        `${PROJECT}/alerts/settings`,
        `${PROJECT}/traces/settings`,
        `${PROJECT}/traces/view`,
        `${PROJECT}/profiles/view`,
      ];

      // Sanity: these prefixes really are not routes.
      deadPrefixes.forEach((prefix: string) => {
        expect(REAL_ROUTE_SET.has(prefix)).toBe(false);
      });

      /*
       * Guard against a vacuous pass: every dead prefix must belong to a section
       * that the fixture actually exercises (has at least one trail underneath
       * it). Without this, a section silently dropping out of the fixture would
       * make its guarantee unreachable while the test still passed green.
       */
      deadPrefixes.forEach((prefix: string) => {
        const covered: boolean = realBreadcrumbTrails.some(
          (trail: BreadcrumbTrailFixture): boolean => {
            return normalizeRoutePath(trail.pagePattern).startsWith(
              `${prefix}/`,
            );
          },
        );
        expect(covered).toBe(true);
      });

      realBreadcrumbTrails.forEach((trail: BreadcrumbTrailFixture) => {
        const targets: Array<BreadcrumbTarget> = resolveBreadcrumbTrail({
          pagePattern: trail.pagePattern,
          crumbCount: trail.titles.length,
          realRoutePatterns: REAL_ROUTES,
        });
        targets.forEach((target: BreadcrumbTarget) => {
          if (!isLink(target)) {
            return;
          }
          const pattern: string = normalizeRoutePath(
            resolvedPattern(target, trail.pagePattern),
          );
          expect(deadPrefixes).not.toContain(pattern);
        });
      });
    });
  });
});
