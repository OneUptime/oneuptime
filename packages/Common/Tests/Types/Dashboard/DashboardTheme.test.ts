/**
 * A public dashboard's theme (Types/Dashboard/DashboardTheme.ts): its
 * column and defaults, a visitor's own pick, the theme a link can name, the
 * scheme one visitor sees, and what the page's <head> is sent with.
 *
 * The scheme is decided by the first of these that says - the link's own
 * ?theme=, the visitor's pick from the toolbar, the dashboard's theme - and
 * a page that knows no dashboard's theme follows the visitor. The whole
 * table is walked here, every theme against every device, pick and link,
 * so a change to one rule cannot quietly move another.
 *
 * The template's first script has to decide the same, before any of this
 * code loads: Common/Tests/App/PublicDashboard/PublicDashboardIndexTheme
 * .test.ts runs the real script over the same table.
 */

import DashboardTheme, {
  DASHBOARD_DARK_SCHEME,
  DASHBOARD_LIGHT_SCHEME,
  DASHBOARD_THEMES,
  DASHBOARD_THEME_ATTRIBUTE,
  DASHBOARD_THEME_COLORS,
  DASHBOARD_THEME_COLUMN,
  DASHBOARD_THEME_FALLBACK,
  DASHBOARD_THEME_LINK_PARAMETER,
  DASHBOARD_THEME_PROBLEM,
  DASHBOARD_THEME_VIEW_VARIABLE,
  DASHBOARD_VISITOR_THEME_AUTO,
  DASHBOARD_VISITOR_THEME_CHOICES,
  DASHBOARD_VISITOR_THEME_STORAGE_KEY,
  DashboardColorScheme,
  DashboardLinkTheme,
  DashboardThemeHead,
  NEW_DASHBOARD_THEME,
  UNKNOWN_DASHBOARD_THEME,
  getDashboardColorScheme,
  getDashboardLinkThemeFromSearch,
  getDashboardThemeHead,
  getDashboardThemeProblem,
  getDashboardVisitorThemeChoice,
  isDashboardTheme,
  parseDashboardLinkTheme,
  parseDashboardTheme,
  parseDashboardVisitorColorScheme,
} from "../../../Types/Dashboard/DashboardTheme";
import {
  STATUS_PAGE_THEME_ATTRIBUTE,
  STATUS_PAGE_VISITOR_THEME_STORAGE_KEY,
} from "../../../Types/StatusPage/StatusPageTheme";
import { describe, expect, test } from "@jest/globals";

const SCHEMES: Array<DashboardColorScheme> = ["light", "dark"];
const PICKS: Array<DashboardColorScheme | null> = [null, "light", "dark"];
const LINKS: Array<DashboardLinkTheme | null> = [
  null,
  "light",
  "dark",
  "system",
];

describe("the three themes", () => {
  test("are Light, Dark and System, in the dashboard's theme column", () => {
    expect(DASHBOARD_THEMES).toEqual(["Light", "Dark", "System"]);
    expect(DASHBOARD_THEME_COLUMN).toBe("theme");
  });

  test("a dashboard made before the setting, or with a theme nobody can read, is the light page it always was", () => {
    expect(DASHBOARD_THEME_FALLBACK).toBe(DashboardTheme.Light);
    expect(parseDashboardTheme(undefined)).toBe(DashboardTheme.Light);
    expect(parseDashboardTheme("Midnight")).toBe(DashboardTheme.Light);
  });

  test("a dashboard made from now on follows each visitor's device, as a new status page does", () => {
    expect(NEW_DASHBOARD_THEME).toBe(DashboardTheme.System);
  });

  test("a page that knows no dashboard's theme follows the visitor", () => {
    expect(UNKNOWN_DASHBOARD_THEME).toBe(DashboardTheme.System);
  });

  test("a write may hold one of the three, exactly, or nothing", () => {
    for (const theme of DASHBOARD_THEMES) {
      expect(isDashboardTheme(theme)).toBe(true);
      expect(getDashboardThemeProblem(theme)).toBeNull();
    }

    expect(getDashboardThemeProblem(null)).toBeNull();
    expect(getDashboardThemeProblem(undefined)).toBeNull();

    for (const value of ["light", "DARK", " System", "Auto", "", 0, {}]) {
      expect(getDashboardThemeProblem(value)).toBe(DASHBOARD_THEME_PROBLEM);
    }

    expect(DASHBOARD_THEME_PROBLEM).toBe(
      "Theme must be Light, Dark or System.",
    );
  });
});

