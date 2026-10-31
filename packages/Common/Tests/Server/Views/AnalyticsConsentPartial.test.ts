import { describe, expect, test } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import path from "path";

/*
 * Which OneUptime pages measure anything, with which tag, and on whose say-so.
 *
 * Consent has been wrong here in both directions. Consent Mode and the
 * attribution capture first lived only on the marketing site, so /accounts and
 * /dashboard loaded the same Tag Manager container with no consent signal at
 * all. Then the partial was shared but the gate was taken out: Consent Mode
 * defaulted to granted everywhere and "Reject all" changed nothing - while
 * about a third of search traffic came from the EEA, the UK and Switzerland.
 *
 * Now one rule, window.oneUptimeConsent.isAllowed(), decides for every tag on
 * every OneUptime-owned origin: an answer on the banner wins; with none, Global
 * Privacy Control is a refusal; otherwise measurement waits for "Accept all"
 * where the law asks for consent first and runs until "Reject all" elsewhere.
 * Customers' pages - status pages, public dashboards - and the admin console
 * measure nothing at all.
 *
 * These render each page the way Express does and assert ORDER and SAMENESS: a
 * consent default that arrives after a tag has read the dataLayer is not a
 * default, and a tag loaded outside the gate is a tag the banner cannot stop.
 * What the rule itself does in a browser is exercised in
 * AnalyticsConsentBehaviour.test.ts.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

const PARTIAL_PATH: string = path.join(
  REPOSITORY_ROOT,
  "Common",
  "Server",
  "Views",
  "Partials",
  "AnalyticsConsent.ejs",
);

const CONTAINER_URL: string =
  "https://www.googletagmanager.com/gtm.js?id=GTM-PKQD5WH";
const ANALYTICS_URL: string =
  "https://www.googletagmanager.com/gtag/js?id=G-76XZF1WF3Z";

const CONSENT_DEFAULT: string = "pushConsentSignal('default', isAllowed())";
const CONSENT_UPDATE: string = "pushConsentSignal('update', granted)";
const TAG_GATE: string = "window.oneUptimeConsent.whenAllowed(loadGoogleTag)";

interface Page {
  label: string;
  viewPath: string;
  // Locals the view needs to render at all, beyond the analytics flag.
  locals?: Record<string, unknown> | undefined;
}

interface MeasuringPage extends Page {
  // The one Google tag this page may load, once consent allows.
  googleTag: string;
}

const viewPath: (...segments: Array<string>) => string = (
  ...segments: Array<string>
): string => {
  return path.join(REPOSITORY_ROOT, ...segments);
};

/*
 * Every OneUptime-owned page that measures anything. The website - the
 * marketing site, the docs and the API reference - loads the Tag Manager
 * container; sign-up and the dashboard load Google Analytics alone, so no
 * advertising pixel or visitor identification tool runs in the product.
 */
const MEASURING_PAGES: Array<MeasuringPage> = [
  {
    label: "marketing site",
    viewPath: viewPath("Home", "Views", "head-basic.ejs"),
    googleTag: CONTAINER_URL,
  },
  {
    label: "docs",
    viewPath: viewPath(
      "App",
      "FeatureSet",
      "Docs",
      "Views",
      "Partials",
      "Head.ejs",
    ),
    locals: {
      t: (key: string): string => {
        return key;
      },
    },
    googleTag: CONTAINER_URL,
  },
  {
    label: "API reference",
    viewPath: viewPath(
      "App",
      "FeatureSet",
      "APIReference",
      "views",
      "partials",
      "head.ejs",
    ),
    locals: { pageTitle: "Monitors", pageDescription: "The Monitor API." },
    googleTag: CONTAINER_URL,
  },
  {
    label: "accounts (sign-up)",
    viewPath: viewPath("App", "FeatureSet", "Accounts", "views", "index.ejs"),
    googleTag: ANALYTICS_URL,
  },
  {
    label: "dashboard",
    viewPath: viewPath("App", "FeatureSet", "Dashboard", "views", "index.ejs"),
    googleTag: ANALYTICS_URL,
  },
];

interface SilentPage extends Page {
  // The application bundle, which must find measurement already switched off.
  appBundle: string;
}

/*
 * Pages that measure nothing for OneUptime, even on OneUptime Cloud. Status
 * pages and public dashboards belong to OneUptime's customers - often on the
 * customer's own domain - and their visitors are not OneUptime's to measure.
 * The admin console is an internal tool with no funnel in it.
 */
