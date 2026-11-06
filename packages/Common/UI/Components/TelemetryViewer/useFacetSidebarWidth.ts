import {
  getFacetSidebarWidthPreferenceKey,
  readFacetSidebarWidth,
} from "./FacetSidebarWidth";
import UserPreferences, {
  UserPreferenceType,
} from "../../../Utils/UserPreferences";
import User from "../../Utils/User";
import { useCallback, useEffect, useSyncExternalStore } from "react";

/*
 * The width a person gave the filters sidebar, remembered for them.
 *
 * In the browser (UserPreferences' FacetSidebarWidth), one entry per person,
 * where a table's column widths already are (useColumnWidths), and for the
 * same reasons: a width belongs to the screen it was set on (a sidebar made
 * wide on a large monitor would squeeze the list on a laptop, which keeps
 * its own); every explorer would otherwise wait for a read before it drew
 * its sidebar, or jump to the person's width after; and nothing needs to be
 * granted. Signing out clears the browser's entries (User.clear), so
 * whoever signs in next on a shared browser finds the sidebar as the
 * product draws it.
 *
 * One width for every explorer and every sidebar on the page: a width kept
 * in one is drawn by all of them at once, and by the same explorer open in
 * another tab, rather than each keeping its own until the page is opened
 * again.
 *
 * Every read and write is guarded: a browser that refuses storage (a
 * private window, a full or blocked one) still sizes the sidebar for as
 * long as the page is open.
 */

export interface UseFacetSidebarWidthResult {
  // The width a person gave the sidebar, or null: its own 14rem.
  width: number | null;
  // Keep a width - null gives the sidebar back its own.
  setWidth: (width: number | null) => void;
}

const getPersonId: () => string = (): string => {
  try {
    return User.getUserId()?.toString() || "";
  } catch {
    return "";
  }
};

// Where a person's width is stored, as the storage event names it.
export const getFacetSidebarWidthStorageKey: (preferenceKey: string) => string =
  (preferenceKey: string): string => {
    return `${UserPreferenceType.FacetSidebarWidth}.${preferenceKey}`;
  };

export const readStoredFacetSidebarWidth: (
  preferenceKey: string,
) => number | null = (preferenceKey: string): number | null => {
  try {
    return readFacetSidebarWidth(
      UserPreferences.getUserPreferenceByTypeAsNumber({
        key: preferenceKey,
        userPreferenceType: UserPreferenceType.FacetSidebarWidth,
      }),
    );
  } catch {
    return null;
  }
};

/*
 * Write a width down, or take it away (null). False when the browser
 * refused it: the width then holds only while the page is open.
 */
export const writeStoredFacetSidebarWidth: (
  preferenceKey: string,
  width: number | null,
) => boolean = (preferenceKey: string, width: number | null): boolean => {
  try {
    if (width === null) {
      UserPreferences.removeUserPreferenceByType({
        key: preferenceKey,
        userPreferenceType: UserPreferenceType.FacetSidebarWidth,
      });
      return true;
    }

    UserPreferences.saveUserPreferenceByTypeAsNumber({
      key: preferenceKey,
      userPreferenceType: UserPreferenceType.FacetSidebarWidth,
      value: width,
    });
    return true;
  } catch {
    return false;
  }
};

/*
 * The widths this page holds, by person: what was read or kept, so every
 * sidebar draws the same one, and a width the browser would not store still
 * holds until the page is left. Another tab's change reaches it through the
 * storage event.
 */
class FacetSidebarWidthMemory {
  private widths: Map<string, number | null> = new Map();
  private listeners: Set<() => void> = new Set();

  public get(preferenceKey: string): number | null {
    if (!this.widths.has(preferenceKey)) {
      this.widths.set(preferenceKey, readStoredFacetSidebarWidth(preferenceKey));
    }

    return this.widths.get(preferenceKey) ?? null;
  }

  public set(preferenceKey: string, width: number | null): void {
    const kept: number | null = width === null ? null : readFacetSidebarWidth(width);

    writeStoredFacetSidebarWidth(preferenceKey, kept);
    this.update(preferenceKey, kept);
  }

  // Read again from the browser: another tab kept a width.
  public reload(preferenceKey: string): void {
    this.update(preferenceKey, readStoredFacetSidebarWidth(preferenceKey));
  }

  // Everything forgotten: the next read is the browser's (tests, sign-out).
  public clear(): void {
    this.widths.clear();
    this.notify();
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);

    return (): void => {
      this.listeners.delete(listener);
    };
  }

  private update(preferenceKey: string, width: number | null): void {
    if (this.widths.has(preferenceKey) && this.widths.get(preferenceKey) === width) {
      return;
    }

    this.widths.set(preferenceKey, width);
    this.notify();
  }

  private notify(): void {
    for (const listener of Array.from(this.listeners)) {
      listener();
    }
  }
}

const memory: FacetSidebarWidthMemory = new FacetSidebarWidthMemory();

// Forget what this page holds, so the next read is the browser's.
export const forgetFacetSidebarWidths: () => void = (): void => {
  memory.clear();
};

const subscribe: (listener: () => void) => () => void = (
  listener: () => void,
): (() => void) => {
  return memory.subscribe(listener);
};

const useFacetSidebarWidth: () => UseFacetSidebarWidthResult =
  (): UseFacetSidebarWidthResult => {
    const preferenceKey: string = getFacetSidebarWidthPreferenceKey(
      getPersonId(),
    );

    const getSnapshot: () => number | null = useCallback((): number | null => {
      return memory.get(preferenceKey);
    }, [preferenceKey]);

    const width: number | null = useSyncExternalStore(
      subscribe,
      getSnapshot,
      getSnapshot,
    );

    // The same person's width kept in another tab is drawn here too.
    useEffect(() => {
      if (typeof window === "undefined") {
        return undefined;
      }

      const storageKey: string = getFacetSidebarWidthStorageKey(preferenceKey);

      const onStorage: (event: StorageEvent) => void = (
        event: StorageEvent,
      ): void => {
        // A key of null: the other tab cleared everything (signed out).
        if (event.key !== storageKey && event.key !== null) {
          return;
        }

        memory.reload(preferenceKey);
      };

      window.addEventListener("storage", onStorage);

      return () => {
        window.removeEventListener("storage", onStorage);
      };
    }, [preferenceKey]);

    const setWidth: (width: number | null) => void = useCallback(
      (next: number | null): void => {
        memory.set(preferenceKey, next);
      },
      [preferenceKey],
    );

    return {
      width: width,
      setWidth: setWidth,
    };
  };

export default useFacetSidebarWidth;
