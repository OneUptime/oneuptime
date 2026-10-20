/*
 * A choice a person made that their browser keeps for them, with a way back:
 * a public dashboard visitor's light or dark pick (PublicDashboard
 * Utils/DashboardTheme.ts), a viewer's time range and auto-refresh on a
 * dashboard (DashboardViewerPicks.ts), and whatever later setting is kept the
 * same way. Forgetting a choice is the way back: the page's own default
 * decides again.
 *
 * The browser's storage can refuse: a private window, site data blocked or
 * cleared, a full quota, a sandboxed frame. Nothing here throws then. A
 * choice the browser would not keep is held for as long as the page is open
 * instead, so the pick still works until the page is left; one the browser
 * did keep is read from it every time, so a pick made in another tab of the
 * same address counts.
 *
 * Values are text: each caller writes its own and reads it back through its
 * own parser, so a value an older or newer version wrote, or a person typed
 * into the browser's tools, is read as no choice rather than trusted.
 *
 * React-free: the public dashboard's first script, its app and the
 * dashboard's own shell read it, and so do App's tests.
 */

/*
 * Choices the browser refused to keep, held for the page's life. Only those:
 * a choice the browser kept is read from it, never from here.
 */
const heldForThisPage: Map<string, string> = new Map<string, string>();

function getStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage || null;
  } catch {
    // Reading localStorage itself throws where site data is blocked.
    return null;
  }
}

export default class RememberedChoice {
  // What the browser keeps under the key, or null for no choice.
  public static read(key: string): string | null {
    if (heldForThisPage.has(key)) {
      return heldForThisPage.get(key) ?? null;
    }

    const storage: Storage | null = getStorage();

    if (!storage) {
      return null;
    }

    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  }

  /*
   * Keeps a choice. Returns whether the browser kept it; when it did not,
   * the choice still holds while the page is open.
   */
  public static remember(key: string, value: string): boolean {
    const storage: Storage | null = getStorage();

    try {
      if (!storage) {
        throw new Error("This browser keeps nothing for the page.");
      }

      storage.setItem(key, value);
      heldForThisPage.delete(key);
      return true;
    } catch {
      heldForThisPage.set(key, value);
      return false;
    }
  }

  // Forgets a choice: the way back to the page's own default.
  public static forget(key: string): void {
    heldForThisPage.delete(key);

    const storage: Storage | null = getStorage();

    if (!storage) {
      return;
    }

    try {
      storage.removeItem(key);
    } catch {
      // Nothing was kept that the page could still read.
    }
  }

  /*
   * Tells onChange when another tab of this address changes the choice - or
   * clears everything the browser keeps for it. Returns the unsubscribe.
   */
  public static subscribe(key: string, onChange: () => void): () => void {
    if (typeof window === "undefined") {
      return (): void => {};
    }

    const onStorage: (event: StorageEvent) => void = (
      event: StorageEvent,
    ): void => {
      if (event.key === key || event.key === null) {
        onChange();
      }
    };

    window.addEventListener("storage", onStorage);

    return (): void => {
      window.removeEventListener("storage", onStorage);
    };
  }

  // For tests: forget what the page held because the browser would not.
  public static clearHeldForThisPage(): void {
    heldForThisPage.clear();
  }
}