const SILENT_PAGES: Array<SilentPage> = [
  {
    label: "status page",
    viewPath: viewPath("App", "FeatureSet", "StatusPage", "views", "index.ejs"),
    locals: { title: "Acme Status" },
    appBundle: '<script type="module" src="/status-page/dist/Index.js">',
  },
  {
    label: "public dashboard",
    viewPath: viewPath(
      "App",
      "FeatureSet",
      "PublicDashboard",
      "views",
      "index.ejs",
    ),
    locals: { title: "Acme Dashboard" },
    appBundle: '<script type="module" src="/public-dashboard/dist/Index.js">',
  },
  {
    label: "admin dashboard",
    viewPath: viewPath(
      "App",
      "FeatureSet",
      "AdminDashboard",
      "views",
      "index.ejs",
    ),
    appBundle: '<script type="module" src="/admin/dist/Index.js">',
  },
  /*
   * A form on its owner's own domain (App/FeatureSet/Frontend/
   * FormDomainPage.ts): the sign-in app's page, but the customer's.
   */
  {
    label: "a form on its own domain",
    viewPath: viewPath("App", "FeatureSet", "Accounts", "views", "index.ejs"),
    locals: {
      isFormDomainPage: true,
      formDomainPageTitle: "Report a Problem",
    },
    appBundle: '<script type="module" src="/accounts/dist/Index.js">',
  },
];

type RenderPageFunction = (
  page: Page,
  enableGoogleTagManager: boolean,
) => string;

const renderPage: RenderPageFunction = (
  page: Page,
  enableGoogleTagManager: boolean,
): string => {
  return ejs.render(
    fs.readFileSync(page.viewPath, "utf-8"),
    { ...(page.locals || {}), enableGoogleTagManager: enableGoogleTagManager },
    { filename: page.viewPath },
  );
};

type CountFunction = (haystack: string, needle: string) => number;

const count: CountFunction = (haystack: string, needle: string): number => {
  return haystack.split(needle).length - 1;
};

describe("the shared analytics consent partial", () => {
  const source: string = fs.readFileSync(PARTIAL_PATH, "utf-8");

  test("exists in Common, so every origin can reach it", () => {
    expect(fs.existsSync(PARTIAL_PATH)).toBe(true);
  });

  test("does not carry Home-only concerns", () => {
    /*
     * The PostHog loader carries Home's own project key, and the home/-prefixed
     * event names are the marketing site's. Moving either here would start the
     * product reporting into Home's funnel. Reporting is handed back to the
     * page through window.oneUptimeOnAttributionCaptured instead.
     */
    expect(source).not.toContain("posthog.init(");
    // The prose may mention them; no code here may emit one.
    expect(source).not.toContain("capture('home/");
    expect(source).toContain("window.oneUptimeOnAttributionCaptured");
  });

  /*
   * The default asserts to Google whether consent was collected. Defaulting to
   * granted unconditionally is a claim about the visitor that was not true for
   * anyone who had not answered - or who had pressed "Reject all".
   */
  test("defaults Consent Mode to what the visitor allows, never to granted outright", () => {
    expect(source).toContain(CONSENT_DEFAULT);
    expect(source).not.toContain("pushConsentSignal('default', true)");
  });

  test("sends every answer to Google as an update", () => {
    expect(source).toContain(CONSENT_UPDATE);
  });

  test("loads both kinds of Google tag only through the consent gate", () => {
    const loader: number = source.indexOf("function loadGoogleTag()");
    const gate: number = source.indexOf(TAG_GATE);

    expect(loader).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(loader);

    for (const tag of [CONTAINER_URL, ANALYTICS_URL]) {
      expect([tag, count(source, tag)]).toEqual([tag, 1]);
      expect(source.indexOf(tag)).toBeGreaterThan(loader);
      expect(source.indexOf(tag)).toBeLessThan(gate);
    }
  });

  test("holds the tag back while a sign-in token is still in the address bar", () => {
    const loader: number = source.indexOf("function loadGoogleTag()");
    const guard: number = source.indexOf(
      "if (window.__ONEUPTIME_SENSITIVE_URL_TOKEN_PENDING__) {",
    );

    expect(guard).toBeGreaterThan(loader);
    expect(guard).toBeLessThan(source.indexOf(CONTAINER_URL));
    expect(guard).toBeLessThan(source.indexOf(ANALYTICS_URL));
  });
});

