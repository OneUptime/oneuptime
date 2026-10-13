import { describe, expect, test } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import { JSDOM } from "jsdom";
import path from "path";

/*
 * What Common/Server/Views/Partials/AnalyticsConsent.ejs does in a browser.
 *
 * AnalyticsConsentPartial.test.ts pins which pages include it and in what
 * order; this runs it. The rule under test is window.oneUptimeConsent
 * .isAllowed(): an answer on the cookie banner wins; with none, Global Privacy
 * Control is a refusal; with neither, measurement waits for "Accept all" where
 * the law asks for consent first (the EEA, the UK and Switzerland, read from
 * the browser's time zone) and runs until "Reject all" everywhere else.
 *
 * Every visit names its time zone. The machine running the suite has one of
 * its own, and a test that inherited it would pass in one office and fail in
 * another.
 */

const PARTIAL_PATH: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "Server",
  "Views",
  "Partials",
  "AnalyticsConsent.ejs",
);

const CONTAINER_URL: string =
  "https://www.googletagmanager.com/gtm.js?id=GTM-PKQD5WH";
const ANALYTICS_URL: string =
  "https://www.googletagmanager.com/gtag/js?id=G-76XZF1WF3Z";

// Measurement runs until refused.
const NEW_YORK: string = "America/New_York";
// Measurement waits for consent.
const BERLIN: string = "Europe/Berlin";

const AD_URL: string =
  "https://oneuptime.com/enterprise/demo?utm_source=google&utm_campaign=q3&gclid=abc123";

/*
 * Cookies the tags behind the banner set, and the ones the page needs. A
 * refusal must take the first set and leave the second alone.
 */
const MEASUREMENT_COOKIES: Array<string> = [
  "_ga",
  "_ga_76XZF1WF3Z",
  "_gid",
  "_gcl_au",
  "_fbp",
  "_uetsid",
  "_rdt_uuid",
  "ph_phc_project_posthog",
];
const OTHER_COOKIES: Array<string> = ["session", "oneuptime_theme"];

interface Visit {
  url?: string | undefined;
  // null: the browser has no Intl to ask.
  timeZone: string | null;
  globalPrivacyControl?: boolean | undefined;
  // What an earlier visit stored under cookiesAccepted.
  storedAnswer?: "true" | "false" | undefined;
  storage?: Record<string, string> | undefined;
  // Each "name=value; attributes", written before the page loads.
  cookies?: Array<string> | undefined;
  storageThrows?: boolean | undefined;
  sensitiveTokenPending?: boolean | undefined;
  // enableGoogleTagManager: OneUptime Cloud (true) or self-hosted (false).
  tags?: boolean | undefined;
  googleTagMode?: "tag-manager" | "analytics-only" | undefined;
}

interface ConsentApi {
  state: () => string;
  isGranted: () => boolean;
  isAllowed: () => boolean;
  requiresConsentFirst: () => boolean;
  whenAllowed: (callback: () => void) => void;
  onChange: (listener: (allowed: boolean) => void) => void;
  grant: () => void;
  deny: () => void;
}

interface OpenedPage {
  dom: JSDOM;
  window: any;
  consent: ConsentApi;
  captured: Array<Record<string, string>>;
}

type ConsentCommand = [string, string, Record<string, unknown>];

const renderPartial: (visit: Visit) => string = (visit: Visit): string => {
  const locals: Record<string, unknown> = {
    enableGoogleTagManager: visit.tags !== false,
  };

  if (visit.googleTagMode) {
    locals["googleTagMode"] = visit.googleTagMode;
  }

  return ejs.render(fs.readFileSync(PARTIAL_PATH, "utf8"), locals, {
    filename: PARTIAL_PATH,
  });
};

const fakeIntl: (timeZone: string | null) => unknown = (
  timeZone: string | null,
): unknown => {
  return {
    DateTimeFormat: (): unknown => {
      if (timeZone === null) {
        throw new Error("Intl is unavailable");
      }

      return {
        resolvedOptions: (): { timeZone: string } => {
          return { timeZone };
        },
      };
    },
  };
};

