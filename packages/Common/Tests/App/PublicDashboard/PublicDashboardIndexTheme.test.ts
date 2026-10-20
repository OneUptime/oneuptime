/**
 * A public dashboard's theme, applied before its first paint: the real
 * index.ejs, rendered as the two page servers render it (with
 * getDashboardThemeHead's values, App/FeatureSet/PublicDashboard/Serve.ts
 * and Frontend/Index.ts), and its first script run in a browser-like window.
 *
 * The script decides the scheme on its own, before any of the app's code
 * loads, from the link's ?theme=, the visitor's pick and the dashboard's
 * theme. It has to decide exactly what the app decides afterwards
 * (getDashboardColorScheme), or the page would change look the moment the
 * app starts - so the whole table is run through the real script here and
 * held to the function.
 *
 * Nothing here can be a copy of the markup: the failure this guards against
 * is the template drifting - a script moved below a stylesheet, a meta tag
 * renamed, a constant retyped - and a dark dashboard flashing white, or one
 * that follows its visitor's device ignoring it.
 */

import DashboardTheme, {
  DASHBOARD_THEMES,
  DASHBOARD_THEME_ATTRIBUTE,
  DASHBOARD_THEME_COLORS,
  DASHBOARD_THEME_LINK_PARAMETER,
  DASHBOARD_VISITOR_THEME_STORAGE_KEY,
  DashboardColorScheme,
  DashboardLinkTheme,
  DashboardThemeHead,
  getDashboardColorScheme,
  getDashboardThemeHead,
  parseDashboardVisitorColorScheme,
} from "../../../Types/Dashboard/DashboardTheme";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, it } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import { JSDOM } from "jsdom";
import path from "path";

const INDEX_TEMPLATE: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "PublicDashboard",
  "views",
  "index.ejs",
);

const DARK_QUERY: string = "(prefers-color-scheme: dark)";

// What the servers render: a dashboard's theme, or no dashboard at all (null).
const renderIndexPage: (theme?: DashboardTheme | null | undefined) => string = (
  theme?: DashboardTheme | null | undefined,
): string => {
  const variables: JSONObject = { title: "Checkout" };

  if (theme !== undefined) {
    variables["dashboardTheme"] = getDashboardThemeHead(theme);
  }

  return ejs.render(fs.readFileSync(INDEX_TEMPLATE, "utf8"), variables, {
    filename: INDEX_TEMPLATE,
  });
};

const headOf: (html: string) => string = (html: string): string => {
  return html.slice(0, html.indexOf("</head>"));
};

const htmlTagOf: (html: string) => string = (html: string): string => {
  return html.slice(
    html.indexOf("<html"),
    html.indexOf(">", html.indexOf("<html")) + 1,
  );
};

interface Visitor {
  prefersDark?: boolean | undefined;
  // What their browser kept from the toolbar's theme menu.
  storedChoice?: string | undefined;
  storageBlocked?: boolean | undefined;
  noMatchMedia?: boolean | undefined;
  // The address's query string, the link's own theme among it.
  search?: string | undefined;
}

interface DrawnPage {
  htmlClass: string;
  dataTheme: string | null;
  colorScheme: string;
  themeColor: string | null;
  setting: string | null;
}

const openPage: (html: string, visitor: Visitor) => DrawnPage = (
  html: string,
  visitor: Visitor,
): DrawnPage => {
  const page: JSDOM = new JSDOM(html, {
    url: `https://dashboard.acme.com/${visitor.search || ""}`,
    runScripts: "dangerously",
    beforeParse: (pageWindow: JSDOM["window"]): void => {
      const target: Record<string, unknown> = pageWindow as unknown as Record<
        string,
        unknown
      >;

      // The template's last script configures Tailwind, which is not loaded here.
      target["tailwind"] = { config: {} };

      if (visitor.noMatchMedia) {
        target["matchMedia"] = undefined;
      } else {
        target["matchMedia"] = (query: string): { matches: boolean } => {
          return {
            matches: query === DARK_QUERY && Boolean(visitor.prefersDark),
          };
        };
      }

      if (visitor.storageBlocked) {
        Object.defineProperty(pageWindow, "localStorage", {
          configurable: true,
          get: (): never => {
            throw new Error("Storage is blocked");
          },
        });
      } else if (visitor.storedChoice !== undefined) {
        pageWindow.localStorage.setItem(
          DASHBOARD_VISITOR_THEME_STORAGE_KEY,
          visitor.storedChoice,
        );
      }
    },
  });

  const root: HTMLElement = page.window.document.documentElement;
  const drawn: DrawnPage = {
    htmlClass: root.className,
    dataTheme: root.getAttribute("data-theme"),
    colorScheme: root.style.colorScheme,
    themeColor:
      page.window.document
        .querySelector('meta[name="theme-color"]')
        ?.getAttribute("content") || null,
    setting: root.getAttribute(DASHBOARD_THEME_ATTRIBUTE),
  };

  page.window.close();

  return drawn;
};