for (const page of MEASURING_PAGES) {
  describe(page.label, () => {
    const html: string = renderPage(page, true);

    test("defines the consent state machine", () => {
      expect(html).toContain("window.oneUptimeConsent = (function");
    });

    test("captures ad click identifiers", () => {
      expect(html).toContain("window.oneUptimeGetAttribution");
      expect(html).toContain("gclid");
      expect(html).toContain("wbraid");
      expect(html).toContain("gbraid");
    });

    test("reads and writes the same consent storage key as every other origin", () => {
      /*
       * These origins share one hostname on OneUptime Cloud, so they share one
       * localStorage. A different key here would mean the banner answer given
       * on the marketing site simply did not apply on this page.
       */
      expect(html).toContain("var STORAGE_KEY = 'cookiesAccepted';");
    });

    test("loads its own Google tag and no other", () => {
      const otherTag: string =
        page.googleTag === CONTAINER_URL ? ANALYTICS_URL : CONTAINER_URL;

      expect(count(html, page.googleTag)).toBe(1);
      expect(html).not.toContain(otherTag);
      // One Google tag, so no second copy loading outside the gate.
      expect(count(html, "googletagmanager.com")).toBe(1);
    });

    test("pushes the Consent Mode default before the tag can load", () => {
      const consentIndex: number = html.indexOf(CONSENT_DEFAULT);

      expect(consentIndex).toBeGreaterThan(-1);

      /*
       * Consent Mode defaults are read once, when the tag boots; arriving
       * afterwards is the same as never arriving.
       */
      expect(consentIndex).toBeLessThan(html.indexOf(page.googleTag));
    });

    test("loads the tag only once consent allows", () => {
      const loader: number = html.indexOf("function loadGoogleTag()");

      expect(loader).toBeGreaterThan(-1);
      expect(html.indexOf(page.googleTag)).toBeGreaterThan(loader);
      expect(html.indexOf(TAG_GATE)).toBeGreaterThan(
        html.indexOf(page.googleTag),
      );
    });

    /*
     * A <noscript> iframe loads the container in a browser running no script
     * - which means without asking anything. It cannot be gated, so it must
     * not exist.
     */
    test("has no script-free way in", () => {
      expect(html).not.toContain("googletagmanager.com/ns.html");
    });

    test("tells the product code which kind of tag it has", () => {
      expect(html).toContain(
        `window.oneUptimeGoogleTagMode = '${
          page.googleTag === CONTAINER_URL ? "tag-manager" : "analytics-only"
        }';`,
      );
    });

    describe("with analytics switched off (a self-hosted install)", () => {
      const selfHosted: string = renderPage(page, false);

      test("loads no Google tag at all", () => {
        expect(selfHosted).not.toContain("googletagmanager.com");
      });

      test("creates no dataLayer", () => {
        expect(selfHosted).not.toContain(
          "window.dataLayer = window.dataLayer || [];",
        );
      });

      test("still records the banner's answer", () => {
        expect(selfHosted).toContain("window.oneUptimeConsent = (function");
      });
    });
  });
}

for (const page of SILENT_PAGES) {
  describe(`${page.label}: measures nothing for OneUptime`, () => {
    // With the flag on: this is what OneUptime Cloud serves.
    const html: string = renderPage(page, true);

    test("loads no Google tag", () => {
      expect(html).not.toContain("googletagmanager.com");
      expect(html).not.toContain("window.dataLayer");
    });

    /*
     * The attribution capture stores campaign parameters and ad click ids. On
     * a customer's page those are the customer's visitors' - nothing for
     * OneUptime to keep.
     */
    test("captures no attribution", () => {
      expect(html).not.toContain("window.oneUptimeConsent = (function");
      expect(html).not.toContain("window.oneUptimeGetAttribution");
    });

    test("switches the product's own analytics off before the app starts", () => {
      const disabled: number = html.indexOf(
        "window.oneUptimeProductAnalyticsDisabled = true",
      );

      expect(disabled).toBeGreaterThan(-1);
      expect(html.indexOf(page.appBundle)).toBeGreaterThan(disabled);
    });
  });
}

describe("the cookie policy tells the truth", () => {
  const policy: string = fs.readFileSync(
    viewPath("Home", "Views", "cookies.ejs"),
    "utf-8",
  );

  test("says measurement waits for consent where the law asks for it", () => {
    expect(policy).toContain(
      'In the European Economic Area, the United Kingdom and Switzerland, analytics and marketing cookies are not set until you press "Accept all".',
    );
  });

  test('says "Reject all" stops measurement and removes what was set', () => {
    expect(policy).toContain(
      "Rejecting stops them, removes the ones already set, and is remembered.",
    );
  });

  test("says Global Privacy Control counts as a refusal", () => {
    expect(policy).toContain(
      "We treat a Global Privacy Control (GPC) signal as a rejection of analytics and marketing cookies",
    );
  });

  /*
   * The policy said, while it was true, that the tags loaded regardless of the
   * banner. It is no longer true, and a published policy has to keep up.
   */
  test("no longer says the tags load regardless of the banner", () => {
    expect(policy).not.toContain("regardless of that answer");
    expect(policy).not.toContain(
      "regardless of the answer given on the cookie banner",
    );
  });

  test("says the product loads no advertising tags", () => {
    expect(policy).not.toContain(
      "the same analytics and advertising tags as the rest of the Website",
    );
    expect(policy).toContain("They load no advertising tags.");
  });

  test("says customers' status pages and dashboards carry none of OneUptime's tags", () => {
    expect(policy).toContain(
      "Status pages and public dashboards that our customers publish load no OneUptime analytics or advertising tags.",
    );
  });
});

describe("consent can be withdrawn", () => {
  test("the banner exposes a way to reopen itself", () => {
    expect(
      fs.readFileSync(viewPath("Home", "Views", "cookie-banner.ejs"), "utf-8"),
    ).toContain("window.oneUptimeShowCookieSettings");
  });

  test("the footer carries the settings link the policy promises", () => {
    /*
     * The Cookie Policy has always told visitors to use "the cookie settings
     * link in the footer". There was no such link, so a decision could be made
     * once and never revisited - the most commonly enforced banner defect
     * there is.
     */
    const footer: string = fs.readFileSync(
      viewPath("Home", "Views", "footer.ejs"),
      "utf-8",
    );

    expect(footer).toContain("Cookie settings");
    expect(footer).toContain("window.oneUptimeShowCookieSettings");
  });
});
