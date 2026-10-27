import ObjectID from "../ObjectID";

/*
 * A dashboard playlist (issue #5235): dashboards shown one after another,
 * each for the same time, on a screen nobody touches - a NOC wall, a team's
 * TV. The playlist names its dashboards in order and says how long each is
 * shown; the player (Dashboard: Pages/Dashboards/Playlists) does the rest.
 *
 * Its dashboards are kept as one ordered list on the playlist, in its
 * `dashboards` column: [{"dashboardId": "<id>"}, ...]. One list, because a
 * playlist is an order - moving, adding and removing one is one write, and
 * an API or Terraform user writes the whole order in one value. An entry
 * is an object rather than a bare id so that a later setting of its own
 * has a place to go without a new shape.
 *
 * The list holds ids, never copies: who may see a dashboard is the
 * dashboard's business. The player reads the dashboards of the list as the
 * viewer (only those they may read, and none that is archived), so a
 * dashboard deleted, archived or out of the viewer's reach is skipped, and
 * an id stays harmless however it got there. The same dashboard may appear
 * more than once: an overview between every other one, say.
 *
 * React-free and browser-free: the API, the Dashboard and their tests read
 * it.
 */

export interface DashboardPlaylistDashboard {
  dashboardId: string;
}

// The one key an entry of the list has.
export const DASHBOARD_PLAYLIST_DASHBOARD_ID_FIELD: string = "dashboardId";

// More than any wall shows in a rotation, and few enough to read at once.
export const DASHBOARD_PLAYLIST_MAX_DASHBOARDS: number = 100;

/*
 * How long each dashboard is shown, in seconds. Below ten seconds a
 * dashboard is gone before its widgets have read their data; a day is more
 * than any rotation needs.
 */
export const DASHBOARD_PLAYLIST_MIN_INTERVAL_IN_SECONDS: number = 10;
export const DASHBOARD_PLAYLIST_MAX_INTERVAL_IN_SECONDS: number = 24 * 60 * 60;

// What a new playlist shows each dashboard for: a minute.
export const DASHBOARD_PLAYLIST_DEFAULT_INTERVAL_IN_SECONDS: number = 60;

/*
 * The times the playlist form offers, shortest first. The API takes any
 * whole number of seconds between the minimum and the maximum; a playlist
 * saved with one that is not offered here shows it as an extra choice.
 */
export const DASHBOARD_PLAYLIST_INTERVAL_CHOICES_IN_SECONDS: ReadonlyArray<number> =
  [15, 30, 60, 120, 300, 600, 900, 1800, 3600];

export const DASHBOARD_PLAYLIST_DASHBOARDS_SHAPE_PROBLEM: string =
  'Dashboards must be a list like [{"dashboardId": "<dashboard id>"}], in the order they are shown.';

export const DASHBOARD_PLAYLIST_TOO_MANY_DASHBOARDS_PROBLEM: string = `A playlist can show at most ${DASHBOARD_PLAYLIST_MAX_DASHBOARDS} dashboards.`;

export const DASHBOARD_PLAYLIST_INTERVAL_PROBLEM: string = `Interval must be a whole number of seconds, from ${DASHBOARD_PLAYLIST_MIN_INTERVAL_IN_SECONDS} to ${DASHBOARD_PLAYLIST_MAX_INTERVAL_IN_SECONDS} (a day).`;

/*
 * Why entry `index` (0-based) of the list cannot be saved: it is no object
 * with a dashboard's id alone.
 */
