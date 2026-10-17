/**
 * A status page's theme, applied before its first paint: the real index.ejs,
 * rendered as the page servers render it (with getStatusPageThemeHead's
 * values, App/FeatureSet/StatusPage/Serve.ts and Frontend/Index.ts), and its
 * first script run in a browser-like window.
 *
 * Nothing here can be a copy of the markup: the failure this guards against
 * is the template drifting - a script moved below a stylesheet, a meta tag
 * renamed, a constant retyped - and a dark page flashing white, or a page
 * that follows its visitor's device ignoring it.
 */

import StatusPageTheme, {
  STATUS_PAGE_THEMES,
  STATUS_PAGE_THEME_ATTRIBUTE,
  STATUS_PAGE_THEME_COLORS,
  STATUS_PAGE_VISITOR_THEME_STORAGE_KEY,
  StatusPageThemeHead,
  getStatusPageThemeHead,
} from "../../../Types/StatusPage/StatusPageTheme";
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
  "StatusPage",
  "views",
  "index.ejs",
);

const DARK_QUERY: string = "(prefers-color-scheme: dark)";

const renderIndexPage: (theme?: StatusPageTheme | undefined) => string = (
  theme?: StatusPageTheme | undefined,
): string => {
  const variables: JSONObject = { title: "Acme Status" };

  if (theme) {
    variables["statusPageTheme"] = getStatusPageThemeHead(theme);
  }

  return ejs.render(fs.readFileSync(INDEX_TEMPLATE, "utf8"), variables, {
    filename: INDEX_TEMPLATE,
  });
};

const headOf: (html: string) => string = (html: string): string => {
  return html.slice(0, html.indexOf("</head>"));
};

interface Visitor {
  prefersDark?: boolean | undefined;
  // What their browser kept from the footer's switch.
  storedChoice?: string | undefined;
  storageBlocked?: boolean | undefined;
  noMatchMedia?: boolean | undefined;
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
    url: "https://status.acme.com/",
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
          STATUS_PAGE_VISITOR_THEME_STORAGE_KEY,
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
    setting: root.getAttribute(STATUS_PAGE_THEME_ATTRIBUTE),
  };

  page.window.close();

  return drawn;
};

const lightPage: (setting: string) => DrawnPage = (
  setting: string,
): DrawnPage => {
  return {
    htmlClass: "",
    dataTheme: "light",
    colorScheme: "light",
    themeColor: STATUS_PAGE_THEME_COLORS.light,
    setting,
  };
};

const darkPage: (setting: string) => DrawnPage = (
  setting: string,
): DrawnPage => {
  return {
    htmlClass: "dark",
    dataTheme: "dark",
    colorScheme: "dark",
    themeColor: STATUS_PAGE_THEME_COLORS.dark,
    setting,
  };
};

describe("the HTML each theme is sent as, before any script runs", () => {
  it.each(STATUS_PAGE_THEMES.map((theme: StatusPageTheme) => [theme]))(
    "%s: <html> carries the theme, and its head the color-scheme and theme-color the server worked out",
    (theme: StatusPageTheme) => {
      const head: StatusPageThemeHead = getStatusPageThemeHead(theme);
      const html: string = renderIndexPage(theme);

      expect(html).toContain(
        `${STATUS_PAGE_THEME_ATTRIBUTE}="${head.setting}"`,
      );
      expect(headOf(html)).toContain(
        `<meta name="color-scheme" content="${head.colorScheme}" />`,
      );
      expect(headOf(html)).toContain(
        `<meta name="theme-color" content="${head.themeColor}" />`,
      );
    },
  );

  it("a Dark page is dark in the HTML itself", () => {
    const html: string = renderIndexPage(StatusPageTheme.Dark);
    const htmlTag: string = html.slice(
      html.indexOf("<html"),
      html.indexOf(">", html.indexOf("<html")) + 1,
    );

    expect(htmlTag).toContain('class="dark"');
  });

  it("a Light or System page is sent without the dark class", () => {
    for (const theme of [StatusPageTheme.Light, StatusPageTheme.System]) {
      const html: string = renderIndexPage(theme);
      const htmlTag: string = html.slice(
        html.indexOf("<html"),
        html.indexOf(">", html.indexOf("<html")) + 1,
      );

      expect([theme, htmlTag.includes("class=")]).toEqual([theme, false]);
    }
  });

  it("a page rendered with no theme (a host that names no page) is the light page", () => {
    const html: string = renderIndexPage();

    expect(html).toContain(`${STATUS_PAGE_THEME_ATTRIBUTE}="light"`);
    expect(headOf(html)).toContain(
      '<meta name="color-scheme" content="light" />',
    );
    expect(headOf(html)).toContain(
      `<meta name="theme-color" content="${STATUS_PAGE_THEME_COLORS.light}" />`,
    );
  });

  it("the template's own fallback is exactly the light theme's head", () => {
    const template: string = fs.readFileSync(INDEX_TEMPLATE, "utf8");
    const light: StatusPageThemeHead = getStatusPageThemeHead(
      StatusPageTheme.Light,
    );

    expect(template).toContain(
      `{ setting: '${light.setting}', htmlClassName: '${light.htmlClassName}', colorScheme: '${light.colorScheme}', themeColor: '${light.themeColor}' }`,
    );
  });

  it("there is one theme-color tag, for the script and the app to keep in step", () => {
    for (const theme of [...STATUS_PAGE_THEMES, undefined]) {
      const head: string = headOf(renderIndexPage(theme));

      expect(head.split('<meta name="theme-color"').length - 1).toBe(1);
      // The old tag painted the browser's chrome black over a light page.
      expect(head).not.toContain('content="#000000"');
    }
  });
});