const drawnAs: (scheme: DashboardColorScheme, setting: string) => DrawnPage = (
  scheme: DashboardColorScheme,
  setting: string,
): DrawnPage => {
  return {
    htmlClass: scheme === "dark" ? "dark" : "",
    dataTheme: scheme,
    colorScheme: scheme,
    themeColor: DASHBOARD_THEME_COLORS[scheme],
    setting,
  };
};

describe("the HTML each theme is sent as, before any script runs", () => {
  it.each(
    DASHBOARD_THEMES.map((theme: DashboardTheme): Array<DashboardTheme> => {
      return [theme];
    }),
  )(
    "%s: <html> carries the theme, and its head the color-scheme and theme-color the server worked out",
    (theme: DashboardTheme) => {
      const head: DashboardThemeHead = getDashboardThemeHead(theme);
      const html: string = renderIndexPage(theme);

      expect(htmlTagOf(html)).toContain(
        `${DASHBOARD_THEME_ATTRIBUTE}="${head.setting}"`,
      );
      expect(headOf(html)).toContain(
        `<meta name="color-scheme" content="${head.colorScheme}" />`,
      );
      expect(headOf(html)).toContain(
        `<meta name="theme-color" content="${head.themeColor}" />`,
      );
    },
  );

  it("a Dark dashboard is dark in the HTML itself", () => {
    expect(htmlTagOf(renderIndexPage(DashboardTheme.Dark))).toContain(
      'class="dark"',
    );
  });

  it("a Light or System dashboard is sent without the dark class", () => {
    for (const theme of [DashboardTheme.Light, DashboardTheme.System]) {
      expect([
        theme,
        htmlTagOf(renderIndexPage(theme)).includes("class="),
      ]).toEqual([theme, false]);
    }
  });

  it("a page that knows no dashboard's theme is sent the head that follows the visitor", () => {
    for (const html of [renderIndexPage(null), renderIndexPage()]) {
      expect(htmlTagOf(html)).toContain(
        `${DASHBOARD_THEME_ATTRIBUTE}="system"`,
      );
      expect(headOf(html)).toContain(
        '<meta name="color-scheme" content="light dark" />',
      );
      expect(headOf(html)).toContain(
        `<meta name="theme-color" content="${DASHBOARD_THEME_COLORS.light}" />`,
      );
    }
  });

  it("the template's own fallback is exactly the head that follows the visitor", () => {
    const template: string = fs.readFileSync(INDEX_TEMPLATE, "utf8");
    const system: DashboardThemeHead = getDashboardThemeHead(null);

    expect(template).toContain(
      `{ setting: '${system.setting}', htmlClassName: '${system.htmlClassName}', colorScheme: '${system.colorScheme}', themeColor: '${system.themeColor}' }`,
    );
  });

  it("there is one theme-color tag, for the script and the app to keep in step", () => {
    for (const theme of [...DASHBOARD_THEMES, null, undefined]) {
      const head: string = headOf(renderIndexPage(theme));

      expect(head.split('<meta name="theme-color"').length - 1).toBe(1);
      // The old tags painted the browser's chrome black over a light page.
      expect(head).not.toContain('content="#000000"');
    }
  });

  it("keeps the rest of the head: the title, the description and no product analytics", () => {
    const html: string = renderIndexPage(DashboardTheme.Dark);

    expect(html).toContain("<title>Checkout</title>");
    expect(headOf(html)).toContain(
      'content="View dashboard metrics and insights."',
    );
    expect(html).toContain('<script src="/public-dashboard/env.js"></script>');
    expect(html).toContain(
      '<script type="module" src="/public-dashboard/dist/Index.js"></script>',
    );
  });

  it("lets a dark: class follow the page's theme, never the device on its own", () => {
    const html: string = renderIndexPage(DashboardTheme.Light);
    const config: string = html.slice(html.indexOf("tailwind.config"));

    expect(config).toContain("darkMode: 'class'");
  });
});

