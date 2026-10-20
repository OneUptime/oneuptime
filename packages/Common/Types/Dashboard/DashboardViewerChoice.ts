/*
 * A dashboard setting each viewer may change for themselves, with a default
 * the dashboard keeps for everyone: its time range and its auto-refresh
 * interval (DashboardTimeRange.ts, DashboardAutoRefresh.ts), and any later
 * one of the same kind - a list widget's sort, say (issue #5082).
 *
 * Four places can say what such a setting is, and the first that says
 * anything it can read wins:
 *
 *   1. The link the page was opened with (?range=, ?refresh=): what a wall
 *      screen's address or a colleague's link names. It holds for that page
 *      and is never kept as the viewer's own pick.
 *   2. The viewer's own pick, which their browser remembers for that
 *      dashboard (Common/UI/Utils/DashboardViewerPicks.ts), so a refresh, a
 *      restart or a wall screen's reboot keeps it.
 *   3. The dashboard's own default, which its editors set on purpose in edit
 *      mode and save with it.
 *   4. What every dashboard had before the setting existed (the fallback),
 *      so a dashboard that names no default looks as it always has.
 *
 * Picking the setting's "Default (...)" choice forgets the viewer's own pick
 * and takes the link's away, so the dashboard's default decides again: a
 * screen never gets stuck on someone's old choice.
 *
 * React-free and browser-free: the dashboard, the public dashboard and their
 * tests read it.
 */

export enum DashboardSettingSource {
  // The link the page was opened with names it.
  Link = "Link",
  // The viewer picked it, and their browser remembers the pick.
  Viewer = "Viewer",
  // The dashboard's own default, saved with it.
  Dashboard = "Dashboard",
  // The dashboard names no default: what every dashboard had before.
  Fallback = "Fallback",
}

export interface DashboardSetting<T> {
  value: T;
  source: DashboardSettingSource;
}

/*
 * The setting a viewer sees, from the first of the four places that says
 * one. Each place is handed in already read: null (or undefined) where it
 * says nothing, or nothing it could read.
 */
export function resolveDashboardSetting<T>(data: {
  link?: T | null | undefined;
  viewerPick?: T | null | undefined;
  savedDefault?: T | null | undefined;
  fallback: T;
}): DashboardSetting<T> {
  if (data.link !== null && data.link !== undefined) {
    return { value: data.link, source: DashboardSettingSource.Link };
  }

  if (data.viewerPick !== null && data.viewerPick !== undefined) {
    return { value: data.viewerPick, source: DashboardSettingSource.Viewer };
  }

  if (data.savedDefault !== null && data.savedDefault !== undefined) {
    return {
      value: data.savedDefault,
      source: DashboardSettingSource.Dashboard,
    };
  }

  return { value: data.fallback, source: DashboardSettingSource.Fallback };
}

/*
 * Whether the viewer is on the dashboard's default - its own, or the
 * fallback when it names none - rather than on a choice of a link's or of
 * their own. The "Default (...)" choice of the setting's picker is the one
 * in use then.
 */
export function isDashboardDefaultSource(
  source: DashboardSettingSource,
): boolean {
  return (
    source === DashboardSettingSource.Dashboard ||
    source === DashboardSettingSource.Fallback
  );
}
