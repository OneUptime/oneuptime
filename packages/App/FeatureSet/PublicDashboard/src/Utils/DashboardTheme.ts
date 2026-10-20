import DashboardTheme, {
  DASHBOARD_DARK_SCHEME,
  DASHBOARD_THEME_ATTRIBUTE,
  DASHBOARD_VISITOR_THEME_STORAGE_KEY,
  DashboardColorScheme,
  DashboardLinkTheme,
  DashboardVisitorThemeChoice,
  getDashboardColorScheme,
  getDashboardLinkThemeFromSearch,
  getDashboardVisitorThemeChoice,
  parseDashboardVisitorColorScheme,
} from "Common/Types/Dashboard/DashboardTheme";
import { getPublicPageThemeFromHeadSetting } from "Common/Types/Theme/PublicPageTheme";
import RememberedChoice from "Common/UI/Utils/RememberedChoice";
import ThemeUtil, { Theme } from "Common/UI/Utils/Theme";

/*
 * A public dashboard's theme, in the visitor's browser (Common/Types/
 * Dashboard/DashboardTheme.ts): Light, Dark, or System - light or dark as
 * the visitor's device is set.
 *
 * The first script in the page's <head> (views/index.ejs) has drawn the
 * page in its scheme before the first paint, from the link's own theme
 * (?theme=), the visitor's pick and the theme the server put on <html>.
 * This keeps it there:
 *
 *   - initialize(), as the app starts, reads the link's theme and the one on
 *     <html>, and starts following the device and the visitor's pick made
 *     in another tab, so the page changes with them while it is open.
 *   - setDashboardTheme(), once the dashboard's metadata is read, applies
 *     its theme: it is what counts, and a dashboard whose server could not
 *     read it was sent a page that follows the visitor. A page that shows
 *     no dashboard (not found, Access Denied) follows the visitor too
 *     (UNKNOWN_DASHBOARD_THEME).
 *   - setVisitorChoice() is the visitor's own pick, from the theme menu in
 *     the dashboard's toolbar: Light or Dark, kept in their browser for
 *     every public dashboard on this address, or Auto, which forgets it so
 *     the dashboard's theme decides again. A link that names its own theme
 *     offers no pick. The browser keeps it the way it keeps every such
 *     choice, a viewer's time range and auto-refresh on a dashboard among
 *     them (Common/UI/Utils/RememberedChoice.ts).
 *
 * The scheme is drawn by Common's ThemeUtil.applyTheme (the dark class,
 * data-theme, color-scheme and the theme-color tag), as the dashboard's and
 * a status page's are, so every Common component and dashboard widget that
 * reads useTheme follows it. The React hook the toolbar's theme menu reads
 * is its sibling, UseDashboardTheme.ts: this module stays free of React, so
 * the app's pure modules and the App tests that reach them can import it.
 */

// Told whenever the dashboard's theme or the visitor's pick changes.
export const DASHBOARD_THEME_CHANGE_EVENT: string =
  "oneuptime:public-dashboard-theme-change";

export const DARK_COLOR_SCHEME_MEDIA_QUERY: string =
  "(prefers-color-scheme: dark)";

export default class DashboardThemeUtil {
  // The dashboard's theme from its metadata, once it is read.
  private static dashboardTheme: DashboardTheme | null = null;

  /*
   * The link's own theme, read once as the app starts: the page keeps the
   * theme its link was opened with, whatever the app writes into the
   * address afterwards (a picked variable's value). Undefined until read.
   */
  private static linkTheme: DashboardLinkTheme | null | undefined = undefined;

  /*
   * The visitor's own pick: what their browser keeps, read once, and what
   * they pick from then on. Kept here as well, so a pick holds for as long
   * as the page is open when the browser blocks storage. Undefined until
   * read.
   */
  private static visitorColorScheme: DashboardColorScheme | null | undefined =
    undefined;

  private static isFollowingDevice: boolean = false;

  /*
   * The dashboard's theme: its metadata's, once it is read, and until then
   * what the server put on <html> for the script in <head>.
   */
  public static getDashboardTheme(): DashboardTheme {
    if (DashboardThemeUtil.dashboardTheme) {
      return DashboardThemeUtil.dashboardTheme;
    }

    if (typeof document === "undefined") {
      return getPublicPageThemeFromHeadSetting(null);
    }

    return getPublicPageThemeFromHeadSetting(
      document.documentElement.getAttribute(DASHBOARD_THEME_ATTRIBUTE),
    );
  }

  // The theme the page's link names (?theme=), or null when it names none.
  public static getLinkTheme(): DashboardLinkTheme | null {
    if (DashboardThemeUtil.linkTheme === undefined) {
      DashboardThemeUtil.linkTheme =
        typeof window === "undefined"
          ? null
          : getDashboardLinkThemeFromSearch(window.location.search);
    }

    return DashboardThemeUtil.linkTheme;
  }

  /*
   * Whether the visitor may pick a theme of their own: always, unless the
   * link names one - a wall screen's or an embedding site's, which is not
   * the visitor's to change.
   */
  public static isVisitorChoiceOffered(): boolean {
    return DashboardThemeUtil.getLinkTheme() === null;
  }

