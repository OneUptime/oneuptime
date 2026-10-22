import React from "react";

export enum Theme {
  Light = "light",
  Dark = "dark",
  System = "system",
}

export const THEME_STORAGE_KEY: string = "oneuptime-dashboard-theme";
export const THEME_CHANGE_EVENT: string = "oneuptime:theme-change";

const LIGHT_THEME_COLOR: string = "#f9fafb";
const DARK_THEME_COLOR: string = "#0f172a";

export default class ThemeUtil {
  private static hasStorageListener: boolean = false;
  private static hasMediaListener: boolean = false;

  public static getStoredTheme(): Theme {
    if (typeof window === "undefined") {
      return Theme.System;
    }

    try {
      const stored: string | null =
        window.localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === Theme.Dark) {
        return Theme.Dark;
      }
      if (stored === Theme.Light) {
        return Theme.Light;
      }
      // "system", missing, or any unrecognised value → follow OS.
      return Theme.System;
    } catch {
      return Theme.System;
    }
  }

  /**
   * Converts a stored Theme to the visual Light or Dark that should be
   * applied right now. System is resolved via prefers-color-scheme; Light and
   * Dark pass through unchanged.
   */
  public static resolveTheme(theme: Theme): Theme.Light | Theme.Dark {
    if (theme !== Theme.System) {
      return theme as Theme.Light | Theme.Dark;
    }

    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? Theme.Dark
        : Theme.Light;
    } catch {
      return Theme.Light;
    }
  }

  public static getAppliedTheme(): Theme {
    if (typeof document === "undefined") {
      return Theme.Light;
    }

    return document.documentElement.classList.contains(Theme.Dark)
      ? Theme.Dark
      : Theme.Light;
  }

  public static initialize(): void {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    ThemeUtil.applyTheme(ThemeUtil.getStoredTheme(), false);

    if (!ThemeUtil.hasStorageListener) {
      window.addEventListener("storage", (event: StorageEvent): void => {
        if (event.key !== THEME_STORAGE_KEY && event.key !== null) {
          return;
        }

        let theme: Theme;
        if (event.key === THEME_STORAGE_KEY) {
          if (event.newValue === Theme.Dark) {
            theme = Theme.Dark;
          } else if (event.newValue === Theme.Light) {
            theme = Theme.Light;
          } else {
            theme = Theme.System;
          }
        } else {
          // null key means the whole storage was cleared.
          theme = Theme.System;
        }

        ThemeUtil.applyTheme(theme);
      });
      ThemeUtil.hasStorageListener = true;
    }

    // Re-theme when the OS switches dark/light (e.g. auto dark-mode at sunset).
    if (!ThemeUtil.hasMediaListener) {
      try {
        const mq: MediaQueryList = window.matchMedia(
          "(prefers-color-scheme: dark)",
        );
        mq.addEventListener("change", (): void => {
          if (ThemeUtil.getStoredTheme() === Theme.System) {
            ThemeUtil.applyTheme(Theme.System);
          }
        });
        ThemeUtil.hasMediaListener = true;
      } catch {
        // matchMedia unavailable (jsdom, old browsers); ignore.
      }
    }
  }

  public static setTheme(theme: Theme): void {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, theme);
      } catch {
        // The visual theme still works when storage is unavailable.
      }
    }

    ThemeUtil.applyTheme(theme);
  }

  /** Cycles Light → Dark → System → Light. */
  public static toggleTheme(): Theme {
    const current: Theme = ThemeUtil.getStoredTheme();
    const next: Theme =
      current === Theme.Light
        ? Theme.Dark
        : current === Theme.Dark
          ? Theme.System
          : Theme.Light;
    ThemeUtil.setTheme(next);
    return next;
  }

  /*
   * Draws the document in a theme — the dark class, data-theme, the
   * color-scheme and the theme-color tag — and tells useTheme. System is
   * resolved to the OS preference before any class is toggled; data-theme
   * and color-scheme always hold the resolved (light | dark) value.
   */
  public static applyTheme(theme: Theme, notify: boolean = true): void {
    if (typeof document === "undefined") {
      return;
    }

    const resolved: Theme.Light | Theme.Dark = ThemeUtil.resolveTheme(theme);
    const isDark: boolean = resolved === Theme.Dark;
    const root: HTMLElement = document.documentElement;
    root.classList.toggle(Theme.Dark, isDark);
    root.dataset["theme"] = resolved;
    root.style.colorScheme = resolved;

    const themeColor: HTMLMetaElement | null = document.querySelector(
      'meta[name="theme-color"]:not([media])',
    );
    themeColor?.setAttribute(
      "content",
      isDark ? DARK_THEME_COLOR : LIGHT_THEME_COLOR,
    );

    if (notify && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(THEME_CHANGE_EVENT, {
          detail: { theme: resolved },
        }),
      );
    }
  }
}

const subscribeToTheme: (onStoreChange: () => void) => () => void = (
  onStoreChange: () => void,
): (() => void) => {
  if (typeof window === "undefined") {
    return (): void => {};
  }

  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange);
  return (): void => {
    window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange);
  };
};

/** Reactively reads the theme applied to the document root. */
export const useTheme: () => Theme = (): Theme => {
  return React.useSyncExternalStore(
    subscribeToTheme,
    ThemeUtil.getAppliedTheme,
    (): Theme => {
      return Theme.Light;
    },
  );
};
