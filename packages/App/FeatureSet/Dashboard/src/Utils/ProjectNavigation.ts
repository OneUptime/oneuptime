/*
 * Dashboard pages that live outside any project: the user profile pages, the
 * cross-project inboxes, project invitations, on-call policies and logout.
 * Their URLs carry no project id, so the `currentRoute.includes(projectId)`
 * test below can never be true for them -- which is exactly why selecting a
 * project used to throw the user off whichever of these pages they had just
 * deep-linked, bookmarked or reloaded, and onto the project home page.
 *
 * Written out rather than read from RouteMap so this module stays free of the
 * dashboard route graph and its browser-only dependencies, and so the
 * select/switch matrix remains testable without a DOM. ProjectNavigation.test
 * reads RouteMap's source and fails if a project-independent route is added
 * without being listed here, so the two cannot drift apart silently.
 *
 * /dashboard (INIT) and /dashboard/welcome (WELCOME) are deliberately absent.
 * They are the two routes whose whole purpose is to hand the user off into a
 * project: /dashboard is the post-login landing page, and /dashboard/welcome is
 * where a brand new project is created -- ProjectPicker calls onProjectSelected
 * with the freshly created project, and the navigation this helper returns is
 * what carries the user into it. Exempting either would strand the user on a
 * loader or a welcome screen.
 */
export const projectIndependentRoutes: Array<string> = [
  "/dashboard/user-profile/overview",
  "/dashboard/user-profile/password-management",
  "/dashboard/user-profile/passkeys",
  "/dashboard/user-profile/two-factor-auth",
  "/dashboard/user-profile/profile-picture",
  "/dashboard/user-profile/delete-account",
  "/dashboard/active-incidents",
  "/dashboard/active-alerts",
  "/dashboard/active-alert-episodes",
  "/dashboard/active-incident-episodes",
  "/dashboard/project-invitations",
  "/dashboard/my-on-call-policies",
  "/dashboard/logout",
];

/**
 * Whether the user is currently sitting on a page that belongs to no project,
 * and therefore should not be navigated away from just because a project got
 * selected underneath them. Tolerates a trailing slash, a query string and a
 * fragment, because this is matched against a live browser URL.
 */
export function isProjectIndependentRoute(currentRoute: string): boolean {
  const path: string = currentRoute
    .split("?")[0]!
    .split("#")[0]!
    .replace(/\/+$/, "");

  return projectIndependentRoutes.some((routePath: string): boolean => {
    return path === routePath || path.startsWith(routePath + "/");
  });
}

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
 * - URL belongs to no project at all (user profile, cross-project inboxes,
 *   invitations, on-call policies, logout) and this is not a switch between two
 *   projects → do nothing, so a deep link or reload of one of those pages is
 *   not bounced to the project home page.
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

  /*
   * The user is on a page that belongs to no project, so there is no project
   * id in the URL for the check above to match. Selecting a project on boot --
   * the auto-select that runs on every login, reload and deep link -- must not
   * bounce them off it. This is what made a reload of, say, the passkey
   * settings page land on the project home page instead.
   *
   * An actual switch between two projects still navigates: forceNavigate is
   * how a mounted page holding the old project's data gets reset, and these
   * pages are no exception.
   */
  if (
    !isSwitchingBetweenProjects &&
    isProjectIndependentRoute(input.currentRoute)
  ) {
    return {
      shouldNavigate: false,
      forceNavigate: false,
      routePath: routePath,
    };
  }

  return {
    shouldNavigate: true,
    forceNavigate: isSwitchingBetweenProjects,
    routePath: routePath,
  };
}
