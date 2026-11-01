/**
 * The pages a person meets after signing out, opened on what signing out left
 * in the browser (UI/Utils/KeptAfterSignOut.ts).
 *
 * Each test runs the real UserUtil.logout(), hands what it left to the next
 * page as a browser would (the same address, the same storage), and runs that
 * page's real template: the theme partial as the sign-in pages, the Dashboard,
 * the Admin Dashboard and the server's own pages include it, and the consent
 * partial every OneUptime page measures through.
 *
 * Issue #5404: the sign-in page drew the device's theme, not the person's,
 * because the pick was gone before it opened. The same call forgot a refusal
 * on the cookie banner, so a person who pressed "Reject all" was measured
 * again from the moment they logged out.
 */

import API from "../../../UI/Utils/API/API";
import UserUtil from "../../../UI/Utils/User";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import {
  DARK_COLOR_SCHEME_MEDIA_QUERY,
  THEME_STORAGE_KEY,
} from "../../../Types/Theme/ThemePreference";
import Analytics from "../../../Utils/Analytics";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import { JSDOM } from "jsdom";
import path from "path";

const PACKAGES: string = path.resolve(__dirname, "..", "..", "..", "..");

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

const CONSENT_PARTIAL: string = path.join(
  PACKAGES,
  "Common",
  "Server",
  "Views",
  "Partials",
  "AnalyticsConsent.ejs",
);

// Log in and out on the Dashboard, and the sign-in page opens next.
const SIGNED_OUT_PAGES: Array<{ name: string; html: string; url: string }> = [
  {
    name: "the sign-in page",
    html: renderView(frontendIndex("Accounts"), {}),
    url: "https://oneuptime.example.com/accounts/login",
  },
  {
    name: "the Dashboard, signed in again",
    html: renderView(frontendIndex("Dashboard"), {}),
    url: "https://oneuptime.example.com/dashboard/",
  },
  {
    name: "the Admin Dashboard, signed in again",
    html: renderView(frontendIndex("AdminDashboard"), {}),
    url: "https://oneuptime.example.com/admin/",
  },
  {
    name: "the single sign-on message",
    html: renderView(
      path.join(
        PACKAGES,
        "App",
        "FeatureSet",
        "Identity",
        "Views",
        "Message.ejs",
      ),
      { title: "Sign in", message: "Ask your administrator." },
    ),
    url: "https://oneuptime.example.com/identity/idp-login/1",
  },
];

const signOutOf: (browser: Record<string, string>) => Record<string, string> = (
  browser: Record<string, string>,
): Record<string, string> => {
  window.localStorage.clear();

  for (const key of Object.keys(browser)) {
    window.localStorage.setItem(key, browser[key]!);
  }

  UserUtil.logout();

  const left: Record<string, string> = {};

  for (let index: number = 0; index < window.localStorage.length; index++) {
    const key: string = window.localStorage.key(index)!;
    left[key] = window.localStorage.getItem(key)!;
  }

  return left;
};

const openWith: (data: {
  html: string;
  url: string;
  browser: Record<string, string>;
  prefersDark?: boolean | undefined;
  timeZone?: string | undefined;
}) => JSDOM = (data: {
  html: string;
  url: string;
  browser: Record<string, string>;
  prefersDark?: boolean | undefined;
  timeZone?: string | undefined;
}): JSDOM => {
  return new JSDOM(data.html, {
    url: data.url,
    runScripts: "dangerously",
    beforeParse: (pageWindow: JSDOM["window"]): void => {
      const target: Record<string, unknown> = pageWindow as unknown as Record<
        string,
        unknown
      >;

      // A later script configures Tailwind, which is not loaded here.
      target["tailwind"] = { config: {} };

      target["matchMedia"] = (query: string): { matches: boolean } => {
        return {
          matches:
            query === DARK_COLOR_SCHEME_MEDIA_QUERY &&
            Boolean(data.prefersDark),
        };
      };

      if (data.timeZone) {
        target["Intl"] = {
          DateTimeFormat: (): unknown => {
            return {
              resolvedOptions: (): { timeZone: string } => {
                return { timeZone: data.timeZone as string };
              },
            };
          },
        };
      }

      for (const key of Object.keys(data.browser)) {
        pageWindow.localStorage.setItem(key, data.browser[key]!);
      }
    },
  });
};

const drawnTheme: (page: JSDOM) => string | null = (
  page: JSDOM,
): string | null => {
  return page.window.document.documentElement.getAttribute("data-theme");
};