  // As the app starts: the theme on <html> and the link's, kept in step.
  public static initialize(): void {
    DashboardThemeUtil.getLinkTheme();
    DashboardThemeUtil.followDevice();
    DashboardThemeUtil.apply();
  }

  /*
   * The dashboard's theme, from its metadata - or UNKNOWN_DASHBOARD_THEME
   * for a page that shows no dashboard.
   */
  public static setDashboardTheme(theme: DashboardTheme): void {
    const hasChanged: boolean =
      theme !== DashboardThemeUtil.getDashboardTheme();

    DashboardThemeUtil.dashboardTheme = theme;

    if (typeof document !== "undefined") {
      // What the page is drawn in, for whatever reads <html> after this.
      document.documentElement.setAttribute(
        DASHBOARD_THEME_ATTRIBUTE,
        theme === DashboardTheme.System
          ? "system"
          : theme === DashboardTheme.Dark
            ? "dark"
            : "light",
      );
    }

    DashboardThemeUtil.followDevice();
    DashboardThemeUtil.apply();

    if (hasChanged) {
      DashboardThemeUtil.notify();
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
  public static getVisitorColorScheme(): DashboardColorScheme | null {
    if (DashboardThemeUtil.visitorColorScheme === undefined) {
      DashboardThemeUtil.visitorColorScheme =
        DashboardThemeUtil.readKeptVisitorColorScheme();
    }

    return DashboardThemeUtil.visitorColorScheme;
  }

  // What the visitor's browser keeps of their pick, or null.
  private static readKeptVisitorColorScheme(): DashboardColorScheme | null {
    return parseDashboardVisitorColorScheme(
      RememberedChoice.read(DASHBOARD_VISITOR_THEME_STORAGE_KEY),
    );
  }

  // The visitor's pick as the theme menu shows it: light, dark or auto.
  public static getVisitorChoice(): DashboardVisitorThemeChoice {
    return getDashboardVisitorThemeChoice(
      DashboardThemeUtil.getVisitorColorScheme(),
    );
  }

  // The scheme the page is drawn in for this visitor.
  public static getColorScheme(): DashboardColorScheme {
    return getDashboardColorScheme({
      theme: DashboardThemeUtil.getDashboardTheme(),
      prefersDark: DashboardThemeUtil.doesDevicePreferDark(),
      visitorChoice: DashboardThemeUtil.getVisitorColorScheme(),
      linkTheme: DashboardThemeUtil.getLinkTheme(),
    });
  }

  /*
   * The visitor's pick from the theme menu: Light or Dark is kept in their
   * browser, Auto forgets any pick, so the dashboard's theme decides again.
   * A link that names its own theme offers no pick, and a pick asked for
   * anyway changes nothing.
   */
  public static setVisitorChoice(
    choice: DashboardVisitorThemeChoice,
  ): DashboardColorScheme {
    if (!DashboardThemeUtil.isVisitorChoiceOffered()) {
      return DashboardThemeUtil.getColorScheme();
    }

    // Auto is no scheme of the visitor's own.
    const scheme: DashboardColorScheme | null =
      parseDashboardVisitorColorScheme(choice);

    DashboardThemeUtil.visitorColorScheme = scheme;

    /*
     * Storage can be blocked. The pick still holds for as long as the page
     * is open: it is kept here as well, and RememberedChoice holds what the
     * browser would not keep.
     */
    if (scheme) {
      RememberedChoice.remember(DASHBOARD_VISITOR_THEME_STORAGE_KEY, scheme);
    } else {
      RememberedChoice.forget(DASHBOARD_VISITOR_THEME_STORAGE_KEY);
    }

    DashboardThemeUtil.apply();
    DashboardThemeUtil.notify();

    return DashboardThemeUtil.getColorScheme();
  }

  private static apply(): void {
    ThemeUtil.applyTheme(
      DashboardThemeUtil.getColorScheme() === DASHBOARD_DARK_SCHEME
        ? Theme.Dark
        : Theme.Light,
    );
  }

  private static notify(): void {
    if (typeof window === "undefined") {
      return;
    }

    window.dispatchEvent(
      new CustomEvent(DASHBOARD_THEME_CHANGE_EVENT, {
        detail: {
          theme: DashboardThemeUtil.getDashboardTheme(),
          visitorChoice: DashboardThemeUtil.getVisitorChoice(),
        },
      }),
    );
  }

  /*
   * Follows the device, and the visitor's pick made in another tab, while
   * the page is open. The scheme is worked out again from the link, the
   * pick and the dashboard's theme each time, so only what still decides
   * the page changes it: a device change moves a page that follows the
   * device, and nothing a link pins.
   */
  private static followDevice(): void {
    if (DashboardThemeUtil.isFollowingDevice || typeof window === "undefined") {
      return;
    }

    DashboardThemeUtil.isFollowingDevice = true;

    const onDeviceChange: () => void = (): void => {
      DashboardThemeUtil.apply();
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
      // A browser that cannot say keeps the scheme the page opened in.
    }

    // A pick made, or storage cleared, in another tab of this address.
    RememberedChoice.subscribe(DASHBOARD_VISITOR_THEME_STORAGE_KEY, (): void => {
      DashboardThemeUtil.visitorColorScheme =
        DashboardThemeUtil.readKeptVisitorColorScheme();
      DashboardThemeUtil.apply();
      DashboardThemeUtil.notify();
    });
  }
}
