import { describe, expect, it } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import { JSDOM } from "jsdom";
import path from "path";

/*
 * Password reset and email verification links carry a single-use bearer token
 * in the URL path. Every analytics and advertising tag on the page reports the
 * page URL as a matter of course, so the token used to leave the browser to
 * whoever the Google Tag Manager container happened to be loading. Measured on
 * production before the fix, one visit to /accounts/reset-password/<token> sent
 * the token to region1.analytics.google.com, www.google.com, bat.bing.com,
 * q.quora.com and alb.reddit.com.
 *
 * Common/Server/Views/Partials/SensitiveUrlToken.ejs closes that by rewriting
 * the path before any tag starts, and the Google tag loader in
 * Common/Server/Views/Partials/AnalyticsConsent.ejs refuses to load at all if
 * the rewrite did not take. Both halves are load-order sensitive and invisible
 * at runtime when they break — a tag moved above the partial, or a `return`
 * dropped from the loader's guard, leaks silently and no other suite would
 * notice — so they are pinned here.
 *
 * Sign-up now loads Google Analytics alone, and only once consent allows; a
 * status page loads no Google tag at all. The pages here are loaded as a
 * visitor who has accepted, so the token is the only thing that can hold the
 * tag back.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..");

const STORAGE_KEY: string = "oneuptime-sensitive-url-token";

const PARTIAL_PATH: string = path.join(
  REPOSITORY_ROOT,
  "Common",
  "Server",
  "Views",
  "Partials",
  "SensitiveUrlToken.ejs",
);

const CLIENT_UTIL_PATH: string = path.join(
  REPOSITORY_ROOT,
  "Common",
  "UI",
  "Utils",
  "SensitiveUrlToken.ts",
);

interface Origin {
  label: string;
  viewPath: string;
  // The first external script tag on the page; the bootstrap must precede it.
  firstExternalScript: string;
  /*
   * The Google tag this origin loads once measurement is allowed, or null for
   * an origin that never loads one.
   */
  googleTag: string | null;
  // A token-bearing URL served by this origin, and the path it must become.
  tokenUrl: string;
  cleanedPath: string;
  // A page on the same origin that carries no token.
  ordinaryUrl: string;
}

const ORIGINS: Array<Origin> = [
  {
    label: "accounts",
    viewPath: path.join(
      REPOSITORY_ROOT,
      "App",
      "FeatureSet",
      "Accounts",
      "views",
      "index.ejs",
    ),
    firstExternalScript: '<script src="/accounts/env.js">',
    // Google Analytics alone: no Tag Manager container on sign-up.
    googleTag: "https://www.googletagmanager.com/gtag/js?id=G-76XZF1WF3Z",
    tokenUrl:
      "https://oneuptime.com/accounts/reset-password/1522e9be-84cd-44b7-8fc9-606545bfa732",
    cleanedPath: "/accounts/reset-password",
    ordinaryUrl: "https://oneuptime.com/accounts/login",
  },
  {
    label: "status page",
    viewPath: path.join(
      REPOSITORY_ROOT,
      "App",
      "FeatureSet",
      "StatusPage",
      "views",
      "index.ejs",
    ),
    firstExternalScript: '<script src="/status-page/env.js">',
    // A customer's page: OneUptime measures nothing on it.
    googleTag: null,
    tokenUrl:
      "https://status.example/reset-password/1522e9be-84cd-44b7-8fc9-606545bfa732",
    cleanedPath: "/reset-password",
    ordinaryUrl: "https://status.example/login",
  },
];

const TOKEN: string = "1522e9be-84cd-44b7-8fc9-606545bfa732";

function render(origin: Origin, enableGoogleTagManager: boolean): string {
  return ejs.render(
    fs.readFileSync(origin.viewPath, "utf8"),
    { title: "Acme Status", enableGoogleTagManager },
    { filename: origin.viewPath },
  );
}

/*
 * A visitor who has accepted on the cookie banner, so that measurement is
 * allowed wherever they are and the only thing that can hold a tag back is
 * the token.
 */
function allowMeasurement(pageWindow: JSDOM["window"]): void {
  pageWindow.localStorage.setItem("cookiesAccepted", "true");
}

function loadPage(origin: Origin, url: string): JSDOM {
  return new JSDOM(render(origin, true), {
    url,
    runScripts: "dangerously",
    beforeParse: (pageWindow: JSDOM["window"]): void => {
      (pageWindow as any).tailwind = { config: {} };
      allowMeasurement(pageWindow);
    },
  });
}

function googleTagScripts(page: JSDOM): Array<Element> {
  return Array.from(
    page.window.document.querySelectorAll(
      'script[src*="googletagmanager.com"]',
    ),
  );
}

function expectGoogleTag(origin: Origin, page: JSDOM): void {
  const sources: Array<string | null> = googleTagScripts(page).map(
    (script: Element) => {
      return script.getAttribute("src");
    },
  );

  expect(sources).toEqual(origin.googleTag ? [origin.googleTag] : []);
}

