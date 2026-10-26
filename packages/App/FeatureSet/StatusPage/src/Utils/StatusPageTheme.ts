import StatusPageTheme, {
  canStatusPageThemeBeDark,
  doesStatusPageThemeFollowDevice,
  getStatusPageColorScheme,
  getStatusPageThemeFromHeadSetting,
  parseStatusPageVisitorColorScheme,
  STATUS_PAGE_DARK_SCHEME,
  STATUS_PAGE_LIGHT_SCHEME,
  STATUS_PAGE_THEME_ATTRIBUTE,
  STATUS_PAGE_VISITOR_THEME_STORAGE_KEY,
  StatusPageColorScheme,
} from "Common/Types/StatusPage/StatusPageTheme";
import ThemeUtil, { THEME_CHANGE_EVENT, Theme } from "Common/UI/Utils/Theme";
import React from "react";
import StatusPageUtil from "./StatusPage";

/*
 * A status page's theme, in the visitor's browser (Common/Types/StatusPage/
 * StatusPageTheme.ts): Light, Dark, or System - light or dark as the
 * visitor's device is set.
 *
 * The first script in the page's <head> (views/index.ejs) has drawn the
 * page in its scheme before the first paint, from the theme the server put
 * on <html>. This keeps it there:
 *
 *   - initialize(), as the app starts, reads that theme and starts following
 *     the device, so a System page changes with the device while it is open.
 *   - setPageTheme(), once the page's settings are read (the master page),
 *     applies them: they are what counts, and a page whose server could not
 *     read them was sent the light page.
 *   - switchColorScheme() is the visitor's own pick, from the footer of a
 *     page that follows their device. It is kept in their browser, and a
 *     pick that matches their device is forgotten, so the page follows the
 *     device again from then on. Light and Dark pages offer no pick - but
 *     on the Dashboard's preview of a page (its address on OneUptime,
 *     /status-page/<id>) every page offers one, so its owner can see it in
 *     the other theme too: there the pick lasts for the visit only, kept
 *     nowhere, and the page opens in its own theme again.
 *
 * The scheme is drawn by Common's ThemeUtil.applyTheme (the dark class,
 * data-theme, color-scheme and the theme-color tag), as the dashboard's is,
 * so every Common component that reads useTheme follows it.
 */

// Told whenever the page's theme setting changes.
export const STATUS_PAGE_THEME_CHANGE_EVENT: string =
  "oneuptime:status-page-theme-change";

export const DARK_COLOR_SCHEME_MEDIA_QUERY: string =
  "(prefers-color-scheme: dark)";

export default class StatusPageThemeUtil {
  // The page's theme from its settings, once they are read.
  private static pageTheme: StatusPageTheme | null = null;
  private static isFollowingDevice: boolean = false;
  /*
   * On the Dashboard's preview of a Light or Dark page: the other scheme,
   * picked from the footer to see the page in it. For the visit only.
   */
  private static previewColorScheme: StatusPageColorScheme | null = null;

  // Whether the page is the Dashboard's preview (its OneUptime address).
  public static isPreview(): boolean {
    if (typeof window === "undefined") {
      return false;
    }

    return StatusPageUtil.isPreviewPage();
  }

  /*
   * Whether the footer offers this visitor a light / dark switch: a page
   * that follows each visitor's device, and any page in the Dashboard's
   * preview, where its owner checks how it looks both ways.
   */
  public static canVisitorSwitch(
    theme: StatusPageTheme = StatusPageThemeUtil.getPageTheme(),
  ): boolean {
    return (
      doesStatusPageThemeFollowDevice(theme) || StatusPageThemeUtil.isPreview()
    );
  }

  /*
   * Whether this visitor can see the page dark: a Dark page, one that
   * follows the device, and any page in the Dashboard's preview, which can
   * be switched to dark. The logo then needs what it is drawn on in the
   * dark (LogoPlate).
   */
  public static canBeDarkForVisitor(
    theme: StatusPageTheme = StatusPageThemeUtil.getPageTheme(),
  ): boolean {
    return canStatusPageThemeBeDark(theme) || StatusPageThemeUtil.isPreview();
  }

  /*
   * The page's theme: its settings', once they are read, and until then
   * what the server put on <html> for the script in <head>.
   */
  public static getPageTheme(): StatusPageTheme {
    if (StatusPageThemeUtil.pageTheme) {
      return StatusPageThemeUtil.pageTheme;
    }

    if (typeof document === "undefined") {
      return getStatusPageThemeFromHeadSetting(null);
    }

    return getStatusPageThemeFromHeadSetting(
      document.documentElement.getAttribute(STATUS_PAGE_THEME_ATTRIBUTE),
    );
  }

