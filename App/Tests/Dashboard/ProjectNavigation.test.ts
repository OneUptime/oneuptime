import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  ProjectSelectionNavigationDecision,
  getProjectSelectionNavigationDecision,
  isProjectIndependentRoute,
  projectIndependentRoutes,
} from "../../FeatureSet/Dashboard/src/Utils/ProjectNavigation";

/*
 * The select/switch matrix behind App.tsx's onProjectSelected. The perf report
 * found that EVERY fresh login triggered a full document reload
 * (forceNavigate = window.location.href) because the post-login URL never
 * contains the auto-selected project's id. The refined contract:
 *
 * - first selection in this document (login / reload / auto-select) -> plain
 *   SPA navigation, never a reload;
 * - switching between two DIFFERENT projects -> forceNavigate, preserving the
 *   state-reset semantics for components still holding the old project's data;
 * - URL already scoped to the selected project -> no navigation at all.
 */

const PROJECT_A: string = "6579a7b6c5d4e3f2a1b0c9d8";
const PROJECT_B: string = "70b8c9d0e1f2a3b4c5d6e7f8";

describe("getProjectSelectionNavigationDecision", () => {
  describe("fresh boot (no previously-selected project in memory)", () => {
    test("first selection after login navigates in-app, without a reload", () => {
      const decision: ProjectSelectionNavigationDecision =
        getProjectSelectionNavigationDecision({
          currentRoute: "/dashboard",
          selectedProjectId: PROJECT_A,
          previousProjectId: null,
        });

      expect(decision.shouldNavigate).toBe(true);
      expect(decision.forceNavigate).toBe(false);
      expect(decision.routePath).toBe("/dashboard/" + PROJECT_A);
    });

    test("auto-select stays SPA even when localStorage remembered a project, because previousProjectId is the in-memory id", () => {
      /*
       * ProjectPicker auto-selects the cached project on mount. The persisted
       * id survives reloads, so the caller must pass the IN-MEMORY previous
       * id (null on boot) — this case documents that a boot-time selection is
       * still a first selection.
       */
      const decision: ProjectSelectionNavigationDecision =
        getProjectSelectionNavigationDecision({
          currentRoute: "/dashboard",
          selectedProjectId: PROJECT_A,
          previousProjectId: null,
        });

      expect(decision.forceNavigate).toBe(false);
    });

    test("deep-link reload where the URL already carries the project id does not navigate", () => {
      const decision: ProjectSelectionNavigationDecision =
        getProjectSelectionNavigationDecision({
          currentRoute: "/dashboard/" + PROJECT_A + "/monitors",
          selectedProjectId: PROJECT_A,
          previousProjectId: null,
        });

      expect(decision.shouldNavigate).toBe(false);
      expect(decision.forceNavigate).toBe(false);
    });
  });

  describe("switching between two different projects", () => {
    test("forces a full navigation to reset stale per-project state", () => {
      const decision: ProjectSelectionNavigationDecision =
        getProjectSelectionNavigationDecision({
          currentRoute: "/dashboard/" + PROJECT_A + "/home",
          selectedProjectId: PROJECT_B,
          previousProjectId: PROJECT_A,
        });

      expect(decision.shouldNavigate).toBe(true);
      expect(decision.forceNavigate).toBe(true);
      expect(decision.routePath).toBe("/dashboard/" + PROJECT_B);
    });

    test("does not navigate when the URL already carries the NEW project id", () => {
      const decision: ProjectSelectionNavigationDecision =
        getProjectSelectionNavigationDecision({
          currentRoute: "/dashboard/" + PROJECT_B + "/home",
          selectedProjectId: PROJECT_B,
          previousProjectId: PROJECT_A,
        });

      expect(decision.shouldNavigate).toBe(false);
      expect(decision.forceNavigate).toBe(false);
    });
  });

  describe("re-selecting the project that is already selected", () => {
    test("navigates in-app when the URL lacks the id — nothing stale to reset", () => {
      const decision: ProjectSelectionNavigationDecision =
        getProjectSelectionNavigationDecision({
          currentRoute: "/dashboard",
          selectedProjectId: PROJECT_A,
          previousProjectId: PROJECT_A,
        });

      expect(decision.shouldNavigate).toBe(true);
      expect(decision.forceNavigate).toBe(false);
    });

    test("does nothing when the URL already carries the id", () => {
      const decision: ProjectSelectionNavigationDecision =
        getProjectSelectionNavigationDecision({
          currentRoute: "/dashboard/" + PROJECT_A + "/settings",
          selectedProjectId: PROJECT_A,
          previousProjectId: PROJECT_A,
        });

      expect(decision.shouldNavigate).toBe(false);
    });
  });

  /*
   * A dashboard page whose URL carries no project id at all. Selecting a
   * project on boot -- the auto-select that runs on every login, reload and
   * deep link -- used to navigate the user straight off these pages and onto
   * the project home page, because `currentRoute.includes(projectId)` can
   * never be true for a URL that has no project id in it. Reloading the
   * passkey settings page was how CI kept catching it: the Add Passkey button
   * mounted, then the redirect tore it out of the DOM mid-click.
   */
  describe("pages that belong to no project", () => {
    const PROJECT_INDEPENDENT_ROUTES: Array<string> = projectIndependentRoutes;

    test.each(PROJECT_INDEPENDENT_ROUTES)(
      "a boot-time selection leaves the user on %s",
      (currentRoute: string) => {
        const decision: ProjectSelectionNavigationDecision =
          getProjectSelectionNavigationDecision({
            currentRoute: currentRoute,
            selectedProjectId: PROJECT_A,
            previousProjectId: null,
          });

        expect(decision.shouldNavigate).toBe(false);
        expect(decision.forceNavigate).toBe(false);
      },
    );

    test.each(PROJECT_INDEPENDENT_ROUTES)(
      "%s is recognised as project-independent",
      (currentRoute: string) => {
        expect(isProjectIndependentRoute(currentRoute)).toBe(true);
      },
    );

    test("re-selecting the same project also leaves the user where they are", () => {
      const decision: ProjectSelectionNavigationDecision =
        getProjectSelectionNavigationDecision({
          currentRoute: "/dashboard/user-profile/two-factor-auth",
          selectedProjectId: PROJECT_A,
          previousProjectId: PROJECT_A,
        });

      expect(decision.shouldNavigate).toBe(false);
    });

    test("a trailing slash or query string does not defeat the match", () => {
      expect(
        isProjectIndependentRoute("/dashboard/user-profile/two-factor-auth/"),
      ).toBe(true);
      expect(
        isProjectIndependentRoute(
          "/dashboard/project-invitations?invite=abc123",
        ),
      ).toBe(true);
    });

    /*
     * The state-reset semantics of a real project switch are unchanged. A page
     * still mounted with the old project's data has to be torn down, and these
     * pages get no exemption from that.
     */
    test("switching between two projects still forces a full navigation", () => {
      const decision: ProjectSelectionNavigationDecision =
        getProjectSelectionNavigationDecision({
          currentRoute: "/dashboard/my-on-call-policies",
          selectedProjectId: PROJECT_B,
          previousProjectId: PROJECT_A,
        });

      expect(decision.shouldNavigate).toBe(true);
      expect(decision.forceNavigate).toBe(true);
      expect(decision.routePath).toBe("/dashboard/" + PROJECT_B);
    });
  });

  /*
   * The two routes that exist to hand the user off into a project. /dashboard
   * is the post-login landing page, and /dashboard/welcome is where a new
   * project is created -- ProjectPicker calls onProjectSelected with the
   * freshly created project and this navigation is what carries the user into
   * it. Exempting either would strand the user on a loader or a welcome
   * screen.
   */
  describe("bootstrap routes still hand off to the project", () => {
    test.each(["/dashboard", "/dashboard/welcome"])(
      "%s navigates on a boot-time selection",
      (currentRoute: string) => {
        const decision: ProjectSelectionNavigationDecision =
          getProjectSelectionNavigationDecision({
            currentRoute: currentRoute,
            selectedProjectId: PROJECT_A,
            previousProjectId: null,
          });

        expect(decision.shouldNavigate).toBe(true);
        expect(decision.routePath).toBe("/dashboard/" + PROJECT_A);
      },
    );

    test.each(["/dashboard", "/dashboard/welcome"])(
      "%s is not treated as project-independent",
      (currentRoute: string) => {
        expect(isProjectIndependentRoute(currentRoute)).toBe(false);
      },
    );
  });

  describe("degenerate inputs", () => {
    test("a missing project id never navigates — /dashboard/undefined would be worse than staying put", () => {
      const decision: ProjectSelectionNavigationDecision =
        getProjectSelectionNavigationDecision({
          currentRoute: "/dashboard",
          selectedProjectId: undefined,
          previousProjectId: null,
        });

      expect(decision.shouldNavigate).toBe(false);
      expect(decision.forceNavigate).toBe(false);
    });

    test("an empty-string project id never navigates either", () => {
      const decision: ProjectSelectionNavigationDecision =
        getProjectSelectionNavigationDecision({
          currentRoute: "/dashboard",
          selectedProjectId: "",
          previousProjectId: PROJECT_A,
        });

      expect(decision.shouldNavigate).toBe(false);
      expect(decision.forceNavigate).toBe(false);
    });

    test("an empty-string previous id counts as a fresh boot, not a switch", () => {
      const decision: ProjectSelectionNavigationDecision =
        getProjectSelectionNavigationDecision({
          currentRoute: "/dashboard",
          selectedProjectId: PROJECT_A,
          previousProjectId: "",
        });

      expect(decision.shouldNavigate).toBe(true);
      expect(decision.forceNavigate).toBe(false);
    });
  });
});

