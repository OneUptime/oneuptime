/**
 * Per-browser dashboard preferences — favorites and recently-viewed.
 *
 * Lives in localStorage so we don't pay the cost of a Postgres schema
 * change for what is fundamentally a personalization layer. The trade-off
 * is that it doesn't sync across devices; that's acceptable for v1 and
 * upgradable to a server-side store later without changing the call sites.
 */

const FAVORITES_KEY: string = "oneuptime.dashboard.favorites";
const RECENT_KEY: string = "oneuptime.dashboard.recent";
const MAX_RECENT: number = 10;

interface RecentEntry {
  id: string;
  name: string;
  visitedAt: number; // ms epoch
}

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
     * Quota exceeded or storage disabled — silently drop. This layer is
     * a UX nicety, not a correctness requirement.
     */
  }
};

const parseStringArray: (raw: string | null) => Array<string> = (
  raw: string | null,
): Array<string> => {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.every((s: unknown) => {
        return typeof s === "string";
      })
    ) {
      return parsed as Array<string>;
    }
    return [];
  } catch {
    return [];
  }
};

const parseRecentArray: (raw: string | null) => Array<RecentEntry> = (
  raw: string | null,
): Array<RecentEntry> => {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((e: unknown): e is RecentEntry => {
      const candidate: RecentEntry | null = e as RecentEntry | null;
      return (
        candidate !== null &&
        typeof candidate === "object" &&
        typeof candidate.id === "string" &&
        typeof candidate.name === "string" &&
        typeof candidate.visitedAt === "number"
      );
    });
  } catch {
    return [];
  }
};

export default class DashboardLocalPreferences {
  public static getFavorites(): Array<string> {
    return parseStringArray(safeRead(FAVORITES_KEY));
  }

  public static isFavorite(dashboardId: string): boolean {
    return this.getFavorites().includes(dashboardId);
  }

  public static toggleFavorite(dashboardId: string): boolean {
    const current: Array<string> = this.getFavorites();
    let next: Array<string>;
    let isNowFavorite: boolean;
    if (current.includes(dashboardId)) {
      next = current.filter((id: string) => {
        return id !== dashboardId;
      });
      isNowFavorite = false;
    } else {
      next = [...current, dashboardId];
      isNowFavorite = true;
    }
    safeWrite(FAVORITES_KEY, JSON.stringify(next));
    return isNowFavorite;
  }

  public static getRecent(): Array<RecentEntry> {
    return parseRecentArray(safeRead(RECENT_KEY));
  }

  public static recordVisit(dashboardId: string, name: string): void {
    if (!dashboardId) {
      return;
    }
    const current: Array<RecentEntry> = this.getRecent();
    // Drop any prior entry for this id, prepend a fresh one, cap length.
    const filtered: Array<RecentEntry> = current.filter((e: RecentEntry) => {
      return e.id !== dashboardId;
    });
    const next: Array<RecentEntry> = [
      { id: dashboardId, name, visitedAt: Date.now() },
      ...filtered,
    ].slice(0, MAX_RECENT);
    safeWrite(RECENT_KEY, JSON.stringify(next));
  }

  public static clearRecent(): void {
    safeWrite(RECENT_KEY, JSON.stringify([]));
  }
}

export type { RecentEntry };
