import {
  DARK_COLOR_SCHEME_MEDIA_QUERY,
  THEME_COLORS,
  THEME_STORAGE_KEY,
  Theme,
  ThemePreference,
  doesThemePreferenceFollowDevice,
  getThemeForPreference,
  parseThemePreference,
} from "../../Types/Theme/ThemePreference";
import RememberedChoice from "./RememberedChoice";
import React from "react";

export {
  DARK_COLOR_SCHEME_MEDIA_QUERY,
  THEME_STORAGE_KEY,
  Theme,
  ThemePreference,
};

export const THEME_CHANGE_EVENT: string = "oneuptime:theme-change";

/*
 * A person's theme in the pages that are their own - the Dashboard, the
 * Admin Dashboard and the sign-in pages (Common/Types/Theme/
 * ThemePreference.ts): Light, Dark or System, kept in their browser, and a
 * browser where nobody picked follows the device.
 *
 * The first script in the page's <head> (Common/Server/Views/Partials/
 * Theme.ejs) has drawn the page in that theme before the first paint. This
 * keeps it there:
 *
 *   - initialize(), as the app starts, draws it again and follows what can
 *     change it while the page is open: the device (for System), and a pick
 *     made in another tab of this address.
 *   - setPreference() is the person's pick, from the user menu: kept in their
 *     browser (or, where the browser keeps nothing, for as long as the page
 *     is open) and drawn at once.
 *   - applyTheme() draws the page in a theme without keeping anything: a
 *     status page and a public dashboard draw the theme their owner set
 *     (StatusPage/src/Utils/StatusPageTheme.ts, PublicDashboard/src/Utils/
 *     DashboardTheme.ts), which is not the person's to remember.
 */

export interface ThemeInitializeOptions {
  /*
   * Whether the page open now is drawn light whatever the person picked,
   * asked again whenever the theme is drawn: a public form is its owner's
   * page, and light (Accounts' AccountsTheme.ts).
   */
  isAlwaysLight?: (() => boolean) | undefined;
}

const neverAlwaysLight: () => boolean = (): boolean => {
  return false;
};

export default class ThemeUtil {
  private static isFollowingChanges: boolean = false;
  private static isAlwaysLight: () => boolean = neverAlwaysLight;

  // What the person picked on this browser: System when nothing was.
  public static getPreference(): ThemePreference {
    return parseThemePreference(RememberedChoice.read(THEME_STORAGE_KEY));
  }

  // Whether the device asks for a dark page.
  public static doesDevicePreferDark(): boolean {
    if (typeof window === "undefined" || !window.matchMedia) {
      return false;
    }

    try {
      return window.matchMedia(DARK_COLOR_SCHEME_MEDIA_QUERY).matches;
    } catch {
      return false;
    }
  }

  // The theme the person's pick draws a page in, on this device, now.
  public static getPreferredTheme(): Theme {
    return getThemeForPreference({
      preference: ThemeUtil.getPreference(),
      prefersDark: ThemeUtil.doesDevicePreferDark(),
    });
  }

  public static getAppliedTheme(): Theme {
    if (typeof document === "undefined") {
      return Theme.Light;
    }

    return document.documentElement.classList.contains(Theme.Dark)
      ? Theme.Dark
      : Theme.Light;
  }

  public static initialize(options?: ThemeInitializeOptions): void {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    ThemeUtil.isAlwaysLight = options?.isAlwaysLight || neverAlwaysLight;
    ThemeUtil.applyPreferredTheme(false);
    ThemeUtil.followChanges();
  }

  /*
   * Draws the page in the person's theme again - or light, on a page that is
   * always light: after a pick in another tab, a change of the device, or a
   * move to another page of the app.
   */
  public static applyPreferredTheme(notify: boolean = true): void {
    ThemeUtil.applyTheme(
      ThemeUtil.isAlwaysLight() ? Theme.Light : ThemeUtil.getPreferredTheme(),
      notify,
    );
  }

  /*
   * The person's pick: kept in their browser, and drawn at once. Where the
   * browser keeps nothing, the pick still holds while the page is open
   * (RememberedChoice), so a change of the device does not undo it.
   */
  public static setPreference(preference: ThemePreference): void {
    RememberedChoice.remember(THEME_STORAGE_KEY, preference);
    ThemeUtil.applyPreferredTheme();
  }

  // A pick named by the theme it draws: Light or Dark.
  public static setTheme(theme: Theme): void {
    ThemeUtil.setPreference(
      theme === Theme.Dark ? ThemePreference.Dark : ThemePreference.Light,
    );
  }

  // The other theme than the one the page is drawn in, picked and kept.
  public static toggleTheme(): Theme {
    const theme: Theme =
      ThemeUtil.getAppliedTheme() === Theme.Dark ? Theme.Light : Theme.Dark;
    ThemeUtil.setTheme(theme);
    return theme;
  }

  /*
   * Draws the document in a theme - the dark class, data-theme, the
   * color-scheme and the theme-color tag - and tells useTheme. Without
   * saving it: the dashboard saves the reader's pick (setPreference), and a
   * status page draws the theme its owner set (StatusPage/src/Utils/
   * StatusPageTheme.ts), which is not the dashboard's to remember.
   */
  public static applyTheme(theme: Theme, notify: boolean = true): void {
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
      isDark ? THEME_COLORS[Theme.Dark] : THEME_COLORS[Theme.Light],
    );

    if (notify && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(THEME_CHANGE_EVENT, {
          detail: { theme },
        }),
      );
    }
  }

  /*
   * Follows, while the page is open, what can change the person's theme: a
   * change of the device (it moves a page whose pick is System, and nothing
   * else), and a pick made - or storage cleared - in another tab of this
   * address.
   */
  private static followChanges(): void {
    if (ThemeUtil.isFollowingChanges) {
      return;
    }

    ThemeUtil.isFollowingChanges = true;

    const onDeviceChange: () => void = (): void => {
      if (doesThemePreferenceFollowDevice(ThemeUtil.getPreference())) {
        ThemeUtil.applyPreferredTheme();
      }
    };

    try {
      if (window.matchMedia) {
        const query: MediaQueryList = window.matchMedia(
          DARK_COLOR_SCHEME_MEDIA_QUERY,
        );

        if (typeof query.addEventListener === "function") {
          query.addEventListener("change", onDeviceChange);
        } else if (typeof query.addListener === "function") {
          // Safari before 14.
          query.addListener(onDeviceChange);
        }
      }
    } catch {
      // A browser that cannot say keeps the theme the page opened in.
    }

    RememberedChoice.subscribe(THEME_STORAGE_KEY, (): void => {
      ThemeUtil.applyPreferredTheme();
    });
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

/*
 * The person's pick changes with every pick drawn on this page
 * (THEME_CHANGE_EVENT) and with one made in another tab.
 */
const subscribeToPreference: (onStoreChange: () => void) => () => void = (
  onStoreChange: () => void,
): (() => void) => {
  const unsubscribeFromTheme: () => void = subscribeToTheme(onStoreChange);
  const unsubscribeFromOtherTabs: () => void = RememberedChoice.subscribe(
    THEME_STORAGE_KEY,
    onStoreChange,
  );

  return (): void => {
    unsubscribeFromTheme();
    unsubscribeFromOtherTabs();
  };
};

/** Reactively reads what the person picked: Light, Dark or System. */
export const useThemePreference: () => ThemePreference =
  (): ThemePreference => {
    return React.useSyncExternalStore(
      subscribeToPreference,
      ThemeUtil.getPreference,
      (): ThemePreference => {
        return parseThemePreference(null);
      },
    );
  };
