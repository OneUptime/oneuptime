import PublicPageTheme, {
  PUBLIC_PAGE_THEMES,
  PUBLIC_PAGE_THEME_FALLBACK,
  PublicPageColorScheme,
  PublicPageThemeHead,
  PublicPageThemeHeadSetting,
  getDeviceColorScheme,
  getPublicPageThemeColorScheme,
  getPublicPageThemeHead,
  parsePublicPageTheme,
} from "../Theme/PublicPageTheme";

/*
 * A public dashboard's theme: how a dashboard shared through its public link
 * - with anyone who has the link, with or without a password - looks to the
 * people who open it. Light, Dark, or System (light or dark, as each
 * visitor's device is set): the three themes of every public page, read and
 * drawn the way a status page's are (Types/Theme/PublicPageTheme.ts).
 * Members who open the dashboard inside OneUptime see it in their own theme
 * (Common/UI/Utils/Theme.ts); this is its public link's.
 *
 * Dashboards made before the setting keep Light (the migration that adds the
 * column fills them in), so nothing changes for them. A dashboard made from
 * now on - in the dashboard or through the API - starts with System
 * (DashboardService), as a status page does. Terraform sends the provider's
 * default, Light, with every create, and reads Light back from existing
 * dashboards, so a configuration that never names a theme never changes one.
 *
 * What is the public dashboard's own:
 *
 *   - Every visitor can pick Light or Dark for themselves from the
 *     dashboard's toolbar, whatever its theme, and go back to the
 *     dashboard's own with Auto. Their browser keeps the pick, for every
 *     public dashboard on that address. A dashboard is a screen people
 *     watch for a long time, in rooms of every kind - a wall screen in a dim
 *     operations room, a laptop in a bright office - so the visitor's room
 *     has the last word, where a status page's look is its owner's.
 *   - A link can name a theme of its own, ?theme=light, ?theme=dark or
 *     ?theme=system, for a wall screen nobody touches or a site that embeds
 *     the dashboard: it wins over the dashboard's theme and the visitor's
 *     pick on every page the link opens, and the dashboard offers no pick
 *     then. The saved setting is not changed.
 *   - A page that knows no dashboard's theme - not found, and Access Denied
 *     by the IP allowlist, which shows nothing of the dashboard - follows
 *     the visitor: their pick, else their device.
 *
 * The theme is applied before the first paint: the two servers that render
 * the public dashboard's HTML put it on <html> (getDashboardThemeHead), and
 * a script at the top of <head> (App/FeatureSet/PublicDashboard/views/
 * index.ejs) works out the colour scheme from it, the link and the
 * visitor's pick before any stylesheet loads. The app reads the setting
 * again with the dashboard's metadata and keeps the page in step
 * (PublicDashboard/src/Utils/DashboardTheme.ts).
 *
 * React-free: the API, both page servers, the template's tests, the public
 * dashboard app and the dashboard all read it.
 */
type DashboardTheme = PublicPageTheme;

export default PublicPageTheme;

export type { PublicPageColorScheme as DashboardColorScheme } from "../Theme/PublicPageTheme";

export {
  // Why a dashboard write's theme cannot be saved (DashboardService).
  PUBLIC_PAGE_THEME_PROBLEM as DASHBOARD_THEME_PROBLEM,
  getPublicPageThemeProblem as getDashboardThemeProblem,
  // Whether a value is one of the three themes, exactly as they are stored.
  isPublicPageTheme as isDashboardTheme,
  PUBLIC_PAGE_DARK_SCHEME as DASHBOARD_DARK_SCHEME,
  PUBLIC_PAGE_LIGHT_SCHEME as DASHBOARD_LIGHT_SCHEME,
  PUBLIC_PAGE_THEME_COLORS as DASHBOARD_THEME_COLORS,
} from "../Theme/PublicPageTheme";

export const DASHBOARD_THEMES: ReadonlyArray<DashboardTheme> =
  PUBLIC_PAGE_THEMES;

// The dashboard column that holds the theme.
export const DASHBOARD_THEME_COLUMN: string = "theme";

/*
 * What a dashboard that has no theme - one made before the setting, a
 * column left empty through the API - or one that cannot be read is drawn
 * in: the light page every public dashboard was before the setting.
 */
export const DASHBOARD_THEME_FALLBACK: DashboardTheme =
  PUBLIC_PAGE_THEME_FALLBACK;

/*
 * What a dashboard made from now on starts with when its create names no
 * theme: its public link follows each visitor's device, as a new status
 * page does.
 */
export const NEW_DASHBOARD_THEME: DashboardTheme = PublicPageTheme.System;

/*
 * What a page that knows no dashboard's theme is drawn in: the visitor's own
 * pick, else their device - a not-found page, and Access Denied, which
 * shows nothing of the dashboard it refuses.
 */
export const UNKNOWN_DASHBOARD_THEME: DashboardTheme = PublicPageTheme.System;

/**
 * The theme a stored or sent value stands for. Anything that is not one of
 * the three is the light page: a value that cannot be read never turns a
 * dashboard dark.
 */
