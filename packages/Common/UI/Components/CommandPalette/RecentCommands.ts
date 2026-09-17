/*
 * Recently-run palette commands, persisted as an array of command ids in
 * localStorage. Same guarded read/write shape as the navbar's recent products
 * (NavBarMenuModal): storage can be absent (SSR), locked (private mode), or
 * hold garbage — every failure mode degrades to "no recents", never a throw.
 */

export const RECENT_COMMANDS_LIMIT: number = 7;

export const readRecentCommandIds: (storageKey: string) => Array<string> = (
  storageKey: string,
): Array<string> => {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return [];
    }
    const raw: string | null = window.localStorage.getItem(storageKey);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((value: unknown): value is string => {
        return typeof value === "string";
      })
      .slice(0, RECENT_COMMANDS_LIMIT);
  } catch {
    // Ignore storage access / parse errors (e.g. private mode, bad JSON).
    return [];
  }
};

export const writeRecentCommandId: (
  storageKey: string,
  commandId: string,
) => void = (storageKey: string, commandId: string): void => {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }
    const existing: Array<string> = readRecentCommandIds(storageKey).filter(
      (id: string) => {
        return id !== commandId;
      },
    );
    const next: Array<string> = [commandId, ...existing].slice(
      0,
      RECENT_COMMANDS_LIMIT,
    );
    window.localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    // Ignore storage write errors (e.g. private mode, quota exceeded).
  }
};