/*
 * ProjectNavigation deliberately does not import RouteMap: it must stay free of
 * the dashboard route graph and its browser-only dependencies so the
 * select/switch matrix is testable without a DOM. That leaves its list of
 * project-independent routes able to fall behind RouteMap, so read RouteMap's
 * source and compare the two.
 *
 * A route is project-independent when its path never interpolates
 * RouteParams.ProjectID. INIT and WELCOME are the two documented exceptions --
 * they exist to hand the user off into a project, so the helper must keep
 * navigating there.
 */
describe("the project-independent route list tracks RouteMap", () => {
  const HANDOFF_PAGES: Array<string> = ["INIT", "WELCOME"];

  const ROUTE_MAP_SOURCE: string = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "FeatureSet",
      "Dashboard",
      "src",
      "Utils",
      "RouteMap.ts",
    ),
    "utf8",
  );

  type RouteMapEntry = { page: string; routePath: string };

  function routeMapEntries(): Array<RouteMapEntry> {
    const pattern: RegExp =
      /\[PageMap\.([A-Z0-9_]+)\]:\s*new Route\(\s*`([^`]*)`/g;
    const entries: Array<RouteMapEntry> = [];
    let match: RegExpExecArray | null = pattern.exec(ROUTE_MAP_SOURCE);

    while (match) {
      entries.push({
        page: match[1] as string,
        routePath: (match[2] as string).replace(/\s+/g, ""),
      });
      match = pattern.exec(ROUTE_MAP_SOURCE);
    }

    return entries;
  }

  const entries: Array<RouteMapEntry> = routeMapEntries();

  test("RouteMap parses into a realistic number of routes", () => {
    // Guards the assertions below against the pattern silently matching nothing.
    expect(entries.length).toBeGreaterThanOrEqual(500);
  });

  test("every project-independent route in RouteMap is covered", () => {
    const uncovered: Array<string> = entries
      .filter((entry: RouteMapEntry): boolean => {
        return (
          !entry.routePath.includes("RouteParams.ProjectID") &&
          !HANDOFF_PAGES.includes(entry.page)
        );
      })
      .map((entry: RouteMapEntry): string => {
        return entry.routePath;
      })
      .filter((routePath: string): boolean => {
        return !isProjectIndependentRoute(routePath);
      });

    expect(uncovered).toEqual([]);
  });

  test("nothing in the list is actually a project-scoped route", () => {
    const projectScopedPaths: Array<string> = entries
      .filter((entry: RouteMapEntry): boolean => {
        return entry.routePath.includes("RouteParams.ProjectID");
      })
      .map((entry: RouteMapEntry): string => {
        return entry.routePath;
      });

    for (const routePath of projectScopedPaths) {
      expect(isProjectIndependentRoute(routePath)).toBe(false);
    }
  });

  test("the two handoff routes are excluded on purpose, not by accident", () => {
    const handoffPaths: Array<string> = entries
      .filter((entry: RouteMapEntry): boolean => {
        return HANDOFF_PAGES.includes(entry.page);
      })
      .map((entry: RouteMapEntry): string => {
        return entry.routePath;
      });

    expect(handoffPaths).toHaveLength(HANDOFF_PAGES.length);
    for (const routePath of handoffPaths) {
      expect(isProjectIndependentRoute(routePath)).toBe(false);
    }
  });
});