const open: (visit: Visit) => OpenedPage = (visit: Visit): OpenedPage => {
  const captured: Array<Record<string, string>> = [];

  const dom: JSDOM = new JSDOM(
    `<!DOCTYPE html><html><head>${renderPartial(visit)}</head><body></body></html>`,
    {
      url: visit.url || "https://oneuptime.com/pricing",
      runScripts: "dangerously",
      beforeParse: (pageWindow: any): void => {
        pageWindow.Intl = fakeIntl(visit.timeZone);

        if (visit.globalPrivacyControl) {
          Object.defineProperty(pageWindow.navigator, "globalPrivacyControl", {
            configurable: true,
            value: true,
          });
        }

        if (visit.storedAnswer) {
          pageWindow.localStorage.setItem(
            "cookiesAccepted",
            visit.storedAnswer,
          );
        }

        for (const [key, value] of Object.entries(visit.storage || {})) {
          pageWindow.localStorage.setItem(key, value);
        }

        for (const cookie of visit.cookies || []) {
          pageWindow.document.cookie = cookie;
        }

        if (visit.storageThrows) {
          Object.defineProperty(pageWindow, "localStorage", {
            configurable: true,
            get: (): never => {
              throw new Error("storage disabled");
            },
          });
        }

        if (visit.sensitiveTokenPending) {
          pageWindow.__ONEUPTIME_SENSITIVE_URL_TOKEN_PENDING__ = true;
        }

        // The page's own reporting hook, which the partial calls back.
        pageWindow.oneUptimeOnAttributionCaptured = (
          properties: Record<string, string>,
        ): void => {
          captured.push(properties);
        };
      },
    },
  );

  return {
    dom,
    window: dom.window,
    consent: (dom.window as any).oneUptimeConsent as ConsentApi,
    captured,
  };
};

const loaded: (page: OpenedPage) => Promise<void> = (
  page: OpenedPage,
): Promise<void> => {
  return new Promise<void>((resolve: () => void) => {
    if (page.window.document.readyState === "complete") {
      resolve();
      return;
    }

    page.window.addEventListener("load", () => {
      resolve();
    });
  });
};

const googleTagSources: (page: OpenedPage) => Array<string | null> = (
  page: OpenedPage,
): Array<string | null> => {
  return Array.from(
    page.window.document.querySelectorAll(
      'script[src*="googletagmanager.com"]',
    ) as ArrayLike<Element>,
  ).map((script: Element) => {
    return script.getAttribute("src");
  });
};

const dataLayerCommands: (page: OpenedPage) => Array<Array<unknown>> = (
  page: OpenedPage,
): Array<Array<unknown>> => {
  return ((page.window.dataLayer || []) as Array<unknown>)
    .filter((entry: unknown) => {
      // gtag() pushes its arguments object; the container pushes plain events.
      return Object.prototype.toString.call(entry) === "[object Arguments]";
    })
    .map((entry: unknown) => {
      return Array.from(entry as ArrayLike<unknown>);
    });
};

const consentCommands: (page: OpenedPage) => Array<ConsentCommand> = (
  page: OpenedPage,
): Array<ConsentCommand> => {
  return dataLayerCommands(page).filter((command: Array<unknown>) => {
    return command[0] === "consent";
  }) as Array<ConsentCommand>;
};

const cookieNames: (page: OpenedPage) => Array<string> = (
  page: OpenedPage,
): Array<string> => {
  const raw: string = page.window.document.cookie as string;

  return raw
    ? raw.split(";").map((cookie: string) => {
        return cookie.split("=")[0]!.trim();
      })
    : [];
};

const SIGNALS: Array<string> = [
  "ad_storage",
  "ad_user_data",
  "ad_personalization",
  "analytics_storage",
  "functionality_storage",
  "personalization_storage",
];

const everySignal: (value: string) => Record<string, string> = (
  value: string,
): Record<string, string> => {
  const signal: Record<string, string> = {};

  for (const name of SIGNALS) {
    signal[name] = value;
  }

  // Fraud prevention and the like, granted under Consent Mode's own guidance.
  signal["security_storage"] = "granted";

  return signal;
};