export function getDashboardPlaylistEntryProblem(index: number): string {
  return `Dashboard ${index + 1} of the list must be {"dashboardId": "<dashboard id>"}, with a dashboard's id.`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/*
 * A value as the list it holds: a list as is, JSON text as the list it
 * spells (a form or an API client may send the column as text), nothing as
 * an empty list. Null for anything else.
 */
function asList(value: unknown): Array<unknown> | null {
  if (value === undefined || value === null) {
    return [];
  }

  if (typeof value === "string") {
    if (value.trim() === "") {
      return [];
    }

    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  return Array.isArray(value) ? value : null;
}

// The dashboard id an entry names, or null when it is not an entry.
function readEntryDashboardId(entry: unknown): string | null {
  if (!isPlainObject(entry)) {
    return null;
  }

  const dashboardId: unknown = entry[DASHBOARD_PLAYLIST_DASHBOARD_ID_FIELD];

  if (typeof dashboardId !== "string" || !ObjectID.isValidUUID(dashboardId)) {
    return null;
  }

  return dashboardId;
}

/*
 * The playlist's dashboards as stored, in order, for reading: whatever the
 * column holds, every entry that names a dashboard, at most
 * DASHBOARD_PLAYLIST_MAX_DASHBOARDS. Anything else is left out without a
 * word - a reader never fails on a value it did not write.
 */
export function readDashboardPlaylistDashboards(
  value: unknown,
): Array<DashboardPlaylistDashboard> {
  const list: Array<unknown> | null = asList(value);

  if (!list) {
    return [];
  }

  const dashboards: Array<DashboardPlaylistDashboard> = [];

  for (const entry of list) {
    const dashboardId: string | null = readEntryDashboardId(entry);

    if (dashboardId) {
      dashboards.push({ dashboardId: dashboardId });
    }

    if (dashboards.length >= DASHBOARD_PLAYLIST_MAX_DASHBOARDS) {
      break;
    }
  }

  return dashboards;
}

/*
 * Why a write's `dashboards` cannot be saved, or null when it can: a list
 * (or its JSON text) of at most DASHBOARD_PLAYLIST_MAX_DASHBOARDS entries,
 * each {"dashboardId": "<id>"} and nothing else, or nothing at all, which
 * is an empty playlist. Strict where reading is lenient: an API or
 * Terraform user hears at once what a reader would have skipped.
 */
export function getDashboardPlaylistDashboardsProblem(
  value: unknown,
): string | null {
  const list: Array<unknown> | null = asList(value);

  if (!list) {
    return DASHBOARD_PLAYLIST_DASHBOARDS_SHAPE_PROBLEM;
  }

  if (list.length > DASHBOARD_PLAYLIST_MAX_DASHBOARDS) {
    return DASHBOARD_PLAYLIST_TOO_MANY_DASHBOARDS_PROBLEM;
  }

  for (let index: number = 0; index < list.length; index++) {
    const entry: unknown = list[index];

    if (
      !readEntryDashboardId(entry) ||
      Object.keys(entry as Record<string, unknown>).length !== 1
    ) {
      return getDashboardPlaylistEntryProblem(index);
    }
  }

  return null;
}

/*
 * The list a write stores: the entries it was checked for, as a list
 * (JSON text is stored as the list it spells, nothing as an empty list).
 * Call it only once getDashboardPlaylistDashboardsProblem found none.
 */
export function toStoredDashboardPlaylistDashboards(
  value: unknown,
): Array<DashboardPlaylistDashboard> {
  return readDashboardPlaylistDashboards(value);
}

// Whether a number is a time a playlist may show each dashboard for.
export function isDashboardPlaylistIntervalInSeconds(value: unknown): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= DASHBOARD_PLAYLIST_MIN_INTERVAL_IN_SECONDS &&
    value <= DASHBOARD_PLAYLIST_MAX_INTERVAL_IN_SECONDS
  );
}

/*
 * Why a write's `intervalInSeconds` cannot be saved, or null when it can:
 * a whole number of seconds from the minimum to the maximum, or nothing,
 * which keeps what is stored (a create stores the default).
 */
export function getDashboardPlaylistIntervalProblem(
  value: unknown,
): string | null {
  if (value === undefined) {
    return null;
  }

  return isDashboardPlaylistIntervalInSeconds(value)
    ? null
    : DASHBOARD_PLAYLIST_INTERVAL_PROBLEM;
}

/*
 * How long the player shows each dashboard, in seconds, from what is
 * stored: the stored time, held to the minimum and the maximum, else the
 * default.
 */
export function readDashboardPlaylistIntervalInSeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DASHBOARD_PLAYLIST_DEFAULT_INTERVAL_IN_SECONDS;
  }

  return Math.min(
    DASHBOARD_PLAYLIST_MAX_INTERVAL_IN_SECONDS,
    Math.max(DASHBOARD_PLAYLIST_MIN_INTERVAL_IN_SECONDS, Math.round(value)),
  );
}

/*
 * The intervals the form offers: the choices, and the playlist's own time
 * when it is none of them (set through the API), in order.
 */
export function getDashboardPlaylistIntervalChoices(
  currentIntervalInSeconds?: number | null | undefined,
): Array<number> {
  const choices: Array<number> = [
    ...DASHBOARD_PLAYLIST_INTERVAL_CHOICES_IN_SECONDS,
  ];

  if (
    currentIntervalInSeconds !== undefined &&
    currentIntervalInSeconds !== null &&
    isDashboardPlaylistIntervalInSeconds(currentIntervalInSeconds) &&
    !choices.includes(currentIntervalInSeconds)
  ) {
    choices.push(currentIntervalInSeconds);
    choices.sort((a: number, b: number): number => {
      return a - b;
    });
  }

  return choices;
}

/*
 * Whether two ids name the same dashboard: ids are compared as the API
 * compares them, without regard to case.
 */
export function isSameDashboardId(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