beforeEach(() => {
  jest
    .spyOn(API, "post")
    .mockResolvedValue(new HTTPResponse<JSONObject>(200, {}, {}));
});

afterEach(() => {
  jest.restoreAllMocks();
  window.localStorage.clear();
});

describe.each(SIGNED_OUT_PAGES)(
  "$name, opened after signing out",
  (visit: { name: string; html: string; url: string }) => {
    test("a pick of Dark is dark on a light device", () => {
      const page: JSDOM = openWith({
        ...visit,
        browser: signOutOf({ [THEME_STORAGE_KEY]: "dark" }),
        prefersDark: false,
      });

      expect(drawnTheme(page)).toBe("dark");
      expect(
        page.window.document.documentElement.classList.contains("dark"),
      ).toBe(true);
      page.window.close();
    });

    test("a pick of Light is light on a dark device", () => {
      const page: JSDOM = openWith({
        ...visit,
        browser: signOutOf({ [THEME_STORAGE_KEY]: "light" }),
        prefersDark: true,
      });

      expect(drawnTheme(page)).toBe("light");
      expect(
        page.window.document.documentElement.classList.contains("dark"),
      ).toBe(false);
      page.window.close();
    });

    test("a pick of System follows the device", () => {
      const page: JSDOM = openWith({
        ...visit,
        browser: signOutOf({ [THEME_STORAGE_KEY]: "system" }),
        prefersDark: true,
      });

      expect(drawnTheme(page)).toBe("dark");
      page.window.close();
    });

    test("with no pick, the device decides, as on a new browser", () => {
      const onADarkDevice: JSDOM = openWith({
        ...visit,
        browser: signOutOf({}),
        prefersDark: true,
      });
      const onALightDevice: JSDOM = openWith({
        ...visit,
        browser: signOutOf({}),
        prefersDark: false,
      });

      expect(drawnTheme(onADarkDevice)).toBe("dark");
      expect(drawnTheme(onALightDevice)).toBe("light");
      onADarkDevice.window.close();
      onALightDevice.window.close();
    });
  },
);

interface ConsentApi {
  state: () => string;
  isAllowed: () => boolean;
}

const openConsent: (data: {
  browser: Record<string, string>;
  timeZone: string;
}) => { page: JSDOM; consent: ConsentApi } = (data: {
  browser: Record<string, string>;
  timeZone: string;
}): { page: JSDOM; consent: ConsentApi } => {
  const html: string = `<!DOCTYPE html><html><head>${renderView(
    CONSENT_PARTIAL,
    { enableGoogleTagManager: true },
  )}</head><body></body></html>`;

  const page: JSDOM = openWith({
    html,
    url: "https://oneuptime.com/accounts/login",
    browser: data.browser,
    timeZone: data.timeZone,
  });

  return {
    page,
    consent: (page.window as unknown as { oneUptimeConsent: ConsentApi })
      .oneUptimeConsent,
  };
};

// Measurement runs here until it is refused, and waits for consent there.
const NEW_YORK: string = "America/New_York";
const BERLIN: string = "Europe/Berlin";

describe("the answer on the cookie banner, after signing out", () => {
  test.each([NEW_YORK, BERLIN])(
    "a refusal is still a refusal in %s: nothing measures",
    (timeZone: string) => {
      const { page, consent } = openConsent({
        browser: signOutOf({ cookiesAccepted: "false", token: "secret" }),
        timeZone,
      });

      expect(consent.state()).toBe("denied");
      expect(consent.isAllowed()).toBe(false);
      page.window.close();
    },
  );

  test("a person who accepted is not asked again", () => {
    const { page, consent } = openConsent({
      browser: signOutOf({ cookiesAccepted: "true", token: "secret" }),
      timeZone: BERLIN,
    });

    expect(consent.state()).toBe("granted");
    expect(consent.isAllowed()).toBe(true);
    page.window.close();
  });

  test("a browser that never answered still has not answered", () => {
    const { page, consent } = openConsent({
      browser: signOutOf({ token: "secret" }),
      timeZone: BERLIN,
    });

    expect(consent.state()).toBe("unset");
    expect(consent.isAllowed()).toBe(false);
    page.window.close();
  });

  test("the product's own analytics stay off for a person who refused", () => {
    signOutOf({ cookiesAccepted: "false", token: "secret" });

    expect(Analytics.isProductAnalyticsAllowed()).toBe(false);
  });
});