describe("a visitor's own pick", () => {
  test("is Light, Dark or Auto, in that order", () => {
    expect(DASHBOARD_VISITOR_THEME_CHOICES).toEqual(["light", "dark", "auto"]);
    expect(DASHBOARD_VISITOR_THEME_AUTO).toBe("auto");
  });

  test("is read back only when it is light or dark: Auto is no pick at all", () => {
    expect(parseDashboardVisitorColorScheme("light")).toBe("light");
    expect(parseDashboardVisitorColorScheme("dark")).toBe("dark");

    for (const value of [
      null,
      undefined,
      "",
      "auto",
      "Dark",
      "system",
      "Light ",
      1,
      true,
    ]) {
      expect(parseDashboardVisitorColorScheme(value)).toBeNull();
    }
  });

  test("shows as Auto when there is none, and as itself otherwise", () => {
    expect(getDashboardVisitorThemeChoice(null)).toBe("auto");
    expect(getDashboardVisitorThemeChoice("light")).toBe("light");
    expect(getDashboardVisitorThemeChoice("dark")).toBe("dark");
  });

  test("is kept under one key for every public dashboard of an address, apart from a status page's", () => {
    expect(DASHBOARD_VISITOR_THEME_STORAGE_KEY).toBe(
      "oneuptime-public-dashboard-theme",
    );
    expect(DASHBOARD_VISITOR_THEME_STORAGE_KEY).not.toBe(
      STATUS_PAGE_VISITOR_THEME_STORAGE_KEY,
    );
  });
});

describe("the theme a link names", () => {
  test("is the theme parameter", () => {
    expect(DASHBOARD_THEME_LINK_PARAMETER).toBe("theme");
  });

  test.each([
    ["light", "light"],
    ["dark", "dark"],
    ["system", "system"],
    ["Dark", "dark"],
    ["LIGHT", "light"],
    [" System ", "system"],
    ["dark\n", "dark"],
  ])("%p reads as %p: links are typed by people", (value: string, theme) => {
    expect(parseDashboardLinkTheme(value)).toBe(theme);
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["an empty value", ""],
    ["the visitor menu's Auto", "auto"],
    ["a theme nobody has", "sepia"],
    ["two themes", "dark,light"],
    ["a number", 1],
    ["an array", ["dark"]],
  ])("%s names no theme", (_what: string, value: unknown) => {
    expect(parseDashboardLinkTheme(value)).toBeNull();
  });

  test.each([
    ["?theme=dark", "dark"],
    ["?var-env=prod&theme=Light", "light"],
    ["?theme=system&var-region=eu", "system"],
    ["?theme=%20Dark%20", "dark"],
    // The first of two is the one the address bar shows the visitor.
    ["?theme=dark&theme=light", "dark"],
    ["theme=dark", "dark"],
  ])("an address with %s opens %p", (search: string, theme: string) => {
    expect(getDashboardLinkThemeFromSearch(search)).toBe(theme);
  });

  test.each([
    "",
    "?",
    "?var-theme=dark",
    "?themes=dark",
    "?theme",
    "?THEME=dark",
  ])("an address with %p names none", (search: string) => {
    expect(getDashboardLinkThemeFromSearch(search)).toBeNull();
  });
});