describe("the order of the page's <head>: the theme before anything that paints", () => {
  const html: string = renderIndexPage(StatusPageTheme.System);
  const head: string = headOf(html);
  const themeScript: number = head.indexOf(
    'root.getAttribute("data-status-page-theme")',
  );

  it("has the theme script", () => {
    expect(themeScript).toBeGreaterThan(-1);
  });

  it("names the meta tags before the script that sets them", () => {
    expect(head.indexOf('<meta name="theme-color"')).toBeLessThan(
      themeScript,
    );
    expect(head.indexOf('<meta name="color-scheme"')).toBeLessThan(
      themeScript,
    );
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

  it("gives the dark page its ground and text in the first <style>, before Tailwind or the app's Theme.css", () => {
    const firstStyleBlock: string = head.slice(
      head.indexOf("<style"),
      head.indexOf("</style>"),
    );

    expect(firstStyleBlock.replace(/\s+/g, " ")).toContain(
      "html.dark, html.dark body { background-color: #0f172a; color: #f8fafc; }",
    );
  });

  it("reads the visitor's pick and the colours from the same constants the app uses", () => {
    expect(head).toContain(`"${STATUS_PAGE_VISITOR_THEME_STORAGE_KEY}"`);
    expect(head).toContain(`"${DARK_QUERY}"`);
    expect(head).toContain(
      `scheme === "dark" ? "${STATUS_PAGE_THEME_COLORS.dark}" : "${STATUS_PAGE_THEME_COLORS.light}"`,
    );
  });
});

describe("the page as the first script leaves it", () => {
  it("Light is light, on a dark device and after the visitor picked dark", () => {
    for (const visitor of [
      {},
      { prefersDark: true },
      { prefersDark: true, storedChoice: "dark" },
    ]) {
      expect(openPage(renderIndexPage(StatusPageTheme.Light), visitor)).toEqual(
        lightPage("light"),
      );
    }
  });

  it("Dark is dark, on a light device and after the visitor picked light", () => {
    for (const visitor of [
      {},
      { prefersDark: false },
      { prefersDark: false, storedChoice: "light" },
    ]) {
      expect(openPage(renderIndexPage(StatusPageTheme.Dark), visitor)).toEqual(
        darkPage("dark"),
      );
    }
  });

  it("System follows a dark device", () => {
    expect(
      openPage(renderIndexPage(StatusPageTheme.System), { prefersDark: true }),
    ).toEqual(darkPage("system"));
  });

  it("System follows a light device", () => {
    expect(
      openPage(renderIndexPage(StatusPageTheme.System), {
        prefersDark: false,
      }),
    ).toEqual(lightPage("system"));
  });

  it("System follows the visitor's own pick over their device", () => {
    expect(
      openPage(renderIndexPage(StatusPageTheme.System), {
        prefersDark: true,
        storedChoice: "light",
      }),
    ).toEqual(lightPage("system"));
    expect(
      openPage(renderIndexPage(StatusPageTheme.System), {
        prefersDark: false,
        storedChoice: "dark",
      }),
    ).toEqual(darkPage("system"));
  });

  it.each(["", "Dark", "system", "auto", "{}"])(
    "System ignores a stored pick of %p and follows the device",
    (storedChoice: string) => {
      expect(
        openPage(renderIndexPage(StatusPageTheme.System), {
          prefersDark: true,
          storedChoice,
        }),
      ).toEqual(darkPage("system"));
    },
  );

  it("System still follows the device when storage is blocked", () => {
    expect(
      openPage(renderIndexPage(StatusPageTheme.System), {
        prefersDark: true,
        storageBlocked: true,
      }),
    ).toEqual(darkPage("system"));
  });

  it("System is light in a browser that cannot say what its device prefers", () => {
    expect(
      openPage(renderIndexPage(StatusPageTheme.System), {
        noMatchMedia: true,
      }),
    ).toEqual(lightPage("system"));
  });

  it("the page with no theme is light on a dark device", () => {
    expect(openPage(renderIndexPage(), { prefersDark: true })).toEqual(
      lightPage("light"),
    );
  });
});
