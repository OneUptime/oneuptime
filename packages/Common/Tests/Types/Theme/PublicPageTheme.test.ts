/**
 * The theme every public page shares - a status page and a dashboard's
 * public link (Types/Theme/PublicPageTheme.ts): the three themes, how a
 * stored or sent value is read, what a write may hold, the scheme a theme
 * draws before any pick of the visitor's, and what a page's <head> is sent
 * with.
 *
 * Each kind of page re-exports these under its own names, with its own
 * column, storage key and attribute (StatusPageTheme.test.ts,
 * DashboardTheme.test.ts). This holds the shared half once, and that both
 * kinds of page really are reading the same enum and the same rules: a
 * status page's Dark and a dashboard's Dark are one value, stored and
 * spelled the same.
 */

import PublicPageTheme, {
  PUBLIC_PAGE_DARK_SCHEME,
  PUBLIC_PAGE_LIGHT_SCHEME,
  PUBLIC_PAGE_THEMES,
  PUBLIC_PAGE_THEME_COLORS,
  PUBLIC_PAGE_THEME_FALLBACK,
  PUBLIC_PAGE_THEME_HEAD_SETTINGS,
  PUBLIC_PAGE_THEME_PROBLEM,
  PublicPageColorScheme,
  PublicPageThemeHead,
  canPublicPageThemeBeDark,
  doesPublicPageThemeFollowDevice,
  getDeviceColorScheme,
  getPublicPageThemeColorScheme,
  getPublicPageThemeFromHeadSetting,
  getPublicPageThemeHead,
  getPublicPageThemeHeadSetting,
  getPublicPageThemeProblem,
  isPublicPageTheme,
  parsePublicPageTheme,
  parsePublicPageVisitorColorScheme,
} from "../../../Types/Theme/PublicPageTheme";
import StatusPageTheme, {
  STATUS_PAGE_THEMES,
  STATUS_PAGE_THEME_PROBLEM,
  getStatusPageThemeHead,
  parseStatusPageTheme,
} from "../../../Types/StatusPage/StatusPageTheme";
import DashboardTheme, {
  DASHBOARD_THEMES,
  DASHBOARD_THEME_PROBLEM,
  getDashboardThemeHead,
  parseDashboardTheme,
} from "../../../Types/Dashboard/DashboardTheme";
import { describe, expect, test } from "@jest/globals";

const UNREADABLE_VALUES: Array<[string, unknown]> = [
  ["nothing", undefined],
  ["null", null],
  ["an empty string", ""],
  ["another case", "dark"],
  ["shouted", "DARK"],
  ["padded", " Dark "],
  ["a theme from a newer server", "High Contrast"],
  ["the head's spelling", "system"],
  ["a number", 1],
  ["a boolean", true],
  ["an object", { theme: "Dark" }],
  ["an array", ["Dark"]],
];

describe("the three themes", () => {
  test("are Light, Dark and System, stored as those exact words", () => {
    expect(PUBLIC_PAGE_THEMES).toEqual(["Light", "Dark", "System"]);
    expect(PublicPageTheme.Light).toBe("Light");
    expect(PublicPageTheme.Dark).toBe("Dark");
    expect(PublicPageTheme.System).toBe("System");
  });

  test("are the very ones a status page and a public dashboard store", () => {
    expect(StatusPageTheme).toBe(PublicPageTheme);
    expect(DashboardTheme).toBe(PublicPageTheme);
    expect(STATUS_PAGE_THEMES).toEqual(PUBLIC_PAGE_THEMES);
    expect(DASHBOARD_THEMES).toEqual(PUBLIC_PAGE_THEMES);
  });

  test("a page with no theme, or one nobody can read, is the light page", () => {
    expect(PUBLIC_PAGE_THEME_FALLBACK).toBe(PublicPageTheme.Light);
  });

  test("only System follows the visitor's device", () => {
    expect(doesPublicPageThemeFollowDevice(PublicPageTheme.System)).toBe(true);
    expect(doesPublicPageThemeFollowDevice(PublicPageTheme.Light)).toBe(false);
    expect(doesPublicPageThemeFollowDevice(PublicPageTheme.Dark)).toBe(false);
  });

  test("Dark and System can be dark without a visitor's pick, Light never", () => {
    expect(canPublicPageThemeBeDark(PublicPageTheme.Dark)).toBe(true);
    expect(canPublicPageThemeBeDark(PublicPageTheme.System)).toBe(true);
    expect(canPublicPageThemeBeDark(PublicPageTheme.Light)).toBe(false);
  });
});

