/*
 * A status page's theme: how the page looks to the people who visit it.
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
enum StatusPageTheme {
  Light = "Light",
  Dark = "Dark",
  // Light or dark, as each visitor's device is set.
  System = "System",
}

export default StatusPageTheme;

// The status page column that holds the theme.
export const STATUS_PAGE_THEME_COLUMN: string = "theme";

export const STATUS_PAGE_THEMES: ReadonlyArray<StatusPageTheme> = [
  StatusPageTheme.Light,
  StatusPageTheme.Dark,
  StatusPageTheme.System,
];

/*
 * What a page that has no theme - one made before the setting, a column
 * left empty through the API - or one that cannot be read is drawn in: the
 * light page it always was.
 */
export const STATUS_PAGE_THEME_FALLBACK: StatusPageTheme =
  StatusPageTheme.Light;

/*
 * What a status page made from now on starts with when its create names no
 * theme: the page follows each visitor's device.
 */
export const NEW_STATUS_PAGE_THEME: StatusPageTheme = StatusPageTheme.System;

// The two ways a page is drawn.
export type StatusPageColorScheme = "light" | "dark";

export const STATUS_PAGE_LIGHT_SCHEME: StatusPageColorScheme = "light";
export const STATUS_PAGE_DARK_SCHEME: StatusPageColorScheme = "dark";

/*
 * The colour the browser draws its own chrome in around the page (the
 * theme-color meta tag): the page's own background in each scheme, the same
 * as the dashboard's (Common/UI/Utils/Theme.ts).
 */
export const STATUS_PAGE_THEME_COLORS: Readonly<
  Record<StatusPageColorScheme, string>
> = {
  light: "#f9fafb",
  dark: "#0f172a",
};

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

// The theme as the page's <head> spells it.
export type StatusPageThemeHeadSetting = "light" | "dark" | "system";

const HEAD_SETTING_BY_THEME: Readonly<
  Record<StatusPageTheme, StatusPageThemeHeadSetting>
> = {
  [StatusPageTheme.Light]: "light",
  [StatusPageTheme.Dark]: "dark",
  [StatusPageTheme.System]: "system",
};

export const STATUS_PAGE_THEME_HEAD_SETTINGS: ReadonlyArray<StatusPageThemeHeadSetting> =
  ["light", "dark", "system"];

// Whether a value is one of the three themes, exactly as they are stored.
export function isStatusPageTheme(value: unknown): value is StatusPageTheme {
  return (
    typeof value === "string" &&
    (STATUS_PAGE_THEMES as ReadonlyArray<string>).includes(value)
  );
}

/**
 * The theme a stored or sent value stands for. Anything that is not one of
 * the three - nothing at all, a value from an older or newer server, a typo -
 * is the light page, which is what every status page was before the setting:
 * a value that cannot be read never turns a page dark.
 */
export function parseStatusPageTheme(value: unknown): StatusPageTheme {
  return isStatusPageTheme(value) ? value : STATUS_PAGE_THEME_FALLBACK;
}

/*
 * Why a status page write's theme cannot be saved, or null when it can:
 * one of the three, exactly as they are spelled, or nothing (no theme, which
 * is the light page). Spelled exactly, because a value written in another
 * case would read back differently from what a Terraform configuration
 * says, and plan a change on every run.
 */
export const STATUS_PAGE_THEME_PROBLEM: string =
  "Theme must be Light, Dark or System.";

export function getStatusPageThemeProblem(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return isStatusPageTheme(value) ? null : STATUS_PAGE_THEME_PROBLEM;
}

// Whether the page follows each visitor's device, and offers them a switch.
export function doesStatusPageThemeFollowDevice(
  theme: StatusPageTheme,
): boolean {
  return theme === StatusPageTheme.System;
}

// A visitor's own pick, as it was kept in their browser, or null for none.
export function parseStatusPageVisitorColorScheme(
  value: unknown,
): StatusPageColorScheme | null {
  if (value === "light" || value === "dark") {
    return value;
  }

  return null;
}

/**
 * The colour scheme a page is drawn in for one visitor: Light and Dark are
 * what they say, whatever the visitor's device or pick; System is the
 * visitor's own pick from the footer when they made one, and their device's
 * setting otherwise.
 */
export function getStatusPageColorScheme(data: {
  theme: StatusPageTheme;
  prefersDark: boolean;
  visitorChoice?: StatusPageColorScheme | null | undefined;
}): StatusPageColorScheme {
  if (data.theme === StatusPageTheme.Dark) {
    return STATUS_PAGE_DARK_SCHEME;
  }

  if (data.theme !== StatusPageTheme.System) {
    return STATUS_PAGE_LIGHT_SCHEME;
  }

  if (data.visitorChoice) {
    return data.visitorChoice;
  }

  return data.prefersDark ? STATUS_PAGE_DARK_SCHEME : STATUS_PAGE_LIGHT_SCHEME;
}

/*
 * What the server writes into the page's <head> for a theme, before any
 * script runs or any stylesheet loads (index.ejs):
 *
 *   - setting: the data-status-page-theme attribute on <html>, which the
 *     first script in <head> reads.
 *   - htmlClassName: the class <html> is sent with. A Dark page is dark in
 *     the HTML itself; a System page waits for the script, which is the
 *     only thing that can know the visitor's device and pick.
 *   - colorScheme: the color-scheme meta tag, which lets the browser paint
 *     its canvas, scrollbars and form controls in the right scheme before
 *     the page's CSS arrives: "light dark" for a page that follows the
 *     visitor.
 *   - themeColor: the theme-color meta tag the page is sent with. A System
 *     page is sent the light colour, and the script corrects it at once.
 */
/*
 * A type, not an interface, so it is a JSONObject: the servers hand it to
 * the template among their render variables.
 */
export type StatusPageThemeHead = {
  setting: StatusPageThemeHeadSetting;
  htmlClassName: string;
  colorScheme: string;
  themeColor: string;
};

export function getStatusPageThemeHead(
  theme: StatusPageTheme,
): StatusPageThemeHead {
  const setting: StatusPageThemeHeadSetting = HEAD_SETTING_BY_THEME[theme];

  if (setting === "dark") {
    return {
      setting,
      htmlClassName: "dark",
      colorScheme: "dark",
      themeColor: STATUS_PAGE_THEME_COLORS.dark,
    };
  }

  return {
    setting,
    htmlClassName: "",
    colorScheme: setting === "system" ? "light dark" : "light",
    themeColor: STATUS_PAGE_THEME_COLORS.light,
  };
}

/*
 * The variable the two servers that render a status page's HTML hand
 * index.ejs its theme in: what getStatusPageThemeHead returns. The template
 * draws the light page when it is not there.
 */
export const STATUS_PAGE_THEME_VIEW_VARIABLE: string = "statusPageTheme";

// The theme a <head> setting stands for (what the server put on <html>).
export function getStatusPageThemeFromHeadSetting(
  value: unknown,
): StatusPageTheme {
  for (const theme of STATUS_PAGE_THEMES) {
    if (HEAD_SETTING_BY_THEME[theme] === value) {
      return theme;
    }
  }

  return STATUS_PAGE_THEME_FALLBACK;
}