  // As the app starts: the theme on <html>, kept in step with the device.
  public static initialize(): void {
    StatusPageThemeUtil.followDevice();
    StatusPageThemeUtil.apply();
  }

  // The page's theme from its settings (the master page).
  public static setPageTheme(theme: StatusPageTheme): void {
    const hasChanged: boolean = theme !== StatusPageThemeUtil.getPageTheme();

    StatusPageThemeUtil.pageTheme = theme;

    // A preview's pick is of the theme it was made on.
    if (hasChanged) {
      StatusPageThemeUtil.previewColorScheme = null;
    }

    if (typeof document !== "undefined") {
      // What the page is drawn in, for whatever reads <html> after this.
      document.documentElement.setAttribute(
        STATUS_PAGE_THEME_ATTRIBUTE,
        theme === StatusPageTheme.System
          ? "system"
          : theme === StatusPageTheme.Dark
            ? "dark"
            : "light",
      );
    }

    StatusPageThemeUtil.followDevice();
    StatusPageThemeUtil.apply();

    if (hasChanged && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(STATUS_PAGE_THEME_CHANGE_EVENT, {
          detail: { theme },
        }),
      );
    }
  }

  // Whether the visitor's device asks for a dark page.
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

  // The visitor's own pick, kept in their browser, or null.
  public static getVisitorColorScheme(): StatusPageColorScheme | null {
    if (typeof window === "undefined") {
      return null;
    }

    try {
      return parseStatusPageVisitorColorScheme(
        window.localStorage.getItem(STATUS_PAGE_VISITOR_THEME_STORAGE_KEY),
      );
    } catch {
      return null;
    }
  }

  // The scheme the page is drawn in for this visitor.
  public static getColorScheme(): StatusPageColorScheme {
    const theme: StatusPageTheme = StatusPageThemeUtil.getPageTheme();

    if (
      !doesStatusPageThemeFollowDevice(theme) &&
      StatusPageThemeUtil.previewColorScheme &&
      StatusPageThemeUtil.isPreview()
    ) {
      return StatusPageThemeUtil.previewColorScheme;
    }

    return getStatusPageColorScheme({
      theme: theme,
      prefersDark: StatusPageThemeUtil.doesDevicePreferDark(),
      visitorChoice: StatusPageThemeUtil.getVisitorColorScheme(),
    });
  }

  /*
   * The visitor's switch, on a page that follows their device: the other
   * scheme, kept in their browser. A pick that is what their device asks
   * for is forgotten instead, so the page follows the device again. A Light
   * or Dark page has no switch, and stays as it is.
   */
  public static switchColorScheme(): StatusPageColorScheme {
    const theme: StatusPageTheme = StatusPageThemeUtil.getPageTheme();

    if (!doesStatusPageThemeFollowDevice(theme)) {
      if (!StatusPageThemeUtil.isPreview()) {
        return StatusPageThemeUtil.getColorScheme();
      }

      /*
       * The Dashboard's preview of a Light or Dark page: the other scheme,
       * for this visit. Kept nowhere - not even with the visitor's pick for
       * pages that follow the device, which every page on this address
       * shares - so the page opens in its own theme again, as its visitors
       * see it.
       */
      const next: StatusPageColorScheme =
        StatusPageThemeUtil.getColorScheme() === STATUS_PAGE_DARK_SCHEME
          ? STATUS_PAGE_LIGHT_SCHEME
          : STATUS_PAGE_DARK_SCHEME;

      const own: StatusPageColorScheme =
        theme === StatusPageTheme.Dark
          ? STATUS_PAGE_DARK_SCHEME
          : STATUS_PAGE_LIGHT_SCHEME;

      StatusPageThemeUtil.previewColorScheme = next === own ? null : next;
      StatusPageThemeUtil.apply();

      return next;
    }

    const next: StatusPageColorScheme =
      StatusPageThemeUtil.getColorScheme() === STATUS_PAGE_DARK_SCHEME
        ? STATUS_PAGE_LIGHT_SCHEME
        : STATUS_PAGE_DARK_SCHEME;

    const device: StatusPageColorScheme =
      StatusPageThemeUtil.doesDevicePreferDark()
        ? STATUS_PAGE_DARK_SCHEME
        : STATUS_PAGE_LIGHT_SCHEME;

    try {
      if (next === device) {
        window.localStorage.removeItem(STATUS_PAGE_VISITOR_THEME_STORAGE_KEY);
      } else {
        window.localStorage.setItem(
          STATUS_PAGE_VISITOR_THEME_STORAGE_KEY,
          next,
        );
      }
    } catch {
      /*
       * Storage can be blocked. The page still switches, for as long as it
       * is open: the scheme is drawn from the pick, not read back.
       */
      StatusPageThemeUtil.apply(next);
      return next;
    }

    StatusPageThemeUtil.apply();

    return StatusPageThemeUtil.getColorScheme();
  }

  private static apply(scheme?: StatusPageColorScheme): void {
    const colorScheme: StatusPageColorScheme =
      scheme || StatusPageThemeUtil.getColorScheme();

    ThemeUtil.applyTheme(
      colorScheme === STATUS_PAGE_DARK_SCHEME ? Theme.Dark : Theme.Light,
    );
  }

  /*
   * Follows the device, and the visitor's pick made in another tab, while
   * the page is open. Only a System page changes with them: the scheme is
   * worked out again from the page's theme each time.
   */
  private static followDevice(): void {
    if (
      StatusPageThemeUtil.isFollowingDevice ||
      typeof window === "undefined"
    ) {
      return;
    }

    StatusPageThemeUtil.isFollowingDevice = true;

    const onChange: () => void = (): void => {
      if (doesStatusPageThemeFollowDevice(StatusPageThemeUtil.getPageTheme())) {
        StatusPageThemeUtil.apply();
      }
    };

    try {
      if (window.matchMedia) {
        const query: MediaQueryList = window.matchMedia(
          DARK_COLOR_SCHEME_MEDIA_QUERY,
        );

        if (typeof query.addEventListener === "function") {
          query.addEventListener("change", onChange);
        } else if (typeof query.addListener === "function") {
          // Safari before 14.
          query.addListener(onChange);
        }
      }
    } catch {
      // A browser that cannot say keeps the scheme the page opened in.
    }

    window.addEventListener("storage", (event: StorageEvent): void => {
      if (
        event.key === STATUS_PAGE_VISITOR_THEME_STORAGE_KEY ||
        event.key === null
      ) {
        onChange();
      }
    });
  }
}