describe("where measurement runs until it is refused", () => {
  test("is allowed without asking", () => {
    const page: OpenedPage = open({ timeZone: NEW_YORK });

    expect(page.consent.state()).toBe("unset");
    expect(page.consent.requiresConsentFirst()).toBe(false);
    expect(page.consent.isAllowed()).toBe(true);
    page.window.close();
  });

  test("defaults Consent Mode to granted, and has the tag wait briefly for an update", () => {
    const page: OpenedPage = open({ timeZone: NEW_YORK });

    expect(consentCommands(page)).toEqual([
      [
        "consent",
        "default",
        { ...everySignal("granted"), wait_for_update: 500 },
      ],
    ]);
    page.window.close();
  });

  test("loads the Tag Manager container at once", () => {
    const page: OpenedPage = open({ timeZone: NEW_YORK });

    expect(googleTagSources(page)).toEqual([CONTAINER_URL]);
    expect(page.window.dataLayer).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "gtm.js",
          "gtm.start": expect.any(Number),
        }),
      ]),
    );
    page.window.close();
  });

  describe('"Reject all"', () => {
    const loadWithCookies: () => OpenedPage = (): OpenedPage => {
      return open({
        timeZone: NEW_YORK,
        cookies: [
          ...MEASUREMENT_COOKIES.map((name: string) => {
            return `${name}=1; path=/`;
          }),
          ...OTHER_COOKIES.map((name: string) => {
            return `${name}=1; path=/`;
          }),
        ],
        storage: { ph_phc_project_posthog: "{}", theme: "dark" },
      });
    };

    const rejectAfterLoad: () => OpenedPage = (): OpenedPage => {
      const page: OpenedPage = loadWithCookies();

      page.consent.deny();

      return page;
    };

    // The control: everything below is the refusal's doing, not the load's.
    test("leaves every cookie in place until it is pressed", () => {
      const page: OpenedPage = loadWithCookies();

      expect(cookieNames(page).sort()).toEqual(
        [...MEASUREMENT_COOKIES, ...OTHER_COOKIES].sort(),
      );
      expect(page.window.localStorage.getItem("ph_phc_project_posthog")).toBe(
        "{}",
      );
      page.window.close();
    });

    test("tells the Google tags already on the page", () => {
      const page: OpenedPage = rejectAfterLoad();
      const commands: Array<ConsentCommand> = consentCommands(page);

      // An update, with no wait: there is nothing left to wait for.
      expect(commands[commands.length - 1]).toEqual([
        "consent",
        "update",
        everySignal("denied"),
      ]);
      page.window.close();
    });

    test("removes the measurement cookies, and only those", () => {
      const page: OpenedPage = rejectAfterLoad();

      expect(cookieNames(page).sort()).toEqual([...OTHER_COOKIES].sort());
      page.window.close();
    });

    test("removes PostHog's stored state, and nothing else", () => {
      const page: OpenedPage = rejectAfterLoad();

      expect(
        page.window.localStorage.getItem("ph_phc_project_posthog"),
      ).toBeNull();
      expect(page.window.localStorage.getItem("theme")).toBe("dark");
      page.window.close();
    });

    test("is remembered", () => {
      const page: OpenedPage = rejectAfterLoad();

      expect(page.window.localStorage.getItem("cookiesAccepted")).toBe("false");
      expect(page.consent.state()).toBe("denied");
      expect(page.consent.isAllowed()).toBe(false);
      page.window.close();
    });
  });

  describe("after a refusal on an earlier visit", () => {
    const refused: () => OpenedPage = (): OpenedPage => {
      return open({
        timeZone: NEW_YORK,
        storedAnswer: "false",
        cookies: ["_ga=GA1.1.1; path=/", "session=1; path=/"],
      });
    };

    test("loads no Google tag", () => {
      const page: OpenedPage = refused();

      expect(googleTagSources(page)).toEqual([]);
      page.window.close();
    });

    test("defaults Consent Mode to denied", () => {
      const page: OpenedPage = refused();

      expect(consentCommands(page)).toEqual([
        [
          "consent",
          "default",
          { ...everySignal("denied"), wait_for_update: 500 },
        ],
      ]);
      page.window.close();
    });

    test("removes measurement cookies a tag set before the refusal", () => {
      const page: OpenedPage = refused();

      expect(cookieNames(page)).toEqual(["session"]);
      page.window.close();
    });
  });
});

