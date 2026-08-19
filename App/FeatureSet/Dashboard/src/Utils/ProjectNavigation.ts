export interface ProjectSelectionNavigationInput {
  /** The current route as a string (e.g. Navigation.getCurrentRoute().toString()). */
  currentRoute: string;
  /** The id of the project that was just selected. */
  selectedProjectId: string | undefined;
  /**
   * The id of the project App had in memory BEFORE this selection, or null on
   * a fresh boot (login / page reload / auto-select) where no project-scoped
   * page has rendered in this document yet. Deliberately NOT the persisted
   * localStorage project id — that survives reloads, and using it would turn
   * every fresh login back into a full document reload.
   */
  previousProjectId: string | null;
}

export interface ProjectSelectionNavigationDecision {
  /** Whether to navigate at all. False when the URL already carries this project. */
  shouldNavigate: boolean;
  /**
   * Whether the navigation must be a full document reload (forceNavigate).
   * Only true when switching between two DIFFERENT projects, where the reload
   * resets the state of mounted components still holding the old project's
   * data. A first selection in this document has no such stale state, so it
   * stays an in-app (SPA) navigation.
   */
  forceNavigate: boolean;
  /** The dashboard path to navigate to for this project. */
  routePath: string;
}

/**
 * Decide what should happen to the URL when a project is selected. Pure so the
 * select/switch matrix is unit-testable without a DOM or router:
 *
 * - URL already contains the project id → do nothing (deep-link reload case).
 * - First selection in this document (login/auto-select) → plain SPA navigate.
 * - Switching from one project to a different one → forceNavigate (full
 *   reload) to reset every mounted component that still holds the old
 *   project's state.
 * - Re-selecting the same project → SPA navigate (nothing stale to reset).
 */
export function getProjectSelectionNavigationDecision(
  input: ProjectSelectionNavigationInput,
): ProjectSelectionNavigationDecision {
  const projectId: string = input.selectedProjectId || "";
  const routePath: string = "/dashboard/" + projectId;

  // No usable id — navigating to /dashboard/undefined would be worse than staying put.
  if (!projectId) {
    return {
      shouldNavigate: false,
      forceNavigate: false,
      routePath: routePath,
    };
  }

  if (input.currentRoute.includes(projectId)) {
    return {
      shouldNavigate: false,
      forceNavigate: false,
      routePath: routePath,
    };
  }

  const isSwitchingBetweenProjects: boolean = Boolean(
    input.previousProjectId && input.previousProjectId !== projectId,
  );

  return {
    shouldNavigate: true,
    forceNavigate: isSwitchingBetweenProjects,
    routePath: routePath,
  };
}
