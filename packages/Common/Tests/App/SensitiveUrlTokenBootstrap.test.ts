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
 * the path before the container starts, and by refusing to start the container
 * at all if the rewrite did not take. Both halves are load-order sensitive and
 * invisible at runtime when they break — a tag moved above the partial, or a
 * `return` dropped from the GTM guard, leaks silently and no other suite would
 * notice — so they are pinned here.
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

function loadPage(origin: Origin, url: string): JSDOM {
  return new JSDOM(render(origin, true), {
    url,
    runScripts: "dangerously",
    beforeParse: (pageWindow: JSDOM["window"]): void => {
      (pageWindow as any).tailwind = { config: {} };
    },
  });
}

function gtmScript(page: JSDOM): Element | null {
  return page.window.document.querySelector(
    'script[src^="https://www.googletagmanager.com/gtm.js"]',
  );
}

describe("the sensitive-URL-token partial", () => {
  it("keeps its route list in step with the client that reads the stash", () => {
    /*
     * The partial decides which paths to strip; Common/UI/Utils/SensitiveUrlToken
     * decides which paths still hold a token when the strip did not run. A route
     * added to one and not the other either leaks (stripped nowhere) or breaks
     * the flow (stripped, then unreadable).
     */
    const routeList: string = `["reset-password", "verify-email"]`;

    expect(fs.readFileSync(PARTIAL_PATH, "utf8")).toContain(routeList);
    expect(fs.readFileSync(CLIENT_UTIL_PATH, "utf8")).toContain(routeList);
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
      expect(html.indexOf("googletagmanager.com/gtm.js")).toBeGreaterThan(
        bootstrap,
      );
    });

    it("moves the token out of the address bar before page scripts run", () => {
      const page: JSDOM = loadPage(origin, origin.tokenUrl);

      expect(page.window.location.pathname).toBe(origin.cleanedPath);
      expect(page.window.location.href).not.toContain(TOKEN);
      expect(page.window.sessionStorage.getItem(STORAGE_KEY)).toBe(TOKEN);

      page.window.close();
    });

    it("still starts analytics once the token is out of the URL", () => {
      /*
       * The fix must not cost the signup funnel its reporting. Stripping the
       * token is what makes the page safe to measure, not switching measurement
       * off.
       */
      const page: JSDOM = loadPage(origin, origin.tokenUrl);

      expect(
        (page.window as any).__ONEUPTIME_SENSITIVE_URL_TOKEN_PENDING__,
      ).toBe(false);
      expect(gtmScript(page)).not.toBeNull();

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
          pageWindow.history.replaceState = (): void => {
            throw new Error("replaceState unavailable");
          };
        },
      });

      expect(page.window.location.href).toContain(TOKEN);
      expect(
        (page.window as any).__ONEUPTIME_SENSITIVE_URL_TOKEN_PENDING__,
      ).toBe(true);
      expect(gtmScript(page)).toBeNull();

      page.window.close();
    });

    it("leaves ordinary pages untouched", () => {
      const page: JSDOM = loadPage(origin, origin.ordinaryUrl);

      expect(page.window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
      expect(
        (page.window as any).__ONEUPTIME_SENSITIVE_URL_TOKEN_PENDING__,
      ).toBe(false);
      expect(gtmScript(page)).not.toBeNull();

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