describe("where the law asks for consent first", () => {
  test.each([
    "Europe/Berlin",
    "Europe/London",
    "Europe/Zurich",
    "Europe/Dublin",
    "Europe/Lisbon",
    "Europe/Oslo",
    // Not in the EEA. Every Europe/ zone asks first, deliberately.
    "Europe/Istanbul",
    "Atlantic/Canary",
    "Atlantic/Madeira",
    "Atlantic/Azores",
    "Atlantic/Reykjavik",
    "Atlantic/Faroe",
    "Africa/Ceuta",
    "Arctic/Longyearbyen",
    "Asia/Nicosia",
    "Asia/Famagusta",
    "America/Cayenne",
    "America/Guadeloupe",
    "America/Martinique",
    "Indian/Reunion",
    "Indian/Mayotte",
  ])("%s asks first", (timeZone: string) => {
    const page: OpenedPage = open({ timeZone });

    expect(page.consent.requiresConsentFirst()).toBe(true);
    expect(page.consent.isAllowed()).toBe(false);
    page.window.close();
  });

  test.each([
    "America/New_York",
    "America/Los_Angeles",
    "America/Toronto",
    "America/Sao_Paulo",
    "Asia/Kolkata",
    "Asia/Tokyo",
    "Asia/Singapore",
    "Australia/Sydney",
    "Africa/Lagos",
    "Africa/Johannesburg",
    "Atlantic/Bermuda",
    "Asia/Dubai",
  ])("%s does not", (timeZone: string) => {
    const page: OpenedPage = open({ timeZone });

    expect(page.consent.requiresConsentFirst()).toBe(false);
    expect(page.consent.isAllowed()).toBe(true);
    page.window.close();
  });

  test("loads nothing before the visitor answers", () => {
    const page: OpenedPage = open({ timeZone: BERLIN });

    expect(googleTagSources(page)).toEqual([]);
    expect(consentCommands(page)).toEqual([
      [
        "consent",
        "default",
        { ...everySignal("denied"), wait_for_update: 500 },
      ],
    ]);
    page.window.close();
  });

  describe('"Accept all"', () => {
    test("loads the tag that was waiting for it", () => {
      const page: OpenedPage = open({ timeZone: BERLIN });

      page.consent.grant();

      expect(googleTagSources(page)).toEqual([CONTAINER_URL]);
      page.window.close();
    });

    test("tells Google before the tag boots", () => {
      const page: OpenedPage = open({ timeZone: BERLIN });

      page.consent.grant();

      const entries: Array<unknown> = page.window.dataLayer as Array<unknown>;
      const update: number = entries.findIndex((entry: unknown) => {
        const command: Array<unknown> = Array.from(
          (entry || []) as ArrayLike<unknown>,
        );
        return command[0] === "consent" && command[1] === "update";
      });
      const boot: number = entries.findIndex((entry: unknown) => {
        return (entry as Record<string, unknown>)["event"] === "gtm.js";
      });

      expect(update).toBeGreaterThan(-1);
      expect(boot).toBeGreaterThan(update);
      expect(consentCommands(page)[1]).toEqual([
        "consent",
        "update",
        everySignal("granted"),
      ]);
      page.window.close();
    });

    test("is remembered", () => {
      const page: OpenedPage = open({ timeZone: BERLIN });

      page.consent.grant();

      expect(page.window.localStorage.getItem("cookiesAccepted")).toBe("true");
      expect(page.consent.isGranted()).toBe(true);
      page.window.close();
    });

    test("loads the tag once, however often it is pressed", () => {
      const page: OpenedPage = open({ timeZone: BERLIN });

      page.consent.grant();
      page.consent.grant();

      expect(googleTagSources(page)).toEqual([CONTAINER_URL]);
      page.window.close();
    });
  });

  test("an acceptance on an earlier visit loads the tag at once", () => {
    const page: OpenedPage = open({ timeZone: BERLIN, storedAnswer: "true" });

    expect(googleTagSources(page)).toEqual([CONTAINER_URL]);
    expect(consentCommands(page)[0]![2]).toMatchObject(everySignal("granted"));
    page.window.close();
  });

  test("removes measurement cookies left from before consent was asked", () => {
    const page: OpenedPage = open({
      timeZone: BERLIN,
      cookies: [
        "_ga=GA1.1.1; path=/",
        "_gcl_au=1.1; path=/",
        "session=1; path=/",
      ],
    });

    expect(cookieNames(page)).toEqual(["session"]);
    page.window.close();
  });
});

