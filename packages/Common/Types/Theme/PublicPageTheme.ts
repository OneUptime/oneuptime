/*
 * The theme of a page OneUptime shows to the public: a status page
 * (Types/StatusPage/StatusPageTheme.ts) and a dashboard shared through its
 * public link (Types/Dashboard/DashboardTheme.ts). How the page looks to the
 * people who visit it:
 *
 *   - Light: the light page.
 *   - Dark: a dark page.
 *   - System: light or dark, as each visitor's device is set (the
 *     prefers-color-scheme media feature), following a change while the page
 *     is open.
 *
 * The same three, spelled the same, on both kinds of page, and read and drawn
 * the same way: a value that cannot be read is the light page, the server
 * that renders the page's HTML writes the theme into its <head>
 * (getPublicPageThemeHead), and a script at the top of <head> works out the
 * colour scheme from it before any stylesheet loads, so a dark page never
 * flashes white. What a visitor may pick for themselves, and where their
 * browser keeps the pick, is each page's own (StatusPageTheme.ts,
 * DashboardTheme.ts).
 *
 * React-free: the API, the page servers, the templates' tests, both public
 * apps and the dashboard read it.
 */
enum PublicPageTheme {
  Light = "Light",
  Dark = "Dark",
  // Light or dark, as each visitor's device is set.
  System = "System",
}

export default PublicPageTheme;

export const PUBLIC_PAGE_THEMES: ReadonlyArray<PublicPageTheme> = [
  PublicPageTheme.Light,
  PublicPageTheme.Dark,
  PublicPageTheme.System,
];

/*
 * What a page that has no theme - one made before the setting, a column
 * left empty through the API - or one that cannot be read is drawn in: the
 * light page every public page was before the setting.
 */
export const PUBLIC_PAGE_THEME_FALLBACK: PublicPageTheme =
  PublicPageTheme.Light;

// The two ways a page is drawn.
export type PublicPageColorScheme = "light" | "dark";

export const PUBLIC_PAGE_LIGHT_SCHEME: PublicPageColorScheme = "light";
export const PUBLIC_PAGE_DARK_SCHEME: PublicPageColorScheme = "dark";

/*
 * The colour the browser draws its own chrome in around the page (the
 * theme-color meta tag): the page's own background in each scheme, the same
 * as the dashboard's (Common/UI/Utils/Theme.ts).
 */
export const PUBLIC_PAGE_THEME_COLORS: Readonly<
  Record<PublicPageColorScheme, string>
> = {
  light: "#f9fafb",
  dark: "#0f172a",
};

// The theme as the page's <head> spells it.
export type PublicPageThemeHeadSetting = "light" | "dark" | "system";

const HEAD_SETTING_BY_THEME: Readonly<
  Record<PublicPageTheme, PublicPageThemeHeadSetting>
> = {
  [PublicPageTheme.Light]: "light",
  [PublicPageTheme.Dark]: "dark",
  [PublicPageTheme.System]: "system",
};

export const PUBLIC_PAGE_THEME_HEAD_SETTINGS: ReadonlyArray<PublicPageThemeHeadSetting> =
  ["light", "dark", "system"];

// The theme as the page's <head> spells it: light, dark or system.
export function getPublicPageThemeHeadSetting(
  theme: PublicPageTheme,
): PublicPageThemeHeadSetting {
  return HEAD_SETTING_BY_THEME[theme];
}

// Whether a value is one of the three themes, exactly as they are stored.
export function isPublicPageTheme(value: unknown): value is PublicPageTheme {
  return (
    typeof value === "string" &&
    (PUBLIC_PAGE_THEMES as ReadonlyArray<string>).includes(value)
  );
}

/**
 * The theme a stored or sent value stands for. Anything that is not one of
 * the three - nothing at all, a value from an older or newer server, a typo -
 * is the light page, which is what every public page was before the setting:
 * a value that cannot be read never turns a page dark.
 */
export function parsePublicPageTheme(value: unknown): PublicPageTheme {
  return isPublicPageTheme(value) ? value : PUBLIC_PAGE_THEME_FALLBACK;
}

