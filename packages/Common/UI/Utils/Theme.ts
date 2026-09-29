import React from "react";

export enum Theme {
  Light = "light",
  Dark = "dark",
}

export const THEME_STORAGE_KEY: string = "oneuptime-dashboard-theme";
export const THEME_CHANGE_EVENT: string = "oneuptime:theme-change";

const LIGHT_THEME_COLOR: string = "#f9fafb";
const DARK_THEME_COLOR: string = "#0f172a";

/**
 * Owns the dashboard theme at the document boundary. The saved preference is
 * deliberately opt-in: a missing, invalid, or inaccessible value is light.
 */
export default class ThemeUtil {
  private static hasStorageListener: boolean = false;

  public static getStoredTheme(): Theme {
    if (typeof window === "undefined") {
      return Theme.Light;
    }

    try {
      return window.localStorage.getItem(THEME_STORAGE_KEY) === Theme.Dark
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

    if (ThemeUtil.hasStorageListener) {
      return;
    }

    window.addEventListener("storage", (event: StorageEvent): void => {
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) {
        return;
      }

      ThemeUtil.applyTheme(
        event.key === THEME_STORAGE_KEY && event.newValue === Theme.Dark
          ? Theme.Dark
          : Theme.Light,
      );
    });
    ThemeUtil.hasStorageListener = true;
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

  public static toggleTheme(): Theme {
    const theme: Theme =
      ThemeUtil.getAppliedTheme() === Theme.Dark ? Theme.Light : Theme.Dark;
    ThemeUtil.setTheme(theme);
    return theme;
  }

  private static applyTheme(theme: Theme, notify: boolean = true): void {
    if (typeof document === "undefined") {
      return;
    }

    const isDark: boolean = theme === Theme.Dark;
    const root: HTMLElement = document.documentElement;
    root.classList.toggle(Theme.Dark, isDark);
    root.dataset["theme"] = theme;
    root.style.colorScheme = theme;

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
          detail: { theme },
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