describe("reading a stored or sent theme", () => {
  test.each(
    PUBLIC_PAGE_THEMES.map((theme: PublicPageTheme): Array<PublicPageTheme> => {
      return [theme];
    }),
  )("%s reads as itself, on both kinds of page", (theme: PublicPageTheme) => {
    expect(isPublicPageTheme(theme)).toBe(true);
    expect(parsePublicPageTheme(theme)).toBe(theme);
    expect(parseStatusPageTheme(theme)).toBe(theme);
    expect(parseDashboardTheme(theme)).toBe(theme);
  });

  test.each(UNREADABLE_VALUES)(
    "%s is the light page, never a dark one, on both kinds of page",
    (_what: string, value: unknown) => {
      expect(isPublicPageTheme(value)).toBe(false);
      expect(parsePublicPageTheme(value)).toBe(PublicPageTheme.Light);
      expect(parseStatusPageTheme(value)).toBe(PublicPageTheme.Light);
      expect(parseDashboardTheme(value)).toBe(PublicPageTheme.Light);
    },
  );
});

describe("what a write may hold", () => {
  test.each(
    PUBLIC_PAGE_THEMES.map((theme: PublicPageTheme): Array<PublicPageTheme> => {
      return [theme];
    }),
  )("%s is saved", (theme: PublicPageTheme) => {
    expect(getPublicPageThemeProblem(theme)).toBeNull();
  });

  test("no theme at all is saved: the page is the light one", () => {
    expect(getPublicPageThemeProblem(undefined)).toBeNull();
    expect(getPublicPageThemeProblem(null)).toBeNull();
  });

  test.each([
    ["another case, which a Terraform plan would read back as a change", "dark"],
    ["an empty string", ""],
    ["a padded value", " Light"],
    ["an unknown theme", "Sepia"],
    ["a number", 2],
    ["an object", { value: "Dark" }],
  ])("%s is refused, naming the three", (_what: string, value: unknown) => {
    expect(getPublicPageThemeProblem(value)).toBe(PUBLIC_PAGE_THEME_PROBLEM);
  });

  test("the refusal names every theme, in the same words on both kinds of page", () => {
    for (const theme of PUBLIC_PAGE_THEMES) {
      expect(PUBLIC_PAGE_THEME_PROBLEM).toContain(theme);
    }

    expect(STATUS_PAGE_THEME_PROBLEM).toBe(PUBLIC_PAGE_THEME_PROBLEM);
    expect(DASHBOARD_THEME_PROBLEM).toBe(PUBLIC_PAGE_THEME_PROBLEM);
  });
});

describe("the scheme a theme draws, before any pick of the visitor's", () => {
  test("Light is light and Dark is dark, whatever the device", () => {
    for (const prefersDark of [false, true]) {
      expect(
        getPublicPageThemeColorScheme({
          theme: PublicPageTheme.Light,
          prefersDark,
        }),
      ).toBe("light");
      expect(
        getPublicPageThemeColorScheme({
          theme: PublicPageTheme.Dark,
          prefersDark,
        }),
      ).toBe("dark");
    }
  });

  test("System is the device's", () => {
    expect(
      getPublicPageThemeColorScheme({
        theme: PublicPageTheme.System,
        prefersDark: true,
      }),
    ).toBe("dark");
    expect(
      getPublicPageThemeColorScheme({
        theme: PublicPageTheme.System,
        prefersDark: false,
      }),
    ).toBe("light");
  });

  test("the device's scheme is dark only when it asks for dark", () => {
    expect(getDeviceColorScheme(true)).toBe(PUBLIC_PAGE_DARK_SCHEME);
    expect(getDeviceColorScheme(false)).toBe(PUBLIC_PAGE_LIGHT_SCHEME);
  });

  test("a visitor's pick is read back only when it is light or dark", () => {
    expect(parsePublicPageVisitorColorScheme("light")).toBe("light");
    expect(parsePublicPageVisitorColorScheme("dark")).toBe("dark");

    for (const value of [null, undefined, "", "Dark", "system", "auto", 1]) {
      expect(parsePublicPageVisitorColorScheme(value)).toBeNull();
    }
  });
});