describe("the sensitive-URL-token partial", () => {
  it("keeps its route list in step with the client that reads the stash", () => {
    /*
     * The partial decides which paths to strip; Common/UI/Utils/SensitiveUrlToken
     * decides which paths still hold a token when the strip did not run. A route
     * added to one and not the other either leaks (stripped nowhere) or breaks
     * the flow (stripped, then unreadable).
     */
    const routeListOf: (file: string) => Array<string> = (
      file: string,
    ): Array<string> => {
      const match: RegExpMatchArray | null = fs
        .readFileSync(file, "utf8")
        .match(/TOKEN_ROUTES(?::\s*Array<string>)?\s*=\s*\[([^\]]*)\]/);

      expect(match).not.toBeNull();

      return (match![1]!.match(/"[^"]+"/g) || []).map((entry: string) => {
        return entry.slice(1, -1);
      });
    };

    const expectedRoutes: Array<string> = [
      "reset-password",
      "verify-email",
      // A status page subscriber's unsubscribe link: .../unsubscribe/<id>-<token>.
      "unsubscribe",
      // Its manage link, with the same credential: .../update-subscription/<id>-<token>.
      "update-subscription",
    ];

    expect(routeListOf(PARTIAL_PATH)).toEqual(expectedRoutes);
    expect(routeListOf(CLIENT_UTIL_PATH)).toEqual(expectedRoutes);
  });

  it("agrees with the client on the storage key", () => {
    expect(fs.readFileSync(PARTIAL_PATH, "utf8")).toContain(`"${STORAGE_KEY}"`);
    expect(fs.readFileSync(CLIENT_UTIL_PATH, "utf8")).toContain(
      `"${STORAGE_KEY}"`,
    );
  });
});