/*
 * Privacy-hardened browsers report UTC instead of the real zone, and a browser
 * may have no Intl at all. When we cannot tell where the visitor is, we do not
 * assume they are somewhere the law does not protect them.
 */
describe("a browser that does not say where it is", () => {
  test.each([
    "UTC",
    "Etc/UTC",
    "Etc/GMT",
    "Etc/GMT+5",
    "GMT",
    "Universal",
    "Zulu",
    "",
  ])("asks first for the zone %j", (timeZone: string) => {
    const page: OpenedPage = open({ timeZone });

    expect(page.consent.requiresConsentFirst()).toBe(true);
    expect(page.consent.isAllowed()).toBe(false);
    page.window.close();
  });

  test("asks first when Intl is missing", () => {
    const page: OpenedPage = open({ timeZone: null });

    expect(page.consent.requiresConsentFirst()).toBe(true);
    expect(googleTagSources(page)).toEqual([]);
    page.window.close();
  });
});

describe("Global Privacy Control", () => {
  test("counts as a refusal", () => {
    const page: OpenedPage = open({
      timeZone: NEW_YORK,
      globalPrivacyControl: true,
    });

    expect(page.consent.isAllowed()).toBe(false);
    expect(googleTagSources(page)).toEqual([]);
    expect(consentCommands(page)[0]![2]).toMatchObject(everySignal("denied"));
    page.window.close();
  });

  test("gives way to an acceptance on an earlier visit", () => {
    const page: OpenedPage = open({
      timeZone: NEW_YORK,
      globalPrivacyControl: true,
      storedAnswer: "true",
    });

    expect(page.consent.isAllowed()).toBe(true);
    expect(googleTagSources(page)).toEqual([CONTAINER_URL]);
    page.window.close();
  });

  test('gives way to "Accept all" on this page', () => {
    const page: OpenedPage = open({
      timeZone: NEW_YORK,
      globalPrivacyControl: true,
    });

    page.consent.grant();

    expect(googleTagSources(page)).toEqual([CONTAINER_URL]);
    page.window.close();
  });
});

/*
 * Private modes, blocked site data, a sandboxed iframe: localStorage throws.
 * Unreadable storage is not consent, and an answer the browser will not store
 * still holds on the page it was given.
 */
describe("a browser that refuses storage", () => {
  test("is treated as not having answered", () => {
    const page: OpenedPage = open({
      timeZone: BERLIN,
      storedAnswer: "true",
      storageThrows: true,
    });

    expect(page.consent.state()).toBe("unset");
    expect(page.consent.isAllowed()).toBe(false);
    expect(googleTagSources(page)).toEqual([]);
    page.window.close();
  });

  test("still honours an answer on the page it was given", () => {
    const page: OpenedPage = open({ timeZone: BERLIN, storageThrows: true });

    page.consent.grant();

    expect(page.consent.state()).toBe("granted");
    expect(page.consent.isAllowed()).toBe(true);
    expect(googleTagSources(page)).toEqual([CONTAINER_URL]);

    page.consent.deny();

    expect(page.consent.isAllowed()).toBe(false);
    page.window.close();
  });
});