/*
 * Why a write's theme cannot be saved, or null when it can: one of the
 * three, exactly as they are spelled, or nothing (no theme, which is the
 * light page). Spelled exactly, because a value written in another case
 * would read back differently from what a Terraform configuration says, and
 * plan a change on every run.
 */
export const PUBLIC_PAGE_THEME_PROBLEM: string =
  "Theme must be Light, Dark or System.";

export function getPublicPageThemeProblem(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return isPublicPageTheme(value) ? null : PUBLIC_PAGE_THEME_PROBLEM;
}

// Whether the page follows each visitor's device.
export function doesPublicPageThemeFollowDevice(
  theme: PublicPageTheme,
): boolean {
  return theme === PublicPageTheme.System;
}

/*
 * Whether a visitor can ever see the page dark, without picking it
 * themselves: a Dark page, and a page that follows the device.
 */
export function canPublicPageThemeBeDark(theme: PublicPageTheme): boolean {
  return theme === PublicPageTheme.Dark || theme === PublicPageTheme.System;
}

// A visitor's own pick, as it was kept in their browser, or null for none.
export function parsePublicPageVisitorColorScheme(
  value: unknown,
): PublicPageColorScheme | null {
  if (value === "light" || value === "dark") {
    return value;
  }

  return null;
}

// The scheme a visitor's device asks for.
export function getDeviceColorScheme(
  prefersDark: boolean,
): PublicPageColorScheme {
  return prefersDark ? PUBLIC_PAGE_DARK_SCHEME : PUBLIC_PAGE_LIGHT_SCHEME;
}

/*
 * The scheme a theme draws the page in, before any pick of the visitor's:
 * Light and Dark are what they say, System is the visitor's device.
 */
export function getPublicPageThemeColorScheme(data: {
  theme: PublicPageTheme;
  prefersDark: boolean;
}): PublicPageColorScheme {
  if (data.theme === PublicPageTheme.Dark) {
    return PUBLIC_PAGE_DARK_SCHEME;
  }

  if (data.theme === PublicPageTheme.System) {
    return getDeviceColorScheme(data.prefersDark);
  }

  return PUBLIC_PAGE_LIGHT_SCHEME;
}

/*
 * What the server writes into the page's <head> for a theme, before any
 * script runs or any stylesheet loads:
 *
 *   - setting: the theme attribute on <html>, which the first script in
 *     <head> reads.
 *   - htmlClassName: the class <html> is sent with. A Dark page is dark in
 *     the HTML itself; a System page waits for the script, which is the
 *     only thing that can know the visitor's device and pick.
 *   - colorScheme: the color-scheme meta tag, which lets the browser paint
 *     its canvas, scrollbars and form controls in the right scheme before
 *     the page's CSS arrives: "light dark" for a page that follows the
 *     visitor.
 *   - themeColor: the theme-color meta tag the page is sent with. A System
 *     page is sent the light colour, and the script corrects it at once.
 *
 * A type, not an interface, so it is a JSONObject: the servers hand it to
 * the template among their render variables.
 */
export type PublicPageThemeHead = {
  setting: PublicPageThemeHeadSetting;
  htmlClassName: string;
  colorScheme: string;
  themeColor: string;
};

export function getPublicPageThemeHead(
  theme: PublicPageTheme,
): PublicPageThemeHead {
  const setting: PublicPageThemeHeadSetting =
    getPublicPageThemeHeadSetting(theme);

  if (setting === "dark") {
    return {
      setting,
      htmlClassName: "dark",
      colorScheme: "dark",
      themeColor: PUBLIC_PAGE_THEME_COLORS.dark,
    };
  }

  return {
    setting,
    htmlClassName: "",
    colorScheme: setting === "system" ? "light dark" : "light",
    themeColor: PUBLIC_PAGE_THEME_COLORS.light,
  };
}

// The theme a <head> setting stands for (what the server put on <html>).
export function getPublicPageThemeFromHeadSetting(
  value: unknown,
): PublicPageTheme {
  for (const theme of PUBLIC_PAGE_THEMES) {
    if (HEAD_SETTING_BY_THEME[theme] === value) {
      return theme;
    }
  }

  return PUBLIC_PAGE_THEME_FALLBACK;
}
