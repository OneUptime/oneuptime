/**
 * Per-browser ring of dashboard config snapshots, keyed by dashboard id.
 *
 * Each Save records a snapshot here; the toolbar's "Version history" menu
 * lets the user pick a prior version and restore it. We keep snapshots
 * client-side because a robust server-side history requires a Postgres
 * migration we haven't shipped yet — this gets us "undo a bad save"
 * coverage today without touching the schema, and the API shape lines up
 * for a server-backed swap-in later.
 */

import DashboardViewConfig from "../../Types/Dashboard/DashboardViewConfig";

const STORAGE_PREFIX: string = "oneuptime.dashboard.history.";
const MAX_SNAPSHOTS: number = 20;

export interface DashboardSnapshot {
  savedAt: number; // ms epoch
  config: DashboardViewConfig;
}

const storageKey: (dashboardId: string) => string = (
  dashboardId: string,
): string => {
  return `${STORAGE_PREFIX}${dashboardId}`;
};

const isStorageAvailable: () => boolean = (): boolean => {
  try {
    return (
      typeof window !== "undefined" &&
      typeof window.localStorage !== "undefined"
    );
  } catch {
    return false;
  }
};

const safeRead: (key: string) => string | null = (
  key: string,
): string | null => {
  if (!isStorageAvailable()) {
    return null;
  }
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeWrite: (key: string, value: string) => void = (
  key: string,
  value: string,
): void => {
  if (!isStorageAvailable()) {
    return;
  }
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /*
     * Quota exceeded on a deeply-edited dashboard. Drop the oldest
     * snapshots in MAX_SNAPSHOTS and try once more — quota errors here
     * are most often "history outgrew the budget."
     */
    try {
      const trimmed: Array<DashboardSnapshot> = parseSnapshots(
        safeRead(key),
      ).slice(0, Math.max(MAX_SNAPSHOTS / 2, 1));
      window.localStorage.setItem(key, JSON.stringify(trimmed));
    } catch {
      /*
       * Storage genuinely unavailable — give up silently. History is a
       * best-effort feature, not load-bearing.
       */
    }
  }
};

const parseSnapshots: (raw: string | null) => Array<DashboardSnapshot> = (
  raw: string | null,
): Array<DashboardSnapshot> => {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((s: unknown): s is DashboardSnapshot => {
      const candidate: DashboardSnapshot | null = s as DashboardSnapshot | null;
      return (
        candidate !== null &&
        typeof candidate === "object" &&
        typeof candidate.savedAt === "number" &&
        candidate.config !== undefined &&
        candidate.config !== null
      );
    });
  } catch {
    return [];
  }
};

export default class DashboardVersionHistory {
  public static list(dashboardId: string): Array<DashboardSnapshot> {
    return parseSnapshots(safeRead(storageKey(dashboardId)));
  }

  public static record(dashboardId: string, config: DashboardViewConfig): void {
    if (!dashboardId) {
      return;
    }
    const existing: Array<DashboardSnapshot> = this.list(dashboardId);
    const next: Array<DashboardSnapshot> = [
      { savedAt: Date.now(), config },
      ...existing,
    ].slice(0, MAX_SNAPSHOTS);
    safeWrite(storageKey(dashboardId), JSON.stringify(next));
  }

  public static clear(dashboardId: string): void {
    safeWrite(storageKey(dashboardId), JSON.stringify([]));
  }
}
