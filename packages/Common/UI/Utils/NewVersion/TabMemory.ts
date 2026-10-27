/*
 * What one browser tab remembers across its own reloads: when it last
 * reloaded for a part of the app that would not download, which new version
 * it already moved to, the place to scroll back to.
 *
 * sessionStorage first. It is per tab and outlives a reload, which is all
 * these need. A browser that blocks site data (every cookie blocked, some
 * private modes) throws on any access to it, though, and a tab that cannot
 * remember that it just reloaded reloads again, and again: a part that is
 * gone for good turned into a reload loop. window.name outlives a reload of
 * the tab too, and no setting blocks it, so it holds the same values when
 * sessionStorage cannot - but only when it is empty or already ours, so a
 * name something else gave the window is never overwritten.
 */

/*
 * Exported for the page a frontend draws before its app starts
 * (Common/Server/Views/Partials/EntryLoadFailure.ejs), which keeps its
 * reload the same way and cannot import this.
 */
export const WINDOW_NAME_PREFIX: string = "oneuptime-tab-memory:";

type MemoryValues = Record<string, string>;

const hasWindow: () => boolean = (): boolean => {
  return typeof window !== "undefined";
};

const readWindowName: () => MemoryValues | null = (): MemoryValues | null => {
  if (!hasWindow()) {
    return null;
  }

  const name: string = typeof window.name === "string" ? window.name : "";

  if (!name) {
    return {};
  }

  if (!name.startsWith(WINDOW_NAME_PREFIX)) {
    // Another script named this window: leave it alone.
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(name.slice(WINDOW_NAME_PREFIX.length));

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const values: MemoryValues = {};

    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (typeof value === "string") {
        values[key] = value;
      }
    }

    return values;
  } catch {
    return {};
  }
};

const writeWindowName: (values: MemoryValues) => void = (
  values: MemoryValues,
): void => {
  if (!hasWindow()) {
    return;
  }

  try {
    window.name =
      Object.keys(values).length === 0
        ? ""
        : `${WINDOW_NAME_PREFIX}${JSON.stringify(values)}`;
  } catch {
    // Nothing left to remember it in.
  }
};

export default class TabMemory {
  public static get(key: string): string | null {
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      const values: MemoryValues | null = readWindowName();
      return values?.[key] ?? null;
    }
  }

  public static set(key: string, value: string): void {
    try {
      window.sessionStorage.setItem(key, value);
      return;
    } catch {
      // Falls through to window.name.
    }

    const values: MemoryValues | null = readWindowName();

    if (!values) {
      return;
    }

    values[key] = value;
    writeWindowName(values);
  }

  public static remove(key: string): void {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // Falls through to window.name.
    }

    const values: MemoryValues | null = readWindowName();

    if (!values || !(key in values)) {
      return;
    }

    delete values[key];
    writeWindowName(values);
  }
}
