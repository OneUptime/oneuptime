/*
 * A DASHBOARD SHOWN ALONE, OVER THE WHOLE WINDOW (#10409).
 *
 * Full Screen on a dashboard's toolbar, and Open in New Tab there and on the
 * Dashboards list, show the dashboard with nothing of OneUptime around it:
 * no header, no side menu, no breadcrumbs - its toolbar and its board, every
 * control of both still working. Which of the two a tab shows is its
 * address: ?view=full-screen, beside the dashboard's own range, refresh and
 * var-<name> (DashboardSettingsUrlState, VariableUrlState). So a tab opened
 * on it, a bookmark of it and a reload of it open the dashboard full screen,
 * and Exit Full Screen takes the parameter away again.
 *
 * Read leniently, as people type links - in any case, with spaces around it,
 * and spelled fullscreen or full_screen too - and written one way only.
 */

// The query parameter a dashboard's view is named in: ?view=full-screen.
export const DASHBOARD_VIEW_LINK_PARAMETER: string = "view";

// The view that shows the dashboard alone, over the whole window.
export const DASHBOARD_FULL_SCREEN_VIEW: string = "full-screen";

// How people write it: the hyphen, or none, or an underscore.
const FULL_SCREEN_SPELLINGS: ReadonlySet<string> = new Set<string>([
  "full-screen",
  "fullscreen",
  "full_screen",
]);

// Whether a value of the view parameter names the full-screen view.
export function isDashboardFullScreenView(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }

  return FULL_SCREEN_SPELLINGS.has(value.trim().toLowerCase());
}

// Whether a page's address names the full-screen view in its query string (location.search).
export function isDashboardFullScreenInSearch(search: string): boolean {
  try {
    return new URLSearchParams(search || "")
      .getAll(DASHBOARD_VIEW_LINK_PARAMETER)
      .some((value: string): boolean => {
        return isDashboardFullScreenView(value);
      });
  } catch {
    return false;
  }
}

/*
 * The query string with the full-screen view put in or taken out. Only the
 * view parameter is touched, and only when it names the full-screen view:
 * every other parameter stays where it was. Returned without its "?" -
 * empty when nothing is left.
 */
export function applyDashboardFullScreenToSearch(
  search: string,
  isFullScreen: boolean,
): string {
  const params: URLSearchParams = new URLSearchParams(search || "");
  const views: Array<string> = params.getAll(DASHBOARD_VIEW_LINK_PARAMETER);
  const otherViews: Array<string> = views.filter((value: string): boolean => {
    return !isDashboardFullScreenView(value);
  });

  if (isFullScreen) {
    params.set(DASHBOARD_VIEW_LINK_PARAMETER, DASHBOARD_FULL_SCREEN_VIEW);
    return params.toString();
  }

  if (otherViews.length === views.length) {
    return params.toString();
  }

  params.delete(DASHBOARD_VIEW_LINK_PARAMETER);

  for (const value of otherViews) {
    params.append(DASHBOARD_VIEW_LINK_PARAMETER, value);
  }

  return params.toString();
}

// The query a link opens a dashboard full screen with.
export function getDashboardFullScreenLinkQuery(): Record<string, string> {
  return { [DASHBOARD_VIEW_LINK_PARAMETER]: DASHBOARD_FULL_SCREEN_VIEW };
}

/*
 * The address with the full-screen view put in or taken out: its path, its
 * query as applyDashboardFullScreenToSearch leaves it, and its fragment.
 */
export function getDashboardFullScreenAddress(
  location: { pathname: string; search: string; hash?: string | undefined },
  isFullScreen: boolean,
): string {
  const search: string = applyDashboardFullScreenToSearch(
    location.search,
    isFullScreen,
  );

  return `${location.pathname}${search ? `?${search}` : ""}${
    location.hash || ""
  }`;
}