export function parseDashboardTheme(value: unknown): DashboardTheme {
  return parsePublicPageTheme(value);
}

/*
 * A visitor's own pick, from the theme menu in the dashboard's toolbar:
 * light, dark, or auto - none of their own, so the dashboard's theme
 * decides again. Only light and dark are kept in their browser.
 */
export type DashboardVisitorThemeChoice = "light" | "dark" | "auto";

export const DASHBOARD_VISITOR_THEME_AUTO: DashboardVisitorThemeChoice = "auto";

export const DASHBOARD_VISITOR_THEME_CHOICES: ReadonlyArray<DashboardVisitorThemeChoice> =
  ["light", "dark", "auto"];

/*
 * Where a visitor's own pick is kept in their browser. One key for every
 * public dashboard on an address: a visitor who prefers one look for
 * dashboards prefers it for all of them.
 */
export const DASHBOARD_VISITOR_THEME_STORAGE_KEY: string =
  "oneuptime-public-dashboard-theme";

// A visitor's pick, as it was kept in their browser, or null for none.
export function parseDashboardVisitorColorScheme(
  value: unknown,
): PublicPageColorScheme | null {
  if (value === "light" || value === "dark") {
    return value;
  }

  return null;
}

/*
 * The visitor's pick as the theme menu shows it: their kept scheme, or
 * auto when they have none.
 */
export function getDashboardVisitorThemeChoice(
  visitorColorScheme: PublicPageColorScheme | null,
): DashboardVisitorThemeChoice {
  return visitorColorScheme || DASHBOARD_VISITOR_THEME_AUTO;
}

/*
 * The query parameter a link names its own theme in, for a wall screen
 * nobody touches or a site that embeds the dashboard: ?theme=light,
 * ?theme=dark or ?theme=system, spelled as the page's <head> spells them.
 */
export const DASHBOARD_THEME_LINK_PARAMETER: string = "theme";

export type DashboardLinkTheme = PublicPageThemeHeadSetting;

/*
 * The theme a link names, or null when it names none it can be read as.
 * Read in any case and with spaces around it, as people type links; any
 * other value is no theme at all, so the link opens as it would without it.
 */
export function parseDashboardLinkTheme(
  value: unknown,
): DashboardLinkTheme | null {
  if (typeof value !== "string") {
    return null;
  }

  const theme: string = value.trim().toLowerCase();

  if (theme === "light" || theme === "dark" || theme === "system") {
    return theme;
  }

  return null;
}

// The theme a page's address names in its query string (location.search).
export function getDashboardLinkThemeFromSearch(
  search: string,
): DashboardLinkTheme | null {
  try {
    return parseDashboardLinkTheme(
      new URLSearchParams(search).get(DASHBOARD_THEME_LINK_PARAMETER),
    );
  } catch {
    return null;
  }
}

/**
 * The colour scheme a public dashboard is drawn in for one visitor, from
 * the first of these that says:
 *
 *   1. the link's own theme (?theme=): light, dark, or system - the
 *      visitor's device;
 *   2. the visitor's own pick from the toolbar's theme menu;
 *   3. the dashboard's theme: Light and Dark are what they say, System is
 *      the visitor's device. A page that knows no dashboard's theme is
 *      drawn as System (UNKNOWN_DASHBOARD_THEME).
 */
export function getDashboardColorScheme(data: {
  theme: DashboardTheme;
  prefersDark: boolean;
  visitorChoice?: PublicPageColorScheme | null | undefined;
  linkTheme?: DashboardLinkTheme | null | undefined;
}): PublicPageColorScheme {
  if (data.linkTheme === "system") {
    return getDeviceColorScheme(data.prefersDark);
  }

  if (data.linkTheme) {
    return data.linkTheme;
  }

  if (data.visitorChoice) {
    return data.visitorChoice;
  }

  return getPublicPageThemeColorScheme({
    theme: data.theme,
    prefersDark: data.prefersDark,
  });
}

/*
 * The attribute on <html> that carries the dashboard's theme from the
 * server to the first script in <head>, spelled light, dark or system.
 */
export const DASHBOARD_THEME_ATTRIBUTE: string = "data-public-dashboard-theme";

/*
 * What the server writes into the public dashboard's <head> for its theme
 * (Types/Theme/PublicPageTheme.ts, getPublicPageThemeHead): the attribute
 * the first script reads, the class <html> is sent with, and the
 * color-scheme and theme-color tags. A page that knows no dashboard's theme
 * is sent UNKNOWN_DASHBOARD_THEME's: it follows the visitor.
 */
export type DashboardThemeHead = PublicPageThemeHead;

export function getDashboardThemeHead(
  theme: DashboardTheme | null,
): DashboardThemeHead {
  return getPublicPageThemeHead(theme || UNKNOWN_DASHBOARD_THEME);
}

/*
 * The variable the two servers that render the public dashboard's HTML
 * hand index.ejs its theme in: what getDashboardThemeHead returns. The
 * template follows the visitor when it is not there.
 */
export const DASHBOARD_THEME_VIEW_VARIABLE: string = "dashboardTheme";