for (const origin of ORIGINS) {
  describe(`${origin.label}: sensitive URL tokens`, () => {
    it("runs the bootstrap before any external script and declares no-referrer", () => {
      const html: string = render(origin, true);
      const bootstrap: number = html.indexOf(
        `var STORAGE_KEY = "${STORAGE_KEY}"`,
      );

      expect(bootstrap).toBeGreaterThan(-1);
      expect(html).toContain('<meta name="referrer" content="no-referrer" />');

      /*
       * Ordering is the whole mechanism. Anything that loads before the
       * bootstrap sees the token.
       */
      expect(html.indexOf(origin.firstExternalScript)).toBeGreaterThan(
        bootstrap,
      );

      if (origin.googleTag) {
        expect(html.indexOf(origin.googleTag)).toBeGreaterThan(bootstrap);
      } else {
        expect(html).not.toContain("googletagmanager.com");
      }

      // Never the container, on either origin.
      expect(html).not.toContain("googletagmanager.com/gtm.js");
    });

    it("moves the token out of the address bar before page scripts run", () => {
      const page: JSDOM = loadPage(origin, origin.tokenUrl);

      expect(page.window.location.pathname).toBe(origin.cleanedPath);
      expect(page.window.location.href).not.toContain(TOKEN);
      expect(page.window.sessionStorage.getItem(STORAGE_KEY)).toBe(TOKEN);

      page.window.close();
    });

    it("measures as it would anyway once the token is out of the URL", () => {
      /*
       * The fix must not cost the signup funnel its reporting. Stripping the
       * token is what makes the page safe to measure, not switching measurement
       * off - so sign-up still loads Google Analytics, and a status page, which
       * loads no Google tag at all, still loads none.
       */
      const page: JSDOM = loadPage(origin, origin.tokenUrl);

      expect(
        (page.window as any).__ONEUPTIME_SENSITIVE_URL_TOKEN_PENDING__,
      ).toBe(false);
      expectGoogleTag(origin, page);

      page.window.close();
    });

    it("suppresses analytics entirely when the token cannot be removed", () => {
      /*
       * Fail closed. If replaceState is unavailable, the token is still in the
       * URL every tag is about to report, so no tag may load. Losing a page
       * view is the cheaper failure.
       */
      const page: JSDOM = new JSDOM(render(origin, true), {
        url: origin.tokenUrl,
        runScripts: "dangerously",
        beforeParse: (pageWindow: JSDOM["window"]): void => {
          (pageWindow as any).tailwind = { config: {} };
          // Consent is given, so the token is the only thing in the way.
          allowMeasurement(pageWindow);
          pageWindow.history.replaceState = (): void => {
            throw new Error("replaceState unavailable");
          };
        },
      });

      expect(page.window.location.href).toContain(TOKEN);
      expect(
        (page.window as any).__ONEUPTIME_SENSITIVE_URL_TOKEN_PENDING__,
      ).toBe(true);
      expect(googleTagScripts(page)).toEqual([]);

      page.window.close();
    });

    it("leaves ordinary pages untouched", () => {
      const page: JSDOM = loadPage(origin, origin.ordinaryUrl);

      expect(page.window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
      expect(
        (page.window as any).__ONEUPTIME_SENSITIVE_URL_TOKEN_PENDING__,
      ).toBe(false);
      expectGoogleTag(origin, page);

      page.window.close();
    });
  });
}

describe("accounts: email verification tokens", () => {
  const accounts: Origin = ORIGINS[0]!;

  it("strips the verify-email token too", () => {
    const page: JSDOM = loadPage(
      accounts,
      `https://oneuptime.com/accounts/verify-email/${TOKEN}`,
    );

    expect(page.window.location.pathname).toBe("/accounts/verify-email");
    expect(page.window.sessionStorage.getItem(STORAGE_KEY)).toBe(TOKEN);

    page.window.close();
  });

  it("preserves the query string and fragment around the stripped token", () => {
    const page: JSDOM = loadPage(
      accounts,
      `https://oneuptime.com/accounts/reset-password/${TOKEN}?utm_source=email#top`,
    );

    expect(page.window.location.pathname).toBe("/accounts/reset-password");
    expect(page.window.location.search).toBe("?utm_source=email");
    expect(page.window.location.hash).toBe("#top");

    page.window.close();
  });
});

describe("status page: unsubscribe links", () => {
  const statusPage: Origin = ORIGINS[1]!;

  /*
   * The link in every subscriber notification. Its last segment is the
   * subscriber id and its unsubscribe token together; the token is what lets
   * anyone holding the link unsubscribe without signing in, so it must never
   * reach an analytics tag a status page loads.
   */
  const CREDENTIAL: string = `${TOKEN}-${"ab".repeat(32)}`;

  it("strips the credential from a custom-domain unsubscribe link", () => {
    const page: JSDOM = loadPage(
      statusPage,
      `https://status.example/unsubscribe/${CREDENTIAL}`,
    );

    expect(page.window.location.pathname).toBe("/unsubscribe");
    expect(page.window.location.href).not.toContain(CREDENTIAL);
    expect(page.window.sessionStorage.getItem(STORAGE_KEY)).toBe(CREDENTIAL);
    expect((page.window as any).__ONEUPTIME_SENSITIVE_URL_TOKEN_PENDING__).toBe(
      false,
    );

    page.window.close();
  });

  it("strips it from a status page's own address too", () => {
    const page: JSDOM = loadPage(
      statusPage,
      `https://oneuptime.com/status-page/${TOKEN}/unsubscribe/${CREDENTIAL}`,
    );

    expect(page.window.location.pathname).toBe(
      `/status-page/${TOKEN}/unsubscribe`,
    );
    expect(page.window.sessionStorage.getItem(STORAGE_KEY)).toBe(CREDENTIAL);

    page.window.close();
  });
});

describe("status page: manage subscription links", () => {
  const statusPage: Origin = ORIGINS[1]!;

  /*
   * The link in the "manage your subscription" message carries the same
   * credential as the unsubscribe link, and its token lets the holder change
   * or cancel the subscription - so it leaves the address bar the same way,
   * before any tag a status page loads can report it.
   */
  const CREDENTIAL: string = `${TOKEN}-${"cd".repeat(32)}`;

  it("strips the credential from a custom-domain manage link", () => {
    const page: JSDOM = loadPage(
      statusPage,
      `https://status.example/update-subscription/${CREDENTIAL}`,
    );

    expect(page.window.location.pathname).toBe("/update-subscription");
    expect(page.window.location.href).not.toContain(CREDENTIAL);
    expect(page.window.sessionStorage.getItem(STORAGE_KEY)).toBe(CREDENTIAL);
    expect((page.window as any).__ONEUPTIME_SENSITIVE_URL_TOKEN_PENDING__).toBe(
      false,
    );

    page.window.close();
  });

  it("strips it from a status page's own address too", () => {
    const page: JSDOM = loadPage(
      statusPage,
      `https://oneuptime.com/status-page/${TOKEN}/update-subscription/${CREDENTIAL}`,
    );

    expect(page.window.location.pathname).toBe(
      `/status-page/${TOKEN}/update-subscription`,
    );
    expect(page.window.location.href).not.toContain(CREDENTIAL);
    expect(page.window.sessionStorage.getItem(STORAGE_KEY)).toBe(CREDENTIAL);

    page.window.close();
  });

  it("an old manage link that carries only the subscriber id leaves the address bar too", () => {
    const page: JSDOM = loadPage(
      statusPage,
      `https://status.example/update-subscription/${TOKEN}`,
    );

    expect(page.window.location.pathname).toBe("/update-subscription");
    // The page reads it back and says the link has expired.
    expect(page.window.sessionStorage.getItem(STORAGE_KEY)).toBe(TOKEN);

    page.window.close();
  });
});