describe("the order of the page's <head>: the theme before anything that paints", () => {
  const html: string = renderIndexPage(DashboardTheme.System);
  const head: string = headOf(html);
  const themeScript: number = head.indexOf(
    `root.getAttribute("${DASHBOARD_THEME_ATTRIBUTE}")`,
  );

  it("has the theme script", () => {
    expect(themeScript).toBeGreaterThan(-1);
  });

  it("names the meta tags before the script that sets them", () => {
    expect(head.indexOf('<meta name="theme-color"')).toBeLessThan(themeScript);
    expect(head.indexOf('<meta name="color-scheme"')).toBeLessThan(themeScript);
  });

  it("runs before every stylesheet, every external script and the body", () => {
    const firstStyle: number = head.indexOf("<style");
    const firstExternalScript: number = head.indexOf("<script src=");
    const firstStylesheet: number = head.indexOf('rel="stylesheet"');
    const tailwind: number = head.indexOf("tailwind-3.4.5.js");
    const body: number = html.indexOf("<body");

    expect(firstStyle).toBeGreaterThan(themeScript);
    expect(firstExternalScript).toBeGreaterThan(themeScript);
    expect(tailwind).toBeGreaterThan(themeScript);
    expect(body).toBeGreaterThan(themeScript);
    // No stylesheet link at all: everything else is drawn later still.
    expect(firstStylesheet).toBe(-1);
  });

  it("gives the dark dashboard its ground and text in the first <style>, before Tailwind or the app's Theme.css", () => {
    const firstStyleBlock: string = head.slice(
      head.indexOf("<style"),
      head.indexOf("</style>"),
    );

    expect(firstStyleBlock.replace(/\s+/g, " ")).toContain(
      "html.dark, html.dark body { background-color: #0f172a; color: #f8fafc; }",
    );
  });

  it("reads the link, the visitor's pick and the colours from the same constants the app uses", () => {
    expect(head).toContain(
      `.get(\n            "${DASHBOARD_THEME_LINK_PARAMETER}",`,
    );
    expect(head).toContain(`"${DASHBOARD_VISITOR_THEME_STORAGE_KEY}"`);
    expect(head).toContain(`"${DARK_QUERY}"`);
    expect(head).toContain(
      `scheme === "dark" ? "${DASHBOARD_THEME_COLORS.dark}" : "${DASHBOARD_THEME_COLORS.light}"`,
    );
  });
});

