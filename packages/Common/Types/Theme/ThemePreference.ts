/*
 * The theme of the pages that are a person's own, on one browser: the
 * Dashboard, the Admin Dashboard, the sign-in pages (Accounts) and the pages
 * the server draws on the way in - a sign-in message, an on-call
 * acknowledgement.
 *
 *   - The person picks Light, Dark or System in the Dashboard's user menu, or
 *     the Admin Dashboard's. System is light or dark as their device is set
 *     (the prefers-color-scheme media feature), and follows a change while a
 *     page is open.
 *   - The pick is kept in the browser under THEME_STORAGE_KEY. Every page on
 *     this address reads the same key, so a pick made in the Dashboard is the
 *     sign-in page's too.
 *   - A browser where nobody has picked - a first visit, a new device, storage
 *     cleared or blocked - is System: the page follows the device. Light and
 *     Dark picks saved before System existed are kept as they are.
 *   - The first script in each page's <head> (Common/Server/Views/Partials/
 *     Theme.ejs, and the Dashboard's offline page) works the theme out with
 *     these same rules before the first paint, so a page never opens in the
 *     wrong one. Common/UI/Utils/Theme.ts keeps it there while the page is
 *     open.
 *
 * Status pages and public dashboards are not a person's own: each is drawn in
 * the theme its owner set (Types/Theme/PublicPageTheme.ts).
 *
 * React-free: the head script's tests, the docs' tests and every frontend
 * read it.
 */

// How a page is drawn: the two schemes, as the dark class and data-theme say.
export enum Theme {
  Light = "light",
  Dark = "dark",
}

// What the person picked, as their browser keeps it.
export enum ThemePreference {
  Light = "light",
  Dark = "dark",
  // Light or dark, as the person's device is set.
  System = "system",
}

// The choices, in the order the user menu offers them.
export const THEME_PREFERENCES: ReadonlyArray<ThemePreference> = [
  ThemePreference.Light,
  ThemePreference.Dark,
  ThemePreference.System,
];

/*
 * What a browser where nobody has picked is drawn in: as the device is set,
 * the way the mobile app, a new status page and a new public dashboard start.
 */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = ThemePreference.System;

/*
 * Where the browser keeps the pick. Named for the Dashboard, where the pick
 * was first made; every browser that has one keeps it under this name, so
 * it stays.
 */
export const THEME_STORAGE_KEY: string = "oneuptime-dashboard-theme";

// The media query that says the device is set to dark.
export const DARK_COLOR_SCHEME_MEDIA_QUERY: string =
  "(prefers-color-scheme: dark)";

/*
 * The colour the browser draws its own chrome in around the page (the
 * theme-color meta tag): the page's own background in each theme, the same
 * as a status page's (Types/Theme/PublicPageTheme.ts).
 */
export const THEME_COLORS: Readonly<Record<Theme, string>> = {
  [Theme.Light]: "#f9fafb",
  [Theme.Dark]: "#0f172a",
};

// Whether a value is one of the three picks, exactly as the browser keeps it.
export function isThemePreference(value: unknown): value is ThemePreference {
  return (
    typeof value === "string" &&
    (THEME_PREFERENCES as ReadonlyArray<string>).includes(value)
  );
}

/**
 * The pick a kept value stands for. Anything else - nothing at all, a value
 * an older or newer version wrote, a value typed into the browser's tools -
 * is no pick, so the page follows the device.
 */
export function parseThemePreference(value: unknown): ThemePreference {
  return isThemePreference(value) ? value : DEFAULT_THEME_PREFERENCE;
}

// The theme a pick draws the page in, on a device that is set one way.
export function getThemeForPreference(data: {
  preference: ThemePreference;
  prefersDark: boolean;
}): Theme {
  if (data.preference === ThemePreference.Dark) {
    return Theme.Dark;
  }

  if (data.preference === ThemePreference.System) {
    return data.prefersDark ? Theme.Dark : Theme.Light;
  }

  return Theme.Light;
}

// Whether a page drawn for this pick changes when the device does.
export function doesThemePreferenceFollowDevice(
  preference: ThemePreference,
): boolean {
  return preference === ThemePreference.System;
}
