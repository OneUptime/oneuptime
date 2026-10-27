import {
  DARK_COLOR_SCHEME_MEDIA_QUERY,
  DEFAULT_THEME_PREFERENCE,
  THEME_COLORS,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  Theme,
  ThemePreference,
  doesThemePreferenceFollowDevice,
  getThemeForPreference,
  isThemePreference,
  parseThemePreference,
} from "../../../Types/Theme/ThemePreference";
import { PUBLIC_PAGE_THEME_COLORS } from "../../../Types/Theme/PublicPageTheme";
import { describe, expect, it } from "@jest/globals";

/*
 * The person's theme, as every page of theirs works it out: what they
 * picked (Light, Dark or System), kept in their browser, and System - the
 * device decides - when they picked nothing.
 */

describe("the three picks", () => {
  it("are Light, Dark and System, spelled as the browser keeps them, in the user menu's order", () => {
    expect(THEME_PREFERENCES).toEqual(["light", "dark", "system"]);
    expect(ThemePreference.Light).toBe("light");
    expect(ThemePreference.Dark).toBe("dark");
    expect(ThemePreference.System).toBe("system");
  });

  it("start a browser where nobody picked at System: the device decides", () => {
    expect(DEFAULT_THEME_PREFERENCE).toBe(ThemePreference.System);
  });

  it("are kept under the key every browser that has a pick already keeps it under", () => {
    /*
     * Changing it would drop every pick made since the dark theme shipped:
     * the Dashboard and the Admin Dashboard have saved "dark" here since.
     */
    expect(THEME_STORAGE_KEY).toBe("oneuptime-dashboard-theme");
  });

  it("ask the device with the standard media query", () => {
    expect(DARK_COLOR_SCHEME_MEDIA_QUERY).toBe("(prefers-color-scheme: dark)");
  });

  it("paint the browser's chrome in each theme's own background, the same as a status page's", () => {
    expect(THEME_COLORS).toEqual({ light: "#f9fafb", dark: "#0f172a" });
    expect(THEME_COLORS[Theme.Light]).toBe(PUBLIC_PAGE_THEME_COLORS.light);
    expect(THEME_COLORS[Theme.Dark]).toBe(PUBLIC_PAGE_THEME_COLORS.dark);
  });
});

describe("reading what the browser kept", () => {
  it.each([
    ["light", ThemePreference.Light],
    ["dark", ThemePreference.Dark],
    ["system", ThemePreference.System],
  ])("keeps %p as it was picked", (kept: string, pick: ThemePreference) => {
    expect(isThemePreference(kept)).toBe(true);
    expect(parseThemePreference(kept)).toBe(pick);
  });

  it.each([
    null,
    undefined,
    "",
    "Dark",
    "DARK",
    " dark ",
    "Light",
    "System",
    "auto",
    "night",
    "true",
    1,
    true,
    {},
    ["dark"],
  ])(
    "reads %p as no pick, so the device decides",
    (kept: unknown) => {
      expect(isThemePreference(kept)).toBe(false);
      expect(parseThemePreference(kept)).toBe(ThemePreference.System);
    },
  );
});

describe("the theme a pick draws", () => {
  it.each([
    [ThemePreference.Light, false, Theme.Light],
    [ThemePreference.Light, true, Theme.Light],
    [ThemePreference.Dark, false, Theme.Dark],
    [ThemePreference.Dark, true, Theme.Dark],
    [ThemePreference.System, false, Theme.Light],
    [ThemePreference.System, true, Theme.Dark],
  ])(
    "%s on a device that prefers dark: %p draws %s",
    (preference: ThemePreference, prefersDark: boolean, theme: Theme) => {
      expect(getThemeForPreference({ preference, prefersDark })).toBe(theme);
    },
  );

  it("follows the device only for System: Light and Dark are what they say", () => {
    expect(doesThemePreferenceFollowDevice(ThemePreference.System)).toBe(true);
    expect(doesThemePreferenceFollowDevice(ThemePreference.Light)).toBe(false);
    expect(doesThemePreferenceFollowDevice(ThemePreference.Dark)).toBe(false);
  });

  it("draws a browser that kept nothing as its device is set", () => {
    for (const prefersDark of [false, true]) {
      expect(
        getThemeForPreference({
          preference: parseThemePreference(null),
          prefersDark,
        }),
      ).toBe(prefersDark ? Theme.Dark : Theme.Light);
    }
  });
});
