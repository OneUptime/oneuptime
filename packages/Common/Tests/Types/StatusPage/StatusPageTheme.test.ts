/**
 * A status page's theme: what each stored value means, what a page with no
 * theme or an unreadable one is drawn in, how one visitor's scheme is worked
 * out, and what the servers write into the page's <head> for each theme.
 *
 * The <head> half is what keeps a dark page from flashing white: index.ejs
 * draws the page from these values before any script or stylesheet runs
 * (Common/Tests/App/StatusPage/StatusPageIndexTheme.test.ts renders it).
 */

import StatusPageTheme, {
  NEW_STATUS_PAGE_THEME,
  STATUS_PAGE_DARK_SCHEME,
  STATUS_PAGE_LIGHT_SCHEME,
  STATUS_PAGE_THEMES,
  STATUS_PAGE_THEME_ATTRIBUTE,
  STATUS_PAGE_THEME_COLORS,
  STATUS_PAGE_THEME_COLUMN,
  STATUS_PAGE_THEME_FALLBACK,
  STATUS_PAGE_THEME_HEAD_SETTINGS,
  STATUS_PAGE_THEME_PROBLEM,
  STATUS_PAGE_THEME_VIEW_VARIABLE,
  STATUS_PAGE_VISITOR_THEME_STORAGE_KEY,
  StatusPageColorScheme,
  StatusPageThemeHead,
  doesStatusPageThemeFollowDevice,
  getStatusPageColorScheme,
  getStatusPageThemeFromHeadSetting,
  getStatusPageThemeHead,
  getStatusPageThemeProblem,
  isStatusPageTheme,
  parseStatusPageTheme,
  parseStatusPageVisitorColorScheme,
} from "../../../Types/StatusPage/StatusPageTheme";
import { describe, expect, test } from "@jest/globals";

describe("the three themes", () => {
  test("are Light, Dark and System, stored as those exact words", () => {
    expect(STATUS_PAGE_THEMES).toEqual(["Light", "Dark", "System"]);
    expect(StatusPageTheme.Light).toBe("Light");
    expect(StatusPageTheme.Dark).toBe("Dark");
    expect(StatusPageTheme.System).toBe("System");
  });

  test("live in the status page's theme column", () => {
    expect(STATUS_PAGE_THEME_COLUMN).toBe("theme");
  });

  test("a page made before the setting, or with a theme nobody can read, is the light page it always was", () => {
    expect(STATUS_PAGE_THEME_FALLBACK).toBe(StatusPageTheme.Light);
  });

  test("a page made from now on follows each visitor's device", () => {
    expect(NEW_STATUS_PAGE_THEME).toBe(StatusPageTheme.System);
  });

  test("only System follows the visitor's device and offers them a switch", () => {
    expect(doesStatusPageThemeFollowDevice(StatusPageTheme.System)).toBe(true);
    expect(doesStatusPageThemeFollowDevice(StatusPageTheme.Light)).toBe(false);
    expect(doesStatusPageThemeFollowDevice(StatusPageTheme.Dark)).toBe(false);
  });
});

describe("reading a stored or sent theme", () => {
  test.each(
    STATUS_PAGE_THEMES.map((theme: StatusPageTheme): Array<StatusPageTheme> => {
      return [theme];
    }),
  )("%s reads as itself", (theme: StatusPageTheme) => {
    expect(isStatusPageTheme(theme)).toBe(true);
    expect(parseStatusPageTheme(theme)).toBe(theme);
  });

  test.each([
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
  ])(
    "%s is the light page, never a dark one",
    (_what: string, value: unknown) => {
      expect(isStatusPageTheme(value)).toBe(false);
      expect(parseStatusPageTheme(value)).toBe(StatusPageTheme.Light);
    },
  );
});

describe("what a write may hold", () => {
  test.each(
    STATUS_PAGE_THEMES.map((theme: StatusPageTheme): Array<StatusPageTheme> => {
      return [theme];
    }),
  )("%s is saved", (theme: StatusPageTheme) => {
    expect(getStatusPageThemeProblem(theme)).toBeNull();
  });

  test("no theme at all is saved: the page is the light one", () => {
    expect(getStatusPageThemeProblem(undefined)).toBeNull();
    expect(getStatusPageThemeProblem(null)).toBeNull();
  });

  test.each([
    [
      "another case, which a Terraform plan would read back as a change",
      "dark",
    ],
    ["an empty string", ""],
    ["a padded value", " Light"],
    ["an unknown theme", "Sepia"],
    ["a number", 2],
    ["an object", { value: "Dark" }],
  ])("%s is refused, naming the three", (_what: string, value: unknown) => {
    expect(getStatusPageThemeProblem(value)).toBe(STATUS_PAGE_THEME_PROBLEM);
  });

  test("the refusal names every theme", () => {
    for (const theme of STATUS_PAGE_THEMES) {
      expect(STATUS_PAGE_THEME_PROBLEM).toContain(theme);
    }
  });
});

