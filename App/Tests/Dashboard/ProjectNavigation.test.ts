import { describe, expect, test } from "@jest/globals";
import {
  ProjectSelectionNavigationDecision,
  getProjectSelectionNavigationDecision,
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
