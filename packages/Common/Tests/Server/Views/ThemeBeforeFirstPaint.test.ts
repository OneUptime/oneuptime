/**
 * The person's theme, drawn before the first paint, on every page of theirs
 * (Common/Types/Theme/ThemePreference.ts): the partial that draws it
 * (Common/Server/Views/Partials/Theme.ejs) as each page includes it - the
 * Dashboard's, the Admin Dashboard's and the sign-in pages' index.ejs, and
 * the server's own pages on the way in (an on-call acknowledgement, passing
 * a page on, a message; the single sign-on message and confirmation) - and
 * the Dashboard's static offline page, which carries its own copy.
 *
 * Every page here is the real template, rendered as its server renders it,
 * and its first script run in a browser-like window. Nothing is a copy of
 * the markup: the failures this guards against are a template that drifts -
 * the script moved below a stylesheet, a second theme-color tag, a constant
 * retyped - and a page that opens in the wrong theme, or flashes white
 * before turning dark.
 */

import {
  DARK_COLOR_SCHEME_MEDIA_QUERY,
  THEME_COLORS,
  THEME_STORAGE_KEY,
  Theme,
  getThemeForPreference,
  parseThemePreference,
} from "../../../Types/Theme/ThemePreference";
import { describe, expect, it } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import { JSDOM } from "jsdom";
import path from "path";

const PACKAGES: string = path.resolve(__dirname, "..", "..", "..", "..");

const THEME_PARTIAL: string = path.join(
  PACKAGES,
  "Common",
  "Server",
  "Views",
  "Partials",
  "Theme.ejs",
);

const frontendIndex: (frontend: string) => string = (
  frontend: string,
): string => {
  return path.join(
    PACKAGES,
    "App",
    "FeatureSet",
    frontend,
    "views",
    "index.ejs",
  );
};

const commonView: (name: string) => string = (name: string): string => {
  return path.join(PACKAGES, "Common", "Server", "Views", name);
};

const identityView: (name: string) => string = (name: string): string => {
  return path.join(PACKAGES, "App", "FeatureSet", "Identity", "Views", name);
};

const OFFLINE_PAGE: string = path.join(
  PACKAGES,
  "App",
  "FeatureSet",
  "Dashboard",
  "public",
  "offline.html",
);

// What an on-call page shows, as UserOnCallLogTimelineAPI renders it.
const ON_CALL_PAGE: Record<string, unknown> = {
  title: "Acknowledge Incident - Checkout API is down",
  message: "Do you want to acknowledge this Incident?",
  acknowledgeText: "Acknowledge Incident",
  acknowledgeUrl: "https://oneuptime.example.com/api/acknowledge/1",
  resourceNumber: "#42",
  resourceTitle: "Checkout API is down",
  resourceDescription: "Every request answers 503.",
  details: [{ label: "Severity", value: "Critical", color: "#dc2626" }],
};

interface ThemedPage {
  name: string;
  html: string;
  // Where it is opened.
  url: string;
  // Whether it follows the device and other tabs itself (no app of its own).
  followsChanges: boolean;
}

const renderView: (
  viewPath: string,
  variables: Record<string, unknown>,
) => string = (
  viewPath: string,
  variables: Record<string, unknown>,
): string => {
  return ejs.render(fs.readFileSync(viewPath, "utf8"), variables, {
    filename: viewPath,
  });
};

const APP_PAGES: Array<ThemedPage> = [
  {
    name: "the Dashboard",
    html: renderView(frontendIndex("Dashboard"), {}),
    url: "https://oneuptime.example.com/dashboard/",
    followsChanges: false,
  },
  {
    name: "the Admin Dashboard",
    html: renderView(frontendIndex("AdminDashboard"), {}),
    url: "https://oneuptime.example.com/admin/",
    followsChanges: false,
  },
  {
    name: "the sign-in pages",
    html: renderView(frontendIndex("Accounts"), {}),
    url: "https://oneuptime.example.com/accounts/login",
    followsChanges: false,
  },
];