describe("the scheme one visitor sees", () => {
  const visitorChoices: Array<StatusPageColorScheme | null> = [
    null,
    STATUS_PAGE_LIGHT_SCHEME,
    STATUS_PAGE_DARK_SCHEME,
  ];

  test("Light is light, whatever the device or the visitor's pick", () => {
    for (const prefersDark of [false, true]) {
      for (const visitorChoice of visitorChoices) {
        expect(
          getStatusPageColorScheme({
            theme: StatusPageTheme.Light,
            prefersDark,
            visitorChoice,
          }),
        ).toBe("light");
      }
    }
  });

  test("Dark is dark, whatever the device or the visitor's pick", () => {
    for (const prefersDark of [false, true]) {
      for (const visitorChoice of visitorChoices) {
        expect(
          getStatusPageColorScheme({
            theme: StatusPageTheme.Dark,
            prefersDark,
            visitorChoice,
          }),
        ).toBe("dark");
      }
    }
  });

  test("System follows the device when the visitor picked nothing", () => {
    expect(
      getStatusPageColorScheme({
        theme: StatusPageTheme.System,
        prefersDark: true,
      }),
    ).toBe("dark");
    expect(
      getStatusPageColorScheme({
        theme: StatusPageTheme.System,
        prefersDark: false,
        visitorChoice: null,
      }),
    ).toBe("light");
  });

  test("System follows the visitor's own pick over the device", () => {
    expect(
      getStatusPageColorScheme({
        theme: StatusPageTheme.System,
        prefersDark: true,
        visitorChoice: STATUS_PAGE_LIGHT_SCHEME,
      }),
    ).toBe("light");
    expect(
      getStatusPageColorScheme({
        theme: StatusPageTheme.System,
        prefersDark: false,
        visitorChoice: STATUS_PAGE_DARK_SCHEME,
      }),
    ).toBe("dark");
  });

  test("a visitor's pick is read back only when it is light or dark", () => {
    expect(parseStatusPageVisitorColorScheme("light")).toBe("light");
    expect(parseStatusPageVisitorColorScheme("dark")).toBe("dark");

    for (const value of [null, undefined, "", "Dark", "system", "auto", 1]) {
      expect(parseStatusPageVisitorColorScheme(value)).toBeNull();
    }
  });

  test("a visitor's pick is kept under one key for every page of an origin", () => {
    expect(STATUS_PAGE_VISITOR_THEME_STORAGE_KEY).toBe(
      "oneuptime-status-page-theme",
    );
  });
});

describe("what the page's <head> is sent with", () => {
  test("Light: no dark class, a light color-scheme and the light page's colour", () => {
    expect(getStatusPageThemeHead(StatusPageTheme.Light)).toEqual({
      setting: "light",
      htmlClassName: "",
      colorScheme: "light",
      themeColor: "#f9fafb",
    });
  });

  test("Dark: dark in the HTML itself, before any script runs", () => {
    expect(getStatusPageThemeHead(StatusPageTheme.Dark)).toEqual({
      setting: "dark",
      htmlClassName: "dark",
      colorScheme: "dark",
      themeColor: "#0f172a",
    });
  });

  test("System: the browser may draw either scheme until the script settles it", () => {
    expect(getStatusPageThemeHead(StatusPageTheme.System)).toEqual({
      setting: "system",
      htmlClassName: "",
      colorScheme: "light dark",
      themeColor: "#f9fafb",
    });
  });

  test("every theme has its own head setting, which reads back as the theme", () => {
    const settings: Array<string> = STATUS_PAGE_THEMES.map(
      (theme: StatusPageTheme): string => {
        return getStatusPageThemeHead(theme).setting;
      },
    );

    expect(settings).toEqual([...STATUS_PAGE_THEME_HEAD_SETTINGS]);

    for (const theme of STATUS_PAGE_THEMES) {
      const head: StatusPageThemeHead = getStatusPageThemeHead(theme);
      expect(getStatusPageThemeFromHeadSetting(head.setting)).toBe(theme);
    }
  });

  test.each([null, undefined, "", "Dark", "auto", "LIGHT"])(
    "a head setting of %p reads as the light page",
    (value: unknown) => {
      expect(getStatusPageThemeFromHeadSetting(value)).toBe(
        StatusPageTheme.Light,
      );
    },
  );

  test("the browser's chrome takes the page's own background in each scheme, as the dashboard's does", () => {
    expect(STATUS_PAGE_THEME_COLORS).toEqual({
      light: "#f9fafb",
      dark: "#0f172a",
    });
  });

  test("the attribute and the template variable keep their names", () => {
    /*
     * index.ejs, both page servers and the app read these by name; a rename
     * here that missed one of them would leave a page light.
     */
    expect(STATUS_PAGE_THEME_ATTRIBUTE).toBe("data-status-page-theme");
    expect(STATUS_PAGE_THEME_VIEW_VARIABLE).toBe("statusPageTheme");
  });

  test("a head is a plain object a server can hand a template", () => {
    for (const theme of STATUS_PAGE_THEMES) {
      const head: StatusPageThemeHead = getStatusPageThemeHead(theme);

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