describe("the Google tag", () => {
  test("on the website is the Tag Manager container", () => {
    const page: OpenedPage = open({ timeZone: NEW_YORK });

    expect(page.window.oneUptimeGoogleTagMode).toBe("tag-manager");
    expect(googleTagSources(page)).toEqual([CONTAINER_URL]);
    page.window.close();
  });

  /*
   * Sign-up and the dashboard. Google Analytics alone: no container, so no
   * advertising pixel or visitor identification tool can run in the product
   * whatever the container is later given to load.
   */
  describe("in the product is Google Analytics alone", () => {
    const product: () => OpenedPage = (): OpenedPage => {
      return open({ timeZone: NEW_YORK, googleTagMode: "analytics-only" });
    };

    test("loads gtag.js for the OneUptime property", () => {
      const page: OpenedPage = product();

      expect(page.window.oneUptimeGoogleTagMode).toBe("analytics-only");
      expect(googleTagSources(page)).toEqual([ANALYTICS_URL]);
      page.window.close();
    });

    test("configures the property", () => {
      const page: OpenedPage = product();
      const commands: Array<Array<unknown>> = dataLayerCommands(page);

      expect(
        commands.some((command: Array<unknown>) => {
          return command[0] === "js";
        }),
      ).toBe(true);
      expect(commands).toContainEqual(["config", "G-76XZF1WF3Z"]);
      page.window.close();
    });

    test("never boots the container", () => {
      const page: OpenedPage = product();

      expect(
        (page.window.dataLayer as Array<Record<string, unknown>>).some(
          (entry: Record<string, unknown>) => {
            return entry && entry["event"] === "gtm.js";
          },
        ),
      ).toBe(false);
      page.window.close();
    });

    test("follows the same consent rule", () => {
      const page: OpenedPage = open({
        timeZone: BERLIN,
        googleTagMode: "analytics-only",
      });

      expect(googleTagSources(page)).toEqual([]);

      page.consent.grant();

      expect(googleTagSources(page)).toEqual([ANALYTICS_URL]);
      page.window.close();
    });
  });

  /*
   * A password reset or email verification token still in the address bar
   * would go out with the tag's first hit. See SensitiveUrlToken.ejs.
   */
  test("does not load while a sign-in token is still in the address bar", () => {
    const page: OpenedPage = open({
      timeZone: NEW_YORK,
      sensitiveTokenPending: true,
    });

    expect(googleTagSources(page)).toEqual([]);
    page.window.close();
  });

  describe("on a self-hosted install", () => {
    const selfHosted: () => OpenedPage = (): OpenedPage => {
      return open({ timeZone: NEW_YORK, tags: false });
    };

    test("does not exist", () => {
      const page: OpenedPage = selfHosted();

      expect(googleTagSources(page)).toEqual([]);
      expect(page.window.dataLayer).toBeUndefined();
      expect(page.window.gtag).toBeUndefined();
      page.window.close();
    });

    test("still leaves the banner's answer recorded", () => {
      const page: OpenedPage = selfHosted();

      expect(() => {
        page.consent.deny();
      }).not.toThrow();
      expect(page.consent.state()).toBe("denied");
      expect(page.window.localStorage.getItem("cookiesAccepted")).toBe("false");
      page.window.close();
    });
  });
});

describe("what other scripts on the page are told", () => {
  test("whenAllowed runs at once where measurement is already allowed", () => {
    const page: OpenedPage = open({ timeZone: NEW_YORK });
    let runs: number = 0;

    page.consent.whenAllowed(() => {
      runs++;
    });

    expect(runs).toBe(1);
    page.window.close();
  });

  test("whenAllowed waits for acceptance, and runs once", () => {
    const page: OpenedPage = open({ timeZone: BERLIN });
    let runs: number = 0;

    page.consent.whenAllowed(() => {
      runs++;
    });

    expect(runs).toBe(0);

    page.consent.deny();
    expect(runs).toBe(0);

    page.consent.grant();
    page.consent.grant();
    expect(runs).toBe(1);
    page.window.close();
  });

  test("onChange hears every answer", () => {
    const page: OpenedPage = open({ timeZone: NEW_YORK });
    const heard: Array<boolean> = [];

    page.consent.onChange((allowed: boolean) => {
      heard.push(allowed);
    });

    page.consent.deny();
    page.consent.grant();

    expect(heard).toEqual([false, true]);
    page.window.close();
  });

  test("one listener that throws does not stop the others hearing", () => {
    const page: OpenedPage = open({ timeZone: BERLIN });
    const heard: Array<string> = [];

    page.consent.onChange(() => {
      throw new Error("broken listener");
    });
    page.consent.onChange(() => {
      heard.push("listener");
    });
    page.consent.whenAllowed(() => {
      throw new Error("broken tag");
    });
    page.consent.whenAllowed(() => {
      heard.push("tag");
    });

    page.consent.grant();

    expect(heard).toEqual(["listener", "tag"]);
    page.window.close();
  });
});