const SERVER_PAGES: Array<ThemedPage> = [
  {
    name: "the on-call acknowledgement",
    html: renderView(
      commonView("AcknowledgeUserOnCallNotification.ejs"),
      ON_CALL_PAGE,
    ),
    url: "https://oneuptime.example.com/api/acknowledge/1",
    followsChanges: true,
  },
  {
    name: "passing a page on",
    html: renderView(commonView("PassOnUserOnCallNotification.ejs"), {
      ...ON_CALL_PAGE,
      passOnFormUrl: "https://oneuptime.example.com/api/pass-on",
      pageTokenParam: "token",
      pageToken: "abc",
      passOnText: "Pass it on",
    }),
    url: "https://oneuptime.example.com/api/pass-on/1",
    followsChanges: true,
  },
  {
    name: "the on-call message",
    html: renderView(commonView("ViewMessage.ejs"), {
      ...ON_CALL_PAGE,
      viewDetailsUrl: "https://oneuptime.example.com/dashboard",
      viewDetailsText: "View Incident",
    }),
    url: "https://oneuptime.example.com/api/acknowledge/1",
    followsChanges: true,
  },
  {
    name: "the single sign-on message",
    html: renderView(identityView("Message.ejs"), {
      title: "Single sign-on did not work",
      message: "Ask your administrator to check the SSO settings.",
    }),
    url: "https://oneuptime.example.com/identity/idp-login/1",
    followsChanges: true,
  },
  {
    name: "the single sign-on confirmation",
    html: renderView(identityView("SsoSignInConfirmation.ejs"), {
      title: "Confirm your sign-in",
      message: "Sign in to Acme with Okta?",
      formAction: "https://oneuptime.example.com/identity/confirm",
      token: "t",
      signature: "s",
      buttonText: "Confirm and sign in",
    }),
    url: "https://oneuptime.example.com/identity/confirm",
    followsChanges: true,
  },
];

const THEMED_PAGES: Array<ThemedPage> = [...APP_PAGES, ...SERVER_PAGES];

const headOf: (html: string) => string = (html: string): string => {
  return html.slice(0, html.indexOf("</head>"));
};

interface Visitor {
  // What their browser kept under the theme key; undefined: nothing.
  kept?: string | undefined;
  prefersDark?: boolean | undefined;
  storageBlocked?: boolean | undefined;
  noMatchMedia?: boolean | undefined;
  url?: string | undefined;
}

interface DrawnPage {
  dark: boolean;
  dataTheme: string | null;
  colorScheme: string;
  themeColor: string | null;
}

interface OpenedPage {
  drawn: () => DrawnPage;
  // The device changes while the page is open.
  setDevice: (prefersDark: boolean) => void;
  // Another tab of this address picks (or clears, with null) the theme.
  pickInAnotherTab: (kept: string | null) => void;
  mediaListeners: () => number;
  close: () => void;
}