const subscribeToPageTheme: (onChange: () => void) => () => void = (
  onChange: () => void,
): (() => void) => {
  if (typeof window === "undefined") {
    return (): void => {};
  }

  window.addEventListener(STATUS_PAGE_THEME_CHANGE_EVENT, onChange);
  window.addEventListener(THEME_CHANGE_EVENT, onChange);

  return (): void => {
    window.removeEventListener(STATUS_PAGE_THEME_CHANGE_EVENT, onChange);
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
  };
};

const getPageThemeSnapshot: () => StatusPageTheme = (): StatusPageTheme => {
  return StatusPageThemeUtil.getPageTheme();
};

const getColorSchemeSnapshot: () => StatusPageColorScheme =
  (): StatusPageColorScheme => {
    return ThemeUtil.getAppliedTheme() === Theme.Dark
      ? STATUS_PAGE_DARK_SCHEME
      : STATUS_PAGE_LIGHT_SCHEME;
  };

const getLightSnapshot: () => StatusPageColorScheme =
  (): StatusPageColorScheme => {
    return STATUS_PAGE_LIGHT_SCHEME;
  };

const getFallbackThemeSnapshot: () => StatusPageTheme = (): StatusPageTheme => {
  return StatusPageTheme.Light;
};

/*
 * The page's theme setting and the scheme it is drawn in, kept up to date
 * as either changes: the footer's switch reads both, the logo's backdrop
 * the setting.
 */
export const useStatusPageTheme: () => {
  theme: StatusPageTheme;
  colorScheme: StatusPageColorScheme;
} = (): { theme: StatusPageTheme; colorScheme: StatusPageColorScheme } => {
  const theme: StatusPageTheme = React.useSyncExternalStore(
    subscribeToPageTheme,
    getPageThemeSnapshot,
    getFallbackThemeSnapshot,
  );

  const colorScheme: StatusPageColorScheme = React.useSyncExternalStore(
    subscribeToPageTheme,
    getColorSchemeSnapshot,
    getLightSnapshot,
  );

  return { theme, colorScheme };
};
