import PublicPageTheme, {
  PublicPageColorScheme,
  getPublicPageThemeColorScheme,
} from "../Theme/PublicPageTheme";

/*
 * A status page's theme: how the page looks to the people who visit it. The
 * three themes, and how they are read, written into the page's <head> and
 * drawn, are every public page's (Types/Theme/PublicPageTheme.ts, which a
 * dashboard's public link shares); what is the status page's own is here.
 *
 *   - Light: the light page every status page was before this setting.
 *   - Dark: a dark page, for every visitor.
 *   - System: light or dark, as each visitor's device is set (the
 *     prefers-color-scheme media feature), following a change while the page
 *     is open. A visitor can also pick the other one from the page's footer,
 *     and the page remembers it in their browser.
 *
 * Pages made before the setting keep Light (the migration that adds the
 * column fills them in), so nothing changes for them. A page made from now
 * on - in the dashboard or through the API - starts with System
 * (StatusPageService). Terraform sends the provider's default, Light, with
 * every create, and reads Light back from existing pages, so a configuration
 * that never names a theme never changes one (see the column's comment).
 *
 * The theme is applied before the first paint: the servers that render the
 * page's HTML put it on <html> (getStatusPageThemeHead), and a script at the
 * top of <head> (App/FeatureSet/StatusPage/views/index.ejs) works out the
 * colour scheme from it before any stylesheet loads, so a dark page never
 * flashes white. The app reads the setting again from the master page and
 * keeps the page in step (StatusPage/src/Utils/StatusPageTheme.ts).
 *
 * React-free: the API, both page servers, the template's tests, the status
 * page app and the dashboard all read it.
 */
type StatusPageTheme = PublicPageTheme;

export default PublicPageTheme;

export {
  PUBLIC_PAGE_THEMES as STATUS_PAGE_THEMES,
  /*
   * What a page that has no theme - one made before the setting, a column
   * left empty through the API - or one that cannot be read is drawn in:
   * the light page it always was.
   */
  PUBLIC_PAGE_THEME_FALLBACK as STATUS_PAGE_THEME_FALLBACK,
  PUBLIC_PAGE_LIGHT_SCHEME as STATUS_PAGE_LIGHT_SCHEME,
  PUBLIC_PAGE_DARK_SCHEME as STATUS_PAGE_DARK_SCHEME,
  /*
   * The colour the browser draws its own chrome in around the page (the
   * theme-color meta tag): the page's own background in each scheme, the
   * same as the dashboard's (Common/UI/Utils/Theme.ts).
   */
  PUBLIC_PAGE_THEME_COLORS as STATUS_PAGE_THEME_COLORS,
  PUBLIC_PAGE_THEME_HEAD_SETTINGS as STATUS_PAGE_THEME_HEAD_SETTINGS,
  // Whether a value is one of the three themes, exactly as they are stored.
  isPublicPageTheme as isStatusPageTheme,
  /*
   * The theme a stored or sent value stands for. Anything that is not one
   * of the three is the light page: a value that cannot be read never turns
   * a page dark.
   */
  parsePublicPageTheme as parseStatusPageTheme,
  /*
   * Why a status page write's theme cannot be saved, or null when it can:
   * one of the three, exactly as they are spelled, or nothing.
   */
  PUBLIC_PAGE_THEME_PROBLEM as STATUS_PAGE_THEME_PROBLEM,
  getPublicPageThemeProblem as getStatusPageThemeProblem,
  // Whether the page follows each visitor's device, and offers them a switch.
  doesPublicPageThemeFollowDevice as doesStatusPageThemeFollowDevice,
  /*
   * Whether a visitor can ever see the page dark: a Dark page, and a page
   * that follows the device. Its logo - the one logo the page has, made for
   * the light page and for the emails the page sends, which are light too -
   * then sits on a light backdrop while the page is dark (StatusPage's
   * LogoPlate), so it reads as it does on the light page.
   */
  canPublicPageThemeBeDark as canStatusPageThemeBeDark,
  // A visitor's own pick, as it was kept in their browser, or null for none.
  parsePublicPageVisitorColorScheme as parseStatusPageVisitorColorScheme,
  // What the server writes into the page's <head> for a theme (index.ejs).
  getPublicPageThemeHead as getStatusPageThemeHead,
  // The theme a <head> setting stands for (what the server put on <html>).
  getPublicPageThemeFromHeadSetting as getStatusPageThemeFromHeadSetting,
} from "../Theme/PublicPageTheme";

export type {
  PublicPageColorScheme as StatusPageColorScheme,
  // The theme as the page's <head> spells it.
  PublicPageThemeHeadSetting as StatusPageThemeHeadSetting,
  PublicPageThemeHead as StatusPageThemeHead,
} from "../Theme/PublicPageTheme";

// The status page column that holds the theme.
export const STATUS_PAGE_THEME_COLUMN: string = "theme";

/*
 * What a status page made from now on starts with when its create names no
 * theme: the page follows each visitor's device.
 */
export const NEW_STATUS_PAGE_THEME: StatusPageTheme = PublicPageTheme.System;

/*
 * Where a visitor's own pick, from the footer of a page that follows their
 * device, is kept in their browser. One key for every page on an origin: a
 * visitor who prefers one look for status pages prefers it for all of them.
 */
export const STATUS_PAGE_VISITOR_THEME_STORAGE_KEY: string =
  "oneuptime-status-page-theme";

/*
 * The attribute on <html> that carries the page's theme from the server to
 * the first script in <head>, as one of STATUS_PAGE_THEME_HEAD_SETTINGS.
 */
export const STATUS_PAGE_THEME_ATTRIBUTE: string = "data-status-page-theme";

/**
 * The colour scheme a page is drawn in for one visitor: Light and Dark are
 * what they say, whatever the visitor's device or pick; System is the
 * visitor's own pick from the footer when they made one, and their device's
 * setting otherwise.
 */
export function getStatusPageColorScheme(data: {
  theme: StatusPageTheme;
  prefersDark: boolean;
  visitorChoice?: PublicPageColorScheme | null | undefined;
}): PublicPageColorScheme {
  if (data.theme === PublicPageTheme.System && data.visitorChoice) {
    return data.visitorChoice;
  }

  return getPublicPageThemeColorScheme({
    theme: data.theme,
    prefersDark: data.prefersDark,
  });
}

/*
 * The variable the two servers that render a status page's HTML hand
 * index.ejs its theme in: what getStatusPageThemeHead returns. The template
 * draws the light page when it is not there.
 */
export const STATUS_PAGE_THEME_VIEW_VARIABLE: string = "statusPageTheme";