describe("the scheme one visitor sees", () => {
  /*
   * The rule, written out once more in the plainest way, so the table below
   * is checked against an independent reading of it.
   */
  const expected: (data: {
    theme: DashboardTheme;
    prefersDark: boolean;
    pick: DashboardColorScheme | null;
    link: DashboardLinkTheme | null;
  }) => DashboardColorScheme = (data: {
    theme: DashboardTheme;
    prefersDark: boolean;
    pick: DashboardColorScheme | null;
    link: DashboardLinkTheme | null;
  }): DashboardColorScheme => {
    const device: DashboardColorScheme = data.prefersDark ? "dark" : "light";

    if (data.link === "light" || data.link === "dark") {
      return data.link;
    }

    if (data.link === "system") {
      return device;
    }

    if (data.pick) {
      return data.pick;
    }

    if (data.theme === DashboardTheme.Dark) {
      return "dark";
    }

    if (data.theme === DashboardTheme.System) {
      return device;
    }

    return "light";
  };

  test("every theme, device, pick and link: the link first, then the pick, then the dashboard", () => {
    let cases: number = 0;

    for (const theme of DASHBOARD_THEMES) {
      for (const prefersDark of [false, true]) {
        for (const pick of PICKS) {
          for (const link of LINKS) {
            expect([
              theme,
              prefersDark,
              pick,
              link,
              getDashboardColorScheme({
                theme,
                prefersDark,
                visitorChoice: pick,
                linkTheme: link,
              }),
            ]).toEqual([
              theme,
              prefersDark,
              pick,
              link,
              expected({ theme, prefersDark, pick, link }),
            ]);
            cases++;
          }
        }
      }
    }

    expect(cases).toBe(3 * 2 * 3 * 4);
  });

  test("a visitor's pick turns any dashboard light or dark - a Dark one included", () => {
    expect(
      getDashboardColorScheme({
        theme: DashboardTheme.Dark,
        prefersDark: true,
        visitorChoice: DASHBOARD_LIGHT_SCHEME,
      }),
    ).toBe("light");
    expect(
      getDashboardColorScheme({
        theme: DashboardTheme.Light,
        prefersDark: false,
        visitorChoice: DASHBOARD_DARK_SCHEME,
      }),
    ).toBe("dark");
  });

  test("a link's theme wins over the visitor's pick: a wall screen stays as its link says", () => {
    for (const pick of SCHEMES) {
      expect(
        getDashboardColorScheme({
          theme: DashboardTheme.Light,
          prefersDark: false,
          visitorChoice: pick,
          linkTheme: "dark",
        }),
      ).toBe("dark");
    }
  });

  test("a link that names the device follows the device, whatever the pick or the dashboard", () => {
    for (const theme of DASHBOARD_THEMES) {
      for (const pick of PICKS) {
        expect(
          getDashboardColorScheme({
            theme,
            prefersDark: true,
            visitorChoice: pick,
            linkTheme: "system",
          }),
        ).toBe("dark");
        expect(
          getDashboardColorScheme({
            theme,
            prefersDark: false,
            visitorChoice: pick,
            linkTheme: "system",
          }),
        ).toBe("light");
      }
    }
  });

  test("with no pick and no link, a dashboard is drawn in its own theme", () => {
    expect(
      getDashboardColorScheme({
        theme: DashboardTheme.Light,
        prefersDark: true,
      }),
    ).toBe("light");
    expect(
      getDashboardColorScheme({
        theme: DashboardTheme.Dark,
        prefersDark: false,
      }),
    ).toBe("dark");
    expect(
      getDashboardColorScheme({
        theme: DashboardTheme.System,
        prefersDark: true,
      }),
    ).toBe("dark");
  });

  test("a page that knows no dashboard's theme is the visitor's own: their pick, else their device", () => {
    expect(
      getDashboardColorScheme({
        theme: UNKNOWN_DASHBOARD_THEME,
        prefersDark: true,
      }),
    ).toBe("dark");
    expect(
      getDashboardColorScheme({
        theme: UNKNOWN_DASHBOARD_THEME,
        prefersDark: true,
        visitorChoice: "light",
      }),
    ).toBe("light");
  });
});

describe("what the page's <head> is sent with", () => {
  test.each([
    [
      DashboardTheme.Light,
      {
        setting: "light",
        htmlClassName: "",
        colorScheme: "light",
        themeColor: "#f9fafb",
      },
    ],
    [
      DashboardTheme.Dark,
      {
        setting: "dark",
        htmlClassName: "dark",
        colorScheme: "dark",
        themeColor: "#0f172a",
      },
    ],
    [
      DashboardTheme.System,
      {
        setting: "system",
        htmlClassName: "",
        colorScheme: "light dark",
        themeColor: "#f9fafb",
      },
    ],
  ])("%s", (theme: DashboardTheme, head: DashboardThemeHead) => {
    expect(getDashboardThemeHead(theme)).toEqual(head);
  });

  test("a page that knows no dashboard's theme is sent the head that follows the visitor", () => {
    expect(getDashboardThemeHead(null)).toEqual(
      getDashboardThemeHead(DashboardTheme.System),
    );
  });

  test("the browser's chrome takes the dashboard's own background in each scheme", () => {
    expect(DASHBOARD_THEME_COLORS).toEqual({
      light: "#f9fafb",
      dark: "#0f172a",
    });
  });

  test("the attribute and the template variable keep their names, apart from a status page's", () => {
    /*
     * index.ejs, both page servers and the app read these by name; a rename
     * here that missed one of them would leave a dashboard light.
     */
    expect(DASHBOARD_THEME_ATTRIBUTE).toBe("data-public-dashboard-theme");
    expect(DASHBOARD_THEME_VIEW_VARIABLE).toBe("dashboardTheme");
    expect(DASHBOARD_THEME_ATTRIBUTE).not.toBe(STATUS_PAGE_THEME_ATTRIBUTE);
  });
});