const openPage: (html: string, visitor: Visitor) => OpenedPage = (
  html: string,
  visitor: Visitor,
): OpenedPage => {
  let prefersDark: boolean = Boolean(visitor.prefersDark);
  const listeners: Array<() => void> = [];

  const page: JSDOM = new JSDOM(html, {
    url: visitor.url || "https://oneuptime.example.com/dashboard/",
    runScripts: "dangerously",
    beforeParse: (pageWindow: JSDOM["window"]): void => {
      const target: Record<string, unknown> = pageWindow as unknown as Record<
        string,
        unknown
      >;

      // A later script configures Tailwind, which is not loaded here.
      target["tailwind"] = { config: {} };

      if (visitor.noMatchMedia) {
        target["matchMedia"] = undefined;
      } else {
        target["matchMedia"] = (
          query: string,
        ): {
          matches: boolean;
          addEventListener: (type: string, listener: () => void) => void;
        } => {
          return {
            get matches(): boolean {
              return query === DARK_COLOR_SCHEME_MEDIA_QUERY && prefersDark;
            },
            addEventListener: (_type: string, listener: () => void): void => {
              listeners.push(listener);
            },
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
      } else if (visitor.kept !== undefined) {
        pageWindow.localStorage.setItem(THEME_STORAGE_KEY, visitor.kept);
      }
    },
  });

  return {
    drawn: (): DrawnPage => {
      const root: HTMLElement = page.window.document.documentElement;

      return {
        dark: root.classList.contains("dark"),
        dataTheme: root.getAttribute("data-theme"),
        colorScheme: root.style.colorScheme,
        themeColor:
          page.window.document
            .querySelector('meta[name="theme-color"]')
            ?.getAttribute("content") || null,
      };
    },
    setDevice: (next: boolean): void => {
      prefersDark = next;

      for (const listener of listeners) {
        listener();
      }
    },
    pickInAnotherTab: (kept: string | null): void => {
      if (kept === null) {
        page.window.localStorage.removeItem(THEME_STORAGE_KEY);
      } else {
        page.window.localStorage.setItem(THEME_STORAGE_KEY, kept);
      }

      page.window.dispatchEvent(
        new page.window.StorageEvent("storage", {
          key: THEME_STORAGE_KEY,
          newValue: kept,
        }),
      );
    },
    mediaListeners: (): number => {
      return listeners.length;
    },
    close: (): void => {
      page.window.close();
    },
  };
};

const drawnFor: (theme: Theme) => DrawnPage = (theme: Theme): DrawnPage => {
  return {
    dark: theme === Theme.Dark,
    dataTheme: theme,
    colorScheme: theme,
    themeColor: THEME_COLORS[theme],
  };
};

const LIGHT: DrawnPage = drawnFor(Theme.Light);
const DARK: DrawnPage = drawnFor(Theme.Dark);

const drawnOnce: (html: string, visitor: Visitor) => DrawnPage = (
  html: string,
  visitor: Visitor,
): DrawnPage => {
  const page: OpenedPage = openPage(html, visitor);
  const drawn: DrawnPage = page.drawn();
  page.close();
  return drawn;
};

// Every pick a browser can have kept, and the device either way.
const KEPT_VALUES: Array<string | undefined> = [
  undefined,
  "light",
  "dark",
  "system",
  "Dark",
  "",
  "auto",
];

describe("the partial", () => {
  const partial: string = fs.readFileSync(THEME_PARTIAL, "utf8");

  it("reads the pick, asks the device and paints the browser's chrome with the constants the app uses", () => {
    expect(partial).toContain(`"${THEME_STORAGE_KEY}"`);
    expect(partial).toContain(`"${DARK_COLOR_SCHEME_MEDIA_QUERY}"`);
    expect(partial).toContain(
      `theme === "dark" ? "${THEME_COLORS[Theme.Dark]}" : "${THEME_COLORS[Theme.Light]}"`,
    );
    expect(partial).toContain(
      `<meta name="theme-color" content="${THEME_COLORS[Theme.Light]}" />`,
    );
  });

  it("gives a dark page its ground and text before any stylesheet, and hides what is drawn for the other theme only", () => {
    const style: string = partial
      .slice(partial.indexOf("<style>"), partial.indexOf("</style>"))
      .replace(/\s+/g, " ");

    expect(style).toContain(
      `html.dark, html.dark body { background-color: ${THEME_COLORS[Theme.Dark]}; color: #f8fafc; }`,
    );
    expect(style).toContain(
      'html.dark [data-theme-only="light"], html:not(.dark) [data-theme-only="dark"] { display: none !important; }',
    );
  });

  it("writes only plain paths into its script as the addresses that stay light", () => {
    const rendered: string = ejs.render(
      partial,
      {
        alwaysLightPathPrefixes: [
          "/accounts/form/",
          '</script><script>alert("x")</script>',
          "/Accounts/Form/",
          "javascript:alert(1)",
          5,
          null,
        ],
      },
      { filename: THEME_PARTIAL },
    );

    expect(rendered).toContain('["/accounts/form/"]');
    expect(rendered).not.toContain("alert");
    expect(rendered).not.toContain("/Accounts/Form/");
  });

  it("follows changes only when the page asks it to", () => {
    expect(ejs.render(partial, {}, { filename: THEME_PARTIAL })).toContain(
      "false\n  );",
    );
    expect(
      ejs.render(partial, { followChanges: true }, { filename: THEME_PARTIAL }),
    ).toContain("true\n  );");
    // Anything but true is a page with an app of its own.
    expect(
      ejs.render(
        partial,
        { followChanges: "yes" },
        { filename: THEME_PARTIAL },
      ),
    ).toContain("false\n  );");
  });
});

describe.each(
  THEMED_PAGES.map((page: ThemedPage): [string, ThemedPage] => {
    return [page.name, page];
  }),
)("%s", (_name: string, themedPage: ThemedPage) => {
  const head: string = headOf(themedPage.html);
  const themeScript: number = head.indexOf("var storageKey =");

  describe("its <head>", () => {
    it("has the theme script", () => {
      expect(themeScript).toBeGreaterThan(-1);
    });

    it("has one theme-color tag, which the script sets, and never the black one", () => {
      expect(head.split('<meta name="theme-color"').length - 1).toBe(1);
      expect(head.indexOf('<meta name="theme-color"')).toBeLessThan(
        themeScript,
      );
      expect(head).not.toContain('name="theme-color" content="#000000"');
      expect(head).not.toContain('name="theme-color" content="#121212"');
    });

    it("runs it after the charset and before every stylesheet, every external script and the body", () => {
      const charset: number = head.search(/<meta char[sS]et=/);
      const firstExternalScript: number = head.indexOf("<script src=");
      const firstStylesheet: number = head.indexOf('rel="stylesheet"');
      const tailwind: number = head.indexOf("tailwind-3.4.5.js");

      expect(charset).toBeGreaterThan(-1);
      expect(charset).toBeLessThan(themeScript);
      expect(firstExternalScript).toBeGreaterThan(themeScript);
      expect(tailwind).toBeGreaterThan(themeScript);
      expect(firstStylesheet === -1 || firstStylesheet > themeScript).toBe(
        true,
      );
      expect(themedPage.html.indexOf("<body")).toBeGreaterThan(themeScript);
    });

    it("tells Tailwind the dark theme is the dark class, not the device alone", () => {
      expect(themedPage.html.replace(/\s+/g, " ")).toMatch(
        /darkMode: ["']class["']/,
      );
    });
  });

  describe("as the first script leaves it", () => {
    it.each(
      KEPT_VALUES.flatMap(
        (kept: string | undefined): Array<[string, boolean]> => {
          return [
            [kept === undefined ? "nothing" : JSON.stringify(kept), false],
            [kept === undefined ? "nothing" : JSON.stringify(kept), true],
          ];
        },
      ),
    )(
      "a browser that kept %s, on a device that prefers dark: %p",
      (label: string, prefersDark: boolean) => {
        const kept: string | undefined =
          label === "nothing" ? undefined : (JSON.parse(label) as string);
        const expected: Theme = getThemeForPreference({
          preference: parseThemePreference(kept),
          prefersDark,
        });

        expect(
          drawnOnce(themedPage.html, {
            kept,
            prefersDark,
            url: themedPage.url,
          }),
        ).toEqual(drawnFor(expected));
      },
    );

    it("follows the device when storage is blocked", () => {
      expect(
        drawnOnce(themedPage.html, {
          storageBlocked: true,
          prefersDark: true,
          url: themedPage.url,
        }),
      ).toEqual(DARK);
      expect(
        drawnOnce(themedPage.html, {
          storageBlocked: true,
          prefersDark: false,
          url: themedPage.url,
        }),
      ).toEqual(LIGHT);
    });

    it("is light where the browser cannot say how the device is set, unless Dark was picked", () => {
      expect(
        drawnOnce(themedPage.html, { noMatchMedia: true, url: themedPage.url }),
      ).toEqual(LIGHT);
      expect(
        drawnOnce(themedPage.html, {
          noMatchMedia: true,
          kept: "dark",
          url: themedPage.url,
        }),
      ).toEqual(DARK);
    });
  });

  describe("while it is open", () => {
    if (themedPage.followsChanges) {
      it("changes with the device when the pick is System, or nothing", () => {
        for (const kept of [undefined, "system"]) {
          const page: OpenedPage = openPage(themedPage.html, {
            kept,
            prefersDark: false,
            url: themedPage.url,
          });

          expect(page.drawn()).toEqual(LIGHT);
          page.setDevice(true);
          expect(page.drawn()).toEqual(DARK);
          page.setDevice(false);
          expect(page.drawn()).toEqual(LIGHT);
          page.close();
        }
      });

      it("keeps Light and Dark when the device changes", () => {
        const page: OpenedPage = openPage(themedPage.html, {
          kept: "dark",
          prefersDark: false,
          url: themedPage.url,
        });

        page.setDevice(true);
        page.setDevice(false);
        expect(page.drawn()).toEqual(DARK);
        page.close();
      });

      it("draws a pick made in another tab, and the device once the pick is gone", () => {
        const page: OpenedPage = openPage(themedPage.html, {
          prefersDark: true,
          url: themedPage.url,
        });

        expect(page.drawn()).toEqual(DARK);
        page.pickInAnotherTab("light");
        expect(page.drawn()).toEqual(LIGHT);
        page.pickInAnotherTab(null);
        expect(page.drawn()).toEqual(DARK);
        page.close();
      });
    } else {
      it("leaves following changes to its app (ThemeUtil), which also knows a pick the browser would not keep", () => {
        const page: OpenedPage = openPage(themedPage.html, {
          prefersDark: false,
          url: themedPage.url,
        });

        expect(page.mediaListeners()).toBe(0);
        page.setDevice(true);
        expect(page.drawn()).toEqual(LIGHT);
        page.close();
      });
    }
  });
});

describe("the sign-in pages", () => {
  const html: string = renderView(frontendIndex("Accounts"), {});

  it.each([
    "/accounts/form/0f8fad5b-d9cb-469f-a165-70867728950e",
    "/accounts/incident-form/0f8fad5b-d9cb-469f-a165-70867728950e",
  ])(
    "draw a public form (%s) light, whatever was picked and however the device is set",
    (address: string) => {
      for (const kept of [undefined, "dark", "system"]) {
        expect(
          drawnOnce(html, {
            kept,
            prefersDark: true,
            url: `https://oneuptime.example.com${address}`,
          }),
        ).toEqual(LIGHT);
      }
    },
  );

  it.each([
    "/accounts",
    "/accounts/login",
    "/accounts/sso",
    "/accounts/register",
    "/accounts/forgot-password",
    "/accounts/reset-password",
    "/accounts/verify-email",
    "/accounts/admin-login",
    "/accounts/mcp-authorize",
    "/accounts/marketplace",
    "/accounts/mobile-passkey",
    "/accounts/forms",
    "/accounts/formx/1",
  ])("draw %s in the person's theme", (address: string) => {
    expect(
      drawnOnce(html, {
        kept: "dark",
        url: `https://oneuptime.example.com${address}`,
      }),
    ).toEqual(DARK);
    expect(
      drawnOnce(html, {
        prefersDark: true,
        url: `https://oneuptime.example.com${address}`,
      }),
    ).toEqual(DARK);
  });

  it("draw their body on the page's own ground, which the dark theme repaints (Theme.css)", () => {
    expect(html).toContain('<body class="h-full bg-gray-50">');
  });
});

describe("the Dashboard's offline page", () => {
  /*
   * A static file the service worker serves when the network is gone: it
   * cannot include the partial, so it carries the same rules in a script of
   * its own, which must draw exactly what the partial draws.
   */
  const html: string = fs.readFileSync(OFFLINE_PAGE, "utf8");

  it("reads the same key and asks the same question of the device", () => {
    expect(html).toContain(`"${THEME_STORAGE_KEY}"`);
    expect(html).toContain(`"${DARK_COLOR_SCHEME_MEDIA_QUERY}"`);
    expect(html).toContain(`"${THEME_COLORS[Theme.Dark]}"`);
    expect(html).toContain(`"${THEME_COLORS[Theme.Light]}"`);
  });

  it.each(
    KEPT_VALUES.flatMap(
      (kept: string | undefined): Array<[string, boolean]> => {
        return [
          [kept === undefined ? "nothing" : JSON.stringify(kept), false],
          [kept === undefined ? "nothing" : JSON.stringify(kept), true],
        ];
      },
    ),
  )(
    "draws a browser that kept %s, on a device that prefers dark: %p, as the partial does",
    (label: string, prefersDark: boolean) => {
      const kept: string | undefined =
        label === "nothing" ? undefined : (JSON.parse(label) as string);
      const expected: Theme = getThemeForPreference({
        preference: parseThemePreference(kept),
        prefersDark,
      });

      expect(drawnOnce(html, { kept, prefersDark })).toEqual(
        drawnFor(expected),
      );
    },
  );

  it("follows the device when storage is blocked", () => {
    expect(
      drawnOnce(html, { storageBlocked: true, prefersDark: true }),
    ).toEqual(DARK);
  });
});