describe("what a page's <head> is sent with", () => {
  test("Light: no dark class, a light color-scheme and the light page's colour", () => {
    expect(getPublicPageThemeHead(PublicPageTheme.Light)).toEqual({
      setting: "light",
      htmlClassName: "",
      colorScheme: "light",
      themeColor: "#f9fafb",
    });
  });

  test("Dark: dark in the HTML itself, before any script runs", () => {
    expect(getPublicPageThemeHead(PublicPageTheme.Dark)).toEqual({
      setting: "dark",
      htmlClassName: "dark",
      colorScheme: "dark",
      themeColor: "#0f172a",
    });
  });

  test("System: the browser may draw either scheme until the script settles it", () => {
    expect(getPublicPageThemeHead(PublicPageTheme.System)).toEqual({
      setting: "system",
      htmlClassName: "",
      colorScheme: "light dark",
      themeColor: "#f9fafb",
    });
  });

  test("both kinds of page are sent the same head for the same theme", () => {
    for (const theme of PUBLIC_PAGE_THEMES) {
      expect(getStatusPageThemeHead(theme)).toEqual(
        getPublicPageThemeHead(theme),
      );
      expect(getDashboardThemeHead(theme)).toEqual(
        getPublicPageThemeHead(theme),
      );
    }
  });

  test("every theme has its own head setting, which reads back as the theme", () => {
    const settings: Array<string> = PUBLIC_PAGE_THEMES.map(
      (theme: PublicPageTheme): string => {
        return getPublicPageThemeHead(theme).setting;
      },
    );

    expect(settings).toEqual([...PUBLIC_PAGE_THEME_HEAD_SETTINGS]);

    for (const theme of PUBLIC_PAGE_THEMES) {
      const head: PublicPageThemeHead = getPublicPageThemeHead(theme);

      expect(getPublicPageThemeHeadSetting(theme)).toBe(head.setting);
      expect(getPublicPageThemeFromHeadSetting(head.setting)).toBe(theme);
    }
  });

  test.each([null, undefined, "", "Dark", "auto", "LIGHT"])(
    "a head setting of %p reads as the light page",
    (value: unknown) => {
      expect(getPublicPageThemeFromHeadSetting(value)).toBe(
        PublicPageTheme.Light,
      );
    },
  );

  test("the browser's chrome takes the page's own background in each scheme", () => {
    expect(PUBLIC_PAGE_THEME_COLORS).toEqual({
      light: "#f9fafb",
      dark: "#0f172a",
    });

    for (const theme of PUBLIC_PAGE_THEMES) {
      const head: PublicPageThemeHead = getPublicPageThemeHead(theme);
      const scheme: PublicPageColorScheme =
        head.htmlClassName === "dark" ? "dark" : "light";

      expect(head.themeColor).toBe(PUBLIC_PAGE_THEME_COLORS[scheme]);
    }
  });

  test("a head is a plain object a server can hand a template", () => {
    for (const theme of PUBLIC_PAGE_THEMES) {
      const head: PublicPageThemeHead = getPublicPageThemeHead(theme);

      expect(JSON.parse(JSON.stringify(head))).toEqual(head);
      expect(Object.keys(head).sort()).toEqual([
        "colorScheme",
        "htmlClassName",
        "setting",
        "themeColor",
      ]);
    }
  });
});