/*
 * The campaign a visitor arrived on - UTM values and ad click ids - is stored
 * so a signup or a booked demo can be attributed to it. It is measurement like
 * any other.
 */
describe("attribution", () => {
  test("is stored on arrival where measurement is allowed", () => {
    const page: OpenedPage = open({ timeZone: NEW_YORK, url: AD_URL });

    expect(page.window.localStorage.getItem("utmSource")).toBe("google");
    expect(JSON.parse(page.window.localStorage.getItem("clickIds"))).toEqual({
      gclid: "abc123",
    });
    expect(page.window.localStorage.getItem("firstTouch")).not.toBeNull();
    page.window.close();
  });

  test("is neither stored nor read back before consent where it is asked first", () => {
    const page: OpenedPage = open({ timeZone: BERLIN, url: AD_URL });

    for (const key of [
      "utmSource",
      "utmCampaign",
      "utmUrl",
      "clickIds",
      "firstTouch",
    ]) {
      expect([key, page.window.localStorage.getItem(key)]).toEqual([key, null]);
    }

    expect(page.window.oneUptimeGetAttribution()).toEqual({
      utm: {},
      clickIds: {},
      firstTouch: null,
    });
    page.window.close();
  });

  test("is stored the moment the visitor accepts", () => {
    const page: OpenedPage = open({ timeZone: BERLIN, url: AD_URL });

    page.consent.grant();

    expect(page.window.localStorage.getItem("utmSource")).toBe("google");
    expect(page.window.oneUptimeGetAttribution()).toMatchObject({
      utm: { utmSource: "google", utmCampaign: "q3" },
      clickIds: { gclid: "abc123" },
    });
    page.window.close();
  });

  test('is cleared by "Reject all", along with what earlier visits stored', () => {
    const page: OpenedPage = open({
      timeZone: NEW_YORK,
      url: AD_URL,
      storage: {
        firstTouch: JSON.stringify({ utmSource: "reddit" }),
        utmMedium: "cpc",
      },
    });

    page.consent.deny();

    for (const key of [
      "utmSource",
      "utmMedium",
      "utmCampaign",
      "utmUrl",
      "clickIds",
      "firstTouch",
    ]) {
      expect([key, page.window.localStorage.getItem(key)]).toEqual([key, null]);
    }

    expect(page.window.oneUptimeGetAttribution()).toEqual({
      utm: {},
      clickIds: {},
      firstTouch: null,
    });
    page.window.close();
  });

  test("goes to Cal.com with a booking only while allowed - the booking kind always goes", () => {
    const before: OpenedPage = open({ timeZone: BERLIN, url: AD_URL });

    expect(
      before.window.oneUptimeCalAttributionMetadata("enterprise_demo"),
    ).toEqual({
      "metadata[ou_booking_kind]": "enterprise_demo",
    });

    before.consent.grant();

    expect(
      before.window.oneUptimeCalAttributionMetadata("enterprise_demo"),
    ).toMatchObject({
      "metadata[ou_booking_kind]": "enterprise_demo",
      "metadata[utm_source]": "google",
      "metadata[gclid]": "abc123",
    });
    before.window.close();
  });

  test("is reported to the page only once measurement is allowed", async () => {
    const page: OpenedPage = open({ timeZone: BERLIN, url: AD_URL });

    // The report is made from DOMContentLoaded, which load follows.
    await loaded(page);

    expect(page.captured).toEqual([]);

    page.consent.grant();

    expect(page.captured).toEqual([
      expect.objectContaining({
        utm_source: "google",
        utm_campaign: "q3",
        gclid: "abc123",
        utm_url: AD_URL,
      }),
    ]);
    page.window.close();
  });
});