describe("the page as the first script leaves it", () => {
  it("decides what the app decides, for every theme, device, kept pick and link", () => {
    const stored: Array<string | undefined> = [
      undefined,
      "light",
      "dark",
      // Never a pick: what the script must ignore, as the app does.
      "auto",
      "Dark",
      "",
    ];
    const links: Array<[string, DashboardLinkTheme | null]> = [
      ["", null],
      ["?theme=light", "light"],
      ["?theme=Dark", "dark"],
      ["?var-env=prod&theme=%20system", "system"],
      ["?theme=sepia", null],
      ["?var-theme=dark", null],
    ];
    let cases: number = 0;

    for (const theme of [...DASHBOARD_THEMES, null]) {
      const html: string = renderIndexPage(theme);
      const setting: string = getDashboardThemeHead(theme).setting;

      for (const prefersDark of [false, true]) {
        for (const storedChoice of stored) {
          for (const [search, linkTheme] of links) {
            const expected: DashboardColorScheme = getDashboardColorScheme({
              theme: theme || DashboardTheme.System,
              prefersDark,
              visitorChoice: parseDashboardVisitorColorScheme(storedChoice),
              linkTheme,
            });

            expect([
              theme,
              prefersDark,
              storedChoice,
              search,
              openPage(html, { prefersDark, storedChoice, search }),
            ]).toEqual([
              theme,
              prefersDark,
              storedChoice,
              search,
              drawnAs(expected, setting),
            ]);
            cases++;
          }
        }
      }
    }

    expect(cases).toBe(4 * 2 * 6 * 6);
  });

  it("Light is light on a dark device, until the visitor picks dark", () => {
    const html: string = renderIndexPage(DashboardTheme.Light);

    expect(openPage(html, { prefersDark: true })).toEqual(
      drawnAs("light", "light"),
    );
    expect(openPage(html, { prefersDark: true, storedChoice: "dark" })).toEqual(
      drawnAs("dark", "light"),
    );
  });

  it("Dark is dark on a light device, until the visitor picks light: the dark class sent with it is taken off before the first paint", () => {
    const html: string = renderIndexPage(DashboardTheme.Dark);

    expect(openPage(html, { prefersDark: false })).toEqual(
      drawnAs("dark", "dark"),
    );
    expect(
      openPage(html, { prefersDark: false, storedChoice: "light" }),
    ).toEqual(drawnAs("light", "dark"));
  });

  it("System follows the device", () => {
    const html: string = renderIndexPage(DashboardTheme.System);

    expect(openPage(html, { prefersDark: true })).toEqual(
      drawnAs("dark", "system"),
    );
    expect(openPage(html, { prefersDark: false })).toEqual(
      drawnAs("light", "system"),
    );
  });

  it("a link's theme wins over the visitor's pick and the dashboard's", () => {
    expect(
      openPage(renderIndexPage(DashboardTheme.Light), {
        prefersDark: false,
        storedChoice: "light",
        search: "?theme=dark",
      }),
    ).toEqual(drawnAs("dark", "light"));
    expect(
      openPage(renderIndexPage(DashboardTheme.Dark), {
        prefersDark: true,
        storedChoice: "dark",
        search: "?theme=LIGHT",
      }),
    ).toEqual(drawnAs("light", "dark"));
  });

  it("a link that names the device follows it, over the visitor's pick", () => {
    expect(
      openPage(renderIndexPage(DashboardTheme.Light), {
        prefersDark: true,
        storedChoice: "light",
        search: "?theme=system",
      }),
    ).toEqual(drawnAs("dark", "light"));
  });

  it("a page that knows no dashboard's theme follows the visitor's pick, else their device", () => {
    const html: string = renderIndexPage(null);

    expect(openPage(html, { prefersDark: true })).toEqual(
      drawnAs("dark", "system"),
    );
    expect(
      openPage(html, { prefersDark: true, storedChoice: "light" }),
    ).toEqual(drawnAs("light", "system"));
  });

  it("with storage blocked, the dashboard's theme and the device decide", () => {
    expect(
      openPage(renderIndexPage(DashboardTheme.System), {
        prefersDark: true,
        storageBlocked: true,
      }),
    ).toEqual(drawnAs("dark", "system"));
    expect(
      openPage(renderIndexPage(DashboardTheme.Dark), {
        prefersDark: false,
        storageBlocked: true,
      }),
    ).toEqual(drawnAs("dark", "dark"));
  });

  it("with storage blocked, a link's theme still wins", () => {
    expect(
      openPage(renderIndexPage(DashboardTheme.Light), {
        storageBlocked: true,
        search: "?theme=dark",
      }),
    ).toEqual(drawnAs("dark", "light"));
  });

  it("System is light in a browser that cannot say what its device prefers", () => {
    expect(
      openPage(renderIndexPage(DashboardTheme.System), {
        noMatchMedia: true,
      }),
    ).toEqual(drawnAs("light", "system"));
    expect(
      openPage(renderIndexPage(DashboardTheme.Light), {
        noMatchMedia: true,
        search: "?theme=system",
      }),
    ).toEqual(drawnAs("light", "light"));
  });
});
