/*
 * Relative rather than the "Common/..." alias other Home files use. The alias
 * resolves through Home/node_modules/Common, which is a symlink — in a git
 * worktree it points at the main checkout, so a file added on a branch is
 * invisible to the typechecker there. A relative path resolves off this file
 * and is the same in every checkout.
 */
import {
  AdClickIdKeys,
  UtmWireKeyToPropertyKey,
} from "../../Common/Types/Marketing/Attribution";
import { getPageSEO, PageSEOData } from "../Utils/PageSEO";
import ejs from "ejs";
import path from "path";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * Consent, and the attribution capture that sits behind it.
 *
 * Twice the cookie banner recorded an answer that nothing acted on: first
 * because nothing read `cookiesAccepted`, later because the gate had been
 * taken out on purpose. Either way "Reject all" rejected nothing, for a site
 * that draws about a third of its search traffic from the EEA, the UK and
 * Switzerland.
 *
 * Now every measuring script asks one rule, window.oneUptimeConsent
 * .isAllowed(): an answer on the banner wins; with none, Global Privacy
 * Control is a refusal; with neither, measurement waits for "Accept all"
 * where the law asks for consent first and runs until "Reject all"
 * elsewhere. The tests below pin that for Consent Mode, the attribution
 * capture and PostHog, so loosening it again has to be a decision.
 *
 * These assertions read the rendered template and run the inline scripts,
 * because that is the only place they exist — there is no module to import.
 * ---------------------------------------------------------------------------
 */

const VIEWS_ROOT: string = path.join(__dirname, "..", "Views");
const HOME_URL: string = "https://oneuptime.com";

type RenderFunction = (
  templateFileName: string,
  locals: Record<string, unknown>,
) => Promise<string>;

const render: RenderFunction = async (
  templateFileName: string,
  locals: Record<string, unknown>,
): Promise<string> => {
  return (await ejs.renderFile(
    path.join(VIEWS_ROOT, templateFileName),
    locals,
    { views: [VIEWS_ROOT] },
  )) as string;
};

type SeoForFunction = (
  pagePath: string,
) => PageSEOData & { fullCanonicalUrl: string };

const seoFor: SeoForFunction = (
  pagePath: string,
): PageSEOData & { fullCanonicalUrl: string } => {
  const seo: PageSEOData = getPageSEO(pagePath);
  return { ...seo, fullCanonicalUrl: `${HOME_URL}${seo.canonicalPath}` };
};

type RenderDemoFunction = (enableGoogleTagManager?: boolean) => Promise<string>;

const renderDemo: RenderDemoFunction = async (
  enableGoogleTagManager: boolean = true,
): Promise<string> => {
  return render("demo.ejs", {
    support: false,
    enableGoogleTagManager: enableGoogleTagManager,
    footerCards: false,
    cta: false,
    blackLogo: true,
    requestDemoCta: false,
    reviewsList1: [],
    reviewsList2: [],
    reviewsList3: [],
    seo: seoFor("/enterprise/demo"),
    homeUrl: HOME_URL,
  });
};

/*
 * A localStorage that can also be made to throw, which is what private mode
 * and a sandboxed iframe actually do — unreadable storage must not be mistaken
 * for consent, and unwritable storage must not take the page down with it.
 */
class FakeStorage {
  public store: Map<string, string> = new Map<string, string>();
  public throwOnAccess: boolean = false;

  public getItem(key: string): string | null {
    if (this.throwOnAccess) {
      throw new Error("storage disabled");
    }
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  public setItem(key: string, value: string): void {
    if (this.throwOnAccess) {
      throw new Error("storage disabled");
    }
    this.store.set(key, String(value));
  }

  public removeItem(key: string): void {
    if (this.throwOnAccess) {
      throw new Error("storage disabled");
    }
    this.store.delete(key);
  }

  // A refusal walks the keys to clear PostHog's.
  public get length(): number {
    if (this.throwOnAccess) {
      throw new Error("storage disabled");
    }
    return this.store.size;
  }

  public key(index: number): string | null {
    if (this.throwOnAccess) {
      throw new Error("storage disabled");
    }
    return Array.from(this.store.keys())[index] ?? null;
  }
}

/*
 * Where the visitor is, as far as the page can tell: the browser's time zone.
 * Measurement runs until refused in the first and waits for "Accept all" in
 * the second.
 */
const OPT_OUT_ZONE: string = "America/New_York";
const CONSENT_FIRST_ZONE: string = "Europe/Berlin";

type FakeIntlFunction = (timeZone: string) => unknown;

const fakeIntl: FakeIntlFunction = (timeZone: string): unknown => {
  return {
    DateTimeFormat: (): unknown => {
      return {
        resolvedOptions: (): { timeZone: string } => {
          return { timeZone };
        },
      };
    },
  };
};

interface ConsentApi {
  state: () => string;
  isGranted: () => boolean;
  isAllowed: () => boolean;
  grant: () => void;
  deny: () => void;
  whenAllowed: (callback: () => void) => void;
  onChange: (listener: (allowed: boolean) => void) => void;
}

interface AttributionSnapshot {
  utm: Record<string, string>;
  clickIds: Record<string, string>;
  firstTouch: Record<string, unknown> | null;
}

type CalMetadataFunction = (bookingKind?: string) => Record<string, string>;

interface Harness {
  consent: ConsentApi;
  getAttribution: () => AttributionSnapshot;
  calMetadata: CalMetadataFunction;
  storage: FakeStorage;
  dataLayer: Array<unknown>;
  posthogCalls: Array<[string, Record<string, unknown>]>;
  fireDomContentLoaded: () => void;
}

type ExtractScriptFunction = (html: string, marker: string) => string;

/*
 * The WHOLE <script> block the marker sits in, not the slice from the marker
 * onwards — these scripts are IIFEs, so starting halfway through one produces
 * an unbalanced body that new Function refuses.
 */
const extractScript: ExtractScriptFunction = (
  html: string,
  marker: string,
): string => {
  const markerIndex: number = html.indexOf(marker);

  expect(markerIndex).toBeGreaterThan(-1);

  const openTagIndex: number = html.lastIndexOf("<script>", markerIndex);
  const start: number = openTagIndex + "<script>".length;
  const end: number = html.indexOf("</script>", markerIndex);

  expect(openTagIndex).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  return html.slice(start, end);
};

interface HarnessOptions {
  url?: string | undefined;
  referrer?: string | undefined;
  storedConsent?: string | undefined;
  storedAttribution?: Record<string, string> | undefined;
  storageThrows?: boolean | undefined;
  /*
   * The browser's time zone. OPT_OUT_ZONE unless a test says otherwise - the
   * cases about waiting for consent name CONSENT_FIRST_ZONE.
   */
  timeZone?: string | undefined;
  globalPrivacyControl?: boolean | undefined;
}

type LoadHarnessFunction = (html: string, options?: HarnessOptions) => Harness;

/*
 * Runs the two inline scripts — consent first, exactly as the page orders
 * them — against stand-in browser globals, and hands back what the page
 * exposes on window.
 */
const loadHarness: LoadHarnessFunction = (
  html: string,
  options: HarnessOptions = {},
): Harness => {
  /*
   * The gtag shim is its own block, and only rendered when Google Tag Manager
   * is enabled — so a self-hosted render legitimately has no such block, and
   * the harness must model that rather than fail.
   */
  const gtagSource: string = html.includes(
    "window.dataLayer = window.dataLayer || [];",
  )
    ? extractScript(html, "window.dataLayer = window.dataLayer || [];")
    : "";
  const consentSource: string = extractScript(
    html,
    "window.oneUptimeConsent = (function ()",
  );
  const attributionSource: string = extractScript(html, "var UTM_KEY_MAP = {");

  /*
   * Reporting on a captured touch lives in the page, not in the shared
   * partial, so that /accounts and /dashboard do not start emitting
   * home/-prefixed events just because they share the capture code. That makes
   * it a fourth block, and it has to run here or the wiring the page actually
   * depends on goes untested.
   */
  const reportingSource: string = html.includes(
    "window.oneUptimeOnAttributionCaptured = function",
  )
    ? extractScript(html, "window.oneUptimeOnAttributionCaptured = function")
    : "";

  const url: string = options.url || "https://oneuptime.com/enterprise/demo";
  const parsedUrl: URL = new URL(url);

  const storage: FakeStorage = new FakeStorage();

  if (options.storedConsent !== undefined) {
    storage.store.set("cookiesAccepted", options.storedConsent);
  }

  for (const [key, value] of Object.entries(options.storedAttribution || {})) {
    storage.store.set(key, value);
  }

  storage.throwOnAccess = Boolean(options.storageThrows);

  const dataLayer: Array<unknown> = [];
  const posthogCalls: Array<[string, Record<string, unknown>]> = [];
  const domListeners: Array<() => void> = [];

  const fakeWindow: Record<string, unknown> = {
    dataLayer: dataLayer,
    localStorage: storage,
    location: {
      href: url,
      search: parsedUrl.search,
      pathname: parsedUrl.pathname,
      hostname: parsedUrl.hostname,
    },
    navigator: {
      globalPrivacyControl: Boolean(options.globalPrivacyControl),
    },
  };

  /*
   * The page declares `function gtag()`, which in a browser becomes
   * window.gtag. A Function body has no such effect, so the harness puts it
   * there — but only when the page actually rendered the shim, so the
   * self-hosted case stays honest.
   */
  if (gtagSource) {
    fakeWindow["gtag"] = (...args: Array<unknown>): void => {
      dataLayer.push(args);
    };
  }

  const fakeDocument: Record<string, unknown> = {
    referrer: options.referrer || "",
    addEventListener: (eventName: string, listener: () => void): void => {
      if (eventName === "DOMContentLoaded") {
        domListeners.push(listener);
      }
    },
  };

  const posthog: Record<string, unknown> = {
    capture: (name: string, properties: Record<string, unknown>): void => {
      posthogCalls.push([name, properties]);
    },
  };

  // eslint-disable-next-line no-new-func
  const build: (...args: Array<unknown>) => unknown = new Function(
    "window",
    "document",
    "dataLayer",
    "posthog",
    "URLSearchParams",
    "Intl",
    `${gtagSource}\n${consentSource}\n${reportingSource}\n${attributionSource}\nreturn {
       consent: window.oneUptimeConsent,
       getAttribution: window.oneUptimeGetAttribution,
       calMetadata: window.oneUptimeCalAttributionMetadata
     };`,
  ) as (...args: Array<unknown>) => unknown;

  const exposed: {
    consent: ConsentApi;
    getAttribution: () => AttributionSnapshot;
    calMetadata: CalMetadataFunction;
  } = build(
    fakeWindow,
    fakeDocument,
    dataLayer,
    posthog,
    URLSearchParams,
    fakeIntl(options.timeZone ?? OPT_OUT_ZONE),
  ) as {
    consent: ConsentApi;
    getAttribution: () => AttributionSnapshot;
    calMetadata: CalMetadataFunction;
  };

  return {
    ...exposed,
    storage: storage,
    dataLayer: dataLayer,
    posthogCalls: posthogCalls,
    fireDomContentLoaded: (): void => {
      for (const listener of domListeners) {
        listener();
      }
    },
  };
};

type ConsentSignalsFunction = (
  harness: Harness,
) => Array<Record<string, string>>;

const consentSignals: ConsentSignalsFunction = (
  harness: Harness,
): Array<Record<string, string>> => {
  return harness.dataLayer
    .filter((entry: unknown) => {
      const args: IArguments | undefined = entry as IArguments;
      return args && args[0] === "consent";
    })
    .map((entry: unknown) => {
      return (entry as IArguments)[2] as Record<string, string>;
    });
};

const AD_URL: string =
  "https://oneuptime.com/enterprise/demo?utm_source=google&utm_medium=cpc&utm_campaign=enterprise-q3&gclid=abc123";

/*
 * A landing URL carrying every parameter the shared contract names, built from
 * that contract rather than hand-listed — so a key added to
 * Common/Types/Marketing/Attribution.ts is exercised here automatically instead
 * of quietly going untested.
 */
const EVERY_PARAM_URL: string = `https://oneuptime.com/enterprise/demo?${[
  ...Object.keys(UtmWireKeyToPropertyKey),
  ...AdClickIdKeys,
]
  .map((key: string) => {
    return `${key}=${key}-value`;
  })
  .join("&")}`;

describe("attribution capture and consent", () => {
  let html: string = "";

  beforeAll(async () => {
    html = await renderDemo();
  });

  describe("the page wiring", () => {
    test("defines the consent helper before Google Tag Manager loads", () => {
      const consentIndex: number = html.indexOf("window.oneUptimeConsent =");
      const gtmIndex: number = html.indexOf("googletagmanager.com/gtm.js");

      expect(consentIndex).toBeGreaterThan(-1);
      expect(gtmIndex).toBeGreaterThan(consentIndex);
    });

    test("exposes the attribution reader", () => {
      expect(html).toContain("window.oneUptimeGetAttribution = function");
    });
  });

  describe("Google Consent Mode v2", () => {
    const GRANTED: Record<string, string> = {
      ad_storage: "granted",
      ad_user_data: "granted",
      ad_personalization: "granted",
      analytics_storage: "granted",
      functionality_storage: "granted",
      personalization_storage: "granted",
    };

    const DENIED: Record<string, string> = {
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      analytics_storage: "denied",
      functionality_storage: "denied",
      personalization_storage: "denied",
    };

    test("defaults to granted where measurement runs until refused", () => {
      const harness: Harness = loadHarness(html, { timeZone: OPT_OUT_ZONE });

      expect(consentSignals(harness)).toEqual([
        expect.objectContaining(GRANTED),
      ]);
    });

    /*
     * The default is a statement to Google about whether consent was
     * collected. Where the law asks for it first, nobody has given it yet.
     */
    test("defaults to denied where consent comes first", () => {
      const harness: Harness = loadHarness(html, {
        timeZone: CONSENT_FIRST_ZONE,
      });

      expect(consentSignals(harness)).toEqual([
        expect.objectContaining(DENIED),
      ]);
    });

    test("defaults to granted where consent comes first and was given before", () => {
      const harness: Harness = loadHarness(html, {
        timeZone: CONSENT_FIRST_ZONE,
        storedConsent: "true",
      });

      expect(consentSignals(harness)[0]).toMatchObject(GRANTED);
    });

    test("defaults to denied after a refusal on an earlier visit, anywhere", () => {
      const harness: Harness = loadHarness(html, {
        timeZone: OPT_OUT_ZONE,
        storedConsent: "false",
      });

      expect(consentSignals(harness)[0]).toMatchObject(DENIED);
    });

    test("defaults to denied for a browser sending Global Privacy Control", () => {
      const harness: Harness = loadHarness(html, {
        timeZone: OPT_OUT_ZONE,
        globalPrivacyControl: true,
      });

      expect(consentSignals(harness)[0]).toMatchObject(DENIED);
    });

    /*
     * security_storage covers things like fraud prevention rather than
     * advertising, and is granted under Consent Mode's own guidance - even
     * when everything else is denied.
     */
    test.each([OPT_OUT_ZONE, CONSENT_FIRST_ZONE])(
      "grants security storage in the defaults (%s)",
      (timeZone: string) => {
        const harness: Harness = loadHarness(html, { timeZone });

        expect(consentSignals(harness)[0]).toMatchObject({
          security_storage: "granted",
        });
      },
    );

    /*
     * Without wait_for_update the container decides how to behave before a
     * visitor who accepts immediately has been heard, which is exactly the
     * visitor who arrived from an ad.
     */
    test("asks the container to wait briefly for an update", () => {
      const harness: Harness = loadHarness(html);

      expect(consentSignals(harness)[0]).toMatchObject({
        wait_for_update: 500,
      });
    });

    test("sends the acceptance as an update", () => {
      const harness: Harness = loadHarness(html, {
        timeZone: CONSENT_FIRST_ZONE,
      });

      harness.consent.grant();

      const signals: Array<Record<string, string>> = consentSignals(harness);

      expect(signals).toHaveLength(2);
      expect(signals[1]).toMatchObject(GRANTED);
      // An update is not a default: there is nothing left to wait for.
      expect(signals[1]).not.toHaveProperty("wait_for_update");
    });

    /*
     * The one that was missing. Without a denial on the dataLayer, a tag
     * already on the page went on as if nothing had been said.
     */
    test("sends the refusal as an update", () => {
      const harness: Harness = loadHarness(html, { timeZone: OPT_OUT_ZONE });

      harness.consent.deny();

      const signals: Array<Record<string, string>> = consentSignals(harness);

      expect(signals).toHaveLength(2);
      expect(signals[1]).toMatchObject(DENIED);
      expect(signals[1]).toMatchObject({ security_storage: "granted" });
    });

    test("does not re-signal for a decision made on an earlier visit", () => {
      const harness: Harness = loadHarness(html, { storedConsent: "false" });

      // The default already carries it.
      expect(consentSignals(harness)).toHaveLength(1);
    });
  });

  /*
   * A self-hosted install loads no Google tag at all. The consent state
   * machine still has to work — the banner reads and writes it — but there
   * must be nothing to signal to, and in particular no dataLayer, because every
   * OneUptime event guards on `typeof dataLayer !== 'undefined'` and an array
   * nothing reads would simply grow for the life of the page.
   */
  describe("without Google Tag Manager", () => {
    let selfHostedHtml: string = "";

    beforeAll(async () => {
      selfHostedHtml = await renderDemo(false);
    });

    test("creates no dataLayer", () => {
      expect(selfHostedHtml).not.toContain(
        "window.dataLayer = window.dataLayer || [];",
      );
    });

    test("loads no container", () => {
      expect(selfHostedHtml).not.toContain("googletagmanager.com/gtm.js");
    });

    test("still defines the consent helper", () => {
      expect(selfHostedHtml).toContain("window.oneUptimeConsent =");
    });

    test("tracks consent without anything to signal to", () => {
      const harness: Harness = loadHarness(selfHostedHtml);

      expect(harness.consent.state()).toBe("unset");

      harness.consent.grant();

      expect(harness.consent.state()).toBe("granted");
      expect(harness.dataLayer).toHaveLength(0);
    });

    test("captures attribution under the same rule, with nothing to signal to", () => {
      const allowed: Harness = loadHarness(selfHostedHtml, {
        url: AD_URL,
        timeZone: OPT_OUT_ZONE,
      });

      expect(allowed.storage.store.get("utmSource")).toBe("google");
      expect(allowed.dataLayer).toHaveLength(0);

      const waiting: Harness = loadHarness(selfHostedHtml, {
        url: AD_URL,
        timeZone: CONSENT_FIRST_ZONE,
      });

      expect(waiting.storage.store.has("utmSource")).toBe(false);

      waiting.consent.grant();

      expect(waiting.storage.store.get("utmSource")).toBe("google");
      expect(waiting.dataLayer).toHaveLength(0);
    });
  });

  describe("consent state", () => {
    test("is unset until the visitor answers", () => {
      expect(loadHarness(html).consent.state()).toBe("unset");
    });

    test("allows measurement without an answer where it runs until refused", () => {
      expect(
        loadHarness(html, { timeZone: OPT_OUT_ZONE }).consent.isAllowed(),
      ).toBe(true);
    });

    test("holds measurement back without an answer where consent comes first", () => {
      expect(
        loadHarness(html, { timeZone: CONSENT_FIRST_ZONE }).consent.isAllowed(),
      ).toBe(false);
    });

    test.each([
      [OPT_OUT_ZONE, "false", false],
      [CONSENT_FIRST_ZONE, "true", true],
    ])(
      "lets a stored answer decide wherever the visitor is (%s, %s)",
      (timeZone: string, storedConsent: string, allowed: boolean) => {
        expect(
          loadHarness(html, { timeZone, storedConsent }).consent.isAllowed(),
        ).toBe(allowed);
      },
    );

    test("treats Global Privacy Control as a refusal until the visitor accepts", () => {
      const harness: Harness = loadHarness(html, {
        timeZone: OPT_OUT_ZONE,
        globalPrivacyControl: true,
      });

      expect(harness.consent.isAllowed()).toBe(false);

      harness.consent.grant();

      expect(harness.consent.isAllowed()).toBe(true);
    });

    test.each([
      ["true", "granted"],
      ["false", "denied"],
    ])("reads a stored %p as %s", (stored: string, expected: string) => {
      expect(loadHarness(html, { storedConsent: stored }).consent.state()).toBe(
        expected,
      );
    });

    test("persists a grant so the banner is not asked again", () => {
      const harness: Harness = loadHarness(html);

      harness.consent.grant();

      expect(harness.storage.store.get("cookiesAccepted")).toBe("true");
      expect(harness.consent.state()).toBe("granted");
    });

    test("persists a refusal, which is an answer too", () => {
      const harness: Harness = loadHarness(html);

      harness.consent.deny();

      expect(harness.storage.store.get("cookiesAccepted")).toBe("false");
      expect(harness.consent.state()).toBe("denied");
    });

    /*
     * Private mode, a sandboxed iframe, or storage switched off. Unreadable
     * storage is not consent — treating an exception as "granted" would be the
     * one failure mode that matters.
     */
    test("treats unreadable storage as unset rather than granted", () => {
      const harness: Harness = loadHarness(html, {
        storedConsent: "true",
        storageThrows: true,
      });

      expect(harness.consent.state()).toBe("unset");
      expect(harness.consent.isGranted()).toBe(false);
    });

    test("still signals Google when storage cannot be written", () => {
      const harness: Harness = loadHarness(html, { storageThrows: true });

      expect(() => {
        return harness.consent.grant();
      }).not.toThrow();

      const signals: Array<Record<string, string>> = consentSignals(harness);

      expect(signals[signals.length - 1]).toMatchObject({
        ad_storage: "granted",
      });
    });
  });

  describe("storing attribution", () => {
    test("stores the touch on arrival where measurement runs until refused", () => {
      const harness: Harness = loadHarness(html, {
        url: AD_URL,
        timeZone: OPT_OUT_ZONE,
      });

      expect(harness.consent.state()).toBe("unset");
      expect(harness.storage.store.get("utmSource")).toBe("google");
      expect(JSON.parse(harness.storage.store.get("clickIds")!)).toEqual({
        gclid: "abc123",
      });
    });

    test("stores nothing before the visitor accepts where consent comes first", () => {
      const harness: Harness = loadHarness(html, {
        url: AD_URL,
        timeZone: CONSENT_FIRST_ZONE,
      });

      expect(harness.storage.store.size).toBe(0);
    });

    test("stores this page's touch the moment the visitor accepts", () => {
      const harness: Harness = loadHarness(html, {
        url: AD_URL,
        timeZone: CONSENT_FIRST_ZONE,
      });

      harness.consent.grant();

      expect(harness.storage.store.get("utmSource")).toBe("google");
      expect(harness.storage.store.get("utmUrl")).toBe(AD_URL);
      expect(JSON.parse(harness.storage.store.get("clickIds")!)).toEqual({
        gclid: "abc123",
      });
      expect(
        JSON.parse(harness.storage.store.get("firstTouch")!),
      ).toMatchObject({ utmSource: "google", clickIds: { gclid: "abc123" } });
    });

    test("stores nothing for a browser sending Global Privacy Control", () => {
      const harness: Harness = loadHarness(html, {
        url: AD_URL,
        timeZone: OPT_OUT_ZONE,
        globalPrivacyControl: true,
      });

      expect(harness.storage.store.size).toBe(0);
    });

    test("stores the touch immediately when consent was already given", () => {
      const harness: Harness = loadHarness(html, {
        url: AD_URL,
        storedConsent: "true",
      });

      expect(harness.storage.store.get("utmSource")).toBe("google");
      expect(harness.storage.store.get("utmCampaign")).toBe("enterprise-q3");
      expect(JSON.parse(harness.storage.store.get("clickIds")!)).toEqual({
        gclid: "abc123",
      });
    });

    test("records the first touch on arrival where measurement runs until refused", () => {
      const harness: Harness = loadHarness(html, {
        url: AD_URL,
        timeZone: OPT_OUT_ZONE,
      });

      expect(
        JSON.parse(harness.storage.store.get("firstTouch")!),
      ).toMatchObject({
        utmSource: "google",
        utmCampaign: "enterprise-q3",
        clickIds: { gclid: "abc123" },
      });
    });

    test("clears this page's touch when the visitor refuses", () => {
      const harness: Harness = loadHarness(html, {
        url: AD_URL,
        timeZone: OPT_OUT_ZONE,
      });

      harness.consent.deny();

      // Only the answer itself is left.
      expect(Array.from(harness.storage.store.keys())).toEqual([
        "cookiesAccepted",
      ]);
    });

    /*
     * Refusing undoes. An explicit "Reject all" takes back an earlier visit's
     * click id and first touch too - not only what this page wrote.
     */
    const EARLIER_VISIT: Record<string, string> = {
      utmSource: "google",
      utmCampaign: "old-campaign",
      utmUrl: "https://oneuptime.com/?gclid=old",
      clickIds: JSON.stringify({ gclid: "old" }),
      firstTouch: JSON.stringify({ utmSource: "google" }),
    };

    test("clears what an earlier visit stored when the visitor refuses", () => {
      const harness: Harness = loadHarness(html, {
        storedConsent: "true",
        storedAttribution: EARLIER_VISIT,
      });

      harness.consent.deny();

      for (const key of Object.keys(EARLIER_VISIT)) {
        expect([key, harness.storage.store.has(key)]).toEqual([key, false]);
      }
    });

    test("clears what an earlier visit stored once a refusal is on record", () => {
      const harness: Harness = loadHarness(html, {
        storedConsent: "false",
        storedAttribution: EARLIER_VISIT,
      });

      for (const key of Object.keys(EARLIER_VISIT)) {
        expect([key, harness.storage.store.has(key)]).toEqual([key, false]);
      }
    });

    /*
     * Stored before measurement was gated, by a visitor who has never been
     * asked. Holding it until they answer would be keeping it without consent.
     */
    test("clears what was stored before consent was asked, where it comes first", () => {
      const harness: Harness = loadHarness(html, {
        timeZone: CONSENT_FIRST_ZONE,
        storedAttribution: EARLIER_VISIT,
      });

      expect(harness.storage.store.size).toBe(0);
    });

    test("keeps what is stored while measurement is allowed", () => {
      const harness: Harness = loadHarness(html, {
        timeZone: OPT_OUT_ZONE,
        storedAttribution: EARLIER_VISIT,
      });

      for (const [key, value] of Object.entries(EARLIER_VISIT)) {
        expect(harness.storage.store.get(key)).toBe(value);
      }
    });

    test("never overwrites the first touch on a later campaign click", () => {
      const harness: Harness = loadHarness(html, {
        url: AD_URL,
        storedConsent: "true",
        storedAttribution: {
          firstTouch: JSON.stringify({ utmSource: "reddit" }),
        },
      });

      expect(JSON.parse(harness.storage.store.get("firstTouch")!)).toEqual({
        utmSource: "reddit",
      });
      // Last touch still moves.
      expect(harness.storage.store.get("utmSource")).toBe("google");
    });

    /*
     * Google Ads auto-tagging sends gclid and no UTM parameters at all, so a
     * click id on its own has to count as a new touch.
     */
    test("counts a click id with no UTMs as a new touch", () => {
      const harness: Harness = loadHarness(html, {
        url: "https://oneuptime.com/?gclid=auto-tagged",
        storedConsent: "true",
      });

      expect(JSON.parse(harness.storage.store.get("clickIds")!)).toEqual({
        gclid: "auto-tagged",
      });
      expect(harness.storage.store.get("utmUrl")).toBe(
        "https://oneuptime.com/?gclid=auto-tagged",
      );
    });

    test("stores nothing for a visit carrying no attribution at all", () => {
      const harness: Harness = loadHarness(html, {
        url: "https://oneuptime.com/pricing",
        storedConsent: "true",
      });

      expect(harness.storage.store.size).toBe(1); // Only cookiesAccepted.
    });

    test("clears stale last-touch UTMs when a new campaign arrives", () => {
      const harness: Harness = loadHarness(html, {
        url: "https://oneuptime.com/?utm_source=newsletter",
        storedConsent: "true",
        storedAttribution: {
          utmSource: "google",
          utmMedium: "cpc",
          utmCampaign: "old-campaign",
        },
      });

      expect(harness.storage.store.get("utmSource")).toBe("newsletter");
      expect(harness.storage.store.has("utmMedium")).toBe(false);
      expect(harness.storage.store.has("utmCampaign")).toBe(false);
    });

    test("bounds a stored value at 500 characters", () => {
      const harness: Harness = loadHarness(html, {
        url: `https://oneuptime.com/?utm_campaign=${"c".repeat(900)}`,
        storedConsent: "true",
      });

      expect(harness.storage.store.get("utmCampaign")).toHaveLength(500);
    });
  });

  describe("reading attribution back", () => {
    test("reads what an earlier visit stored", () => {
      const harness: Harness = loadHarness(html, {
        storedConsent: "true",
        storedAttribution: {
          utmSource: "google",
          utmCampaign: "enterprise-q3",
          utmUrl: "https://oneuptime.com/?gclid=abc123",
          clickIds: JSON.stringify({ gclid: "abc123" }),
          firstTouch: JSON.stringify({ utmSource: "reddit" }),
        },
      });

      expect(harness.getAttribution()).toEqual({
        utm: {
          utmSource: "google",
          utmCampaign: "enterprise-q3",
          utmUrl: "https://oneuptime.com/?gclid=abc123",
        },
        clickIds: { gclid: "abc123" },
        firstTouch: { utmSource: "reddit" },
      });
    });

    /*
     * A signup on the very page the visitor landed on carries the campaign
     * that brought them, banner unanswered - where measurement runs until
     * refused.
     */
    test("reads this page's touch before the banner is answered, where that is allowed", () => {
      const harness: Harness = loadHarness(html, {
        url: AD_URL,
        timeZone: OPT_OUT_ZONE,
      });

      expect(harness.consent.state()).toBe("unset");
      expect(harness.getAttribution()).toMatchObject({
        utm: { utmSource: "google", utmCampaign: "enterprise-q3" },
        clickIds: { gclid: "abc123" },
      });
    });

    test("prefers this page's touch over an older stored one", () => {
      const harness: Harness = loadHarness(html, {
        url: AD_URL,
        storedConsent: "true",
        storedAttribution: { utmSource: "stale" },
      });

      expect(harness.getAttribution().utm["utmSource"]).toBe("google");
    });

    /*
     * Older versions of the site wrote the literal strings "null" and
     * "undefined" for missing parameters; they must never reach a User record
     * or an ad platform.
     */
    test.each(["null", "undefined"])(
      "drops a stored literal %p",
      (value: string) => {
        const harness: Harness = loadHarness(html, {
          storedConsent: "true",
          storedAttribution: { utmSource: value },
        });

        expect(harness.getAttribution().utm["utmSource"]).toBeUndefined();
      },
    );

    test("survives malformed JSON in storage", () => {
      const harness: Harness = loadHarness(html, {
        storedConsent: "true",
        storedAttribution: { clickIds: "{not json", firstTouch: "[1,2]" },
      });

      expect(harness.getAttribution()).toEqual({
        utm: {},
        clickIds: {},
        firstTouch: null,
      });
    });

    const NOTHING: AttributionSnapshot = {
      utm: {},
      clickIds: {},
      firstTouch: null,
    };

    test("reads nothing back while measurement waits for consent", () => {
      const harness: Harness = loadHarness(html, {
        url: AD_URL,
        timeZone: CONSENT_FIRST_ZONE,
      });

      expect(harness.getAttribution()).toEqual(NOTHING);

      harness.consent.grant();

      expect(harness.getAttribution()).toMatchObject({
        utm: { utmSource: "google", utmCampaign: "enterprise-q3" },
        clickIds: { gclid: "abc123" },
      });
    });

    test("reads nothing back after a refusal, not even this page's touch", () => {
      const harness: Harness = loadHarness(html, {
        url: AD_URL,
        timeZone: OPT_OUT_ZONE,
      });

      harness.consent.deny();

      expect(harness.getAttribution()).toEqual(NOTHING);
    });

    test("returns empty structures when nothing is known", () => {
      const harness: Harness = loadHarness(html, {
        url: "https://oneuptime.com/pricing",
      });

      expect(harness.getAttribution()).toEqual({
        utm: {},
        clickIds: {},
        firstTouch: null,
      });
    });

    /*
     * Driven off the shared contract rather than a hand-written list, so a key
     * added to Common/Types/Marketing/Attribution.ts is captured here
     * automatically instead of quietly going untested — the reader is what the
     * signup form posts onto the User record, and a key the browser collects
     * but the reader drops is invisible until somebody reads the numbers.
     */
    test("surfaces every click id the shared contract names", () => {
      const harness: Harness = loadHarness(html, {
        url: EVERY_PARAM_URL,
        storedConsent: "true",
      });

      const clickIds: Record<string, string> =
        harness.getAttribution().clickIds;

      for (const clickIdKey of AdClickIdKeys) {
        expect(clickIds[clickIdKey]).toBe(`${clickIdKey}-value`);
      }
    });

    /*
     * The other direction, and the one that fails silently.
     *
     * The tests above build their URL FROM the shared contract, so a key added
     * to Common/Types/Marketing/Attribution.ts and forgotten in the partial is
     * caught. A key added to the PARTIAL and missing from the contract is not:
     * the browser would collect and store it, and the server — which whitelists
     * on the contract — would drop it on arrival without erroring. The partial
     * says in a comment that its list "must stay in step"; this is what makes
     * that true rather than aspirational.
     *
     * Asserted as set equality, so drift in either direction fails here.
     */
    test("the partial's click id list is exactly the shared contract's", () => {
      const match: RegExpMatchArray | null = html.match(
        /var CLICK_ID_PARAMS = \[([^\]]*)\]/,
      );

      expect(match).not.toBeNull();

      const inPartial: Array<string> = match![1]!
        .split(",")
        .map((raw: string) => {
          return raw.trim().replace(/^'|'$/g, "");
        })
        .filter(Boolean);

      expect([...inPartial].sort()).toEqual([...AdClickIdKeys].sort());
    });

    test("the partial's UTM key map is exactly the shared contract's", () => {
      const match: RegExpMatchArray | null = html.match(
        /var UTM_KEY_MAP = \{([^}]*)\}/,
      );

      expect(match).not.toBeNull();

      const inPartial: Array<string> = Array.from(
        match![1]!.matchAll(/'([^']+)'\s*:/g),
      ).map((m: RegExpMatchArray) => {
        return m[1]!;
      });

      expect([...inPartial].sort()).toEqual(
        Object.keys(UtmWireKeyToPropertyKey).sort(),
      );
    });

    test("surfaces every UTM parameter the shared contract names", () => {
      const harness: Harness = loadHarness(html, {
        url: EVERY_PARAM_URL,
        storedConsent: "true",
      });

      const utm: Record<string, string> = harness.getAttribution().utm;

      for (const wireKey of Object.keys(UtmWireKeyToPropertyKey)) {
        expect(utm[UtmWireKeyToPropertyKey[wireKey]!]).toBe(`${wireKey}-value`);
      }
    });
  });

  describe("the utm_event analytics mirror", () => {
    test("is emitted for an attributed visit", () => {
      const harness: Harness = loadHarness(html, {
        url: AD_URL,
        storedConsent: "true",
      });

      harness.fireDomContentLoaded();

      const event: [string, Record<string, unknown>] | undefined =
        harness.posthogCalls.find((call: [string, Record<string, unknown>]) => {
          return call[0] === "home/utm_event";
        });

      expect(event?.[1]).toMatchObject({
        utm_source: "google",
        utm_campaign: "enterprise-q3",
        gclid: "abc123",
        utm_url: AD_URL,
      });
    });

    test("waits for consent where consent comes first", () => {
      const harness: Harness = loadHarness(html, {
        url: AD_URL,
        timeZone: CONSENT_FIRST_ZONE,
      });

      harness.fireDomContentLoaded();

      expect(harness.posthogCalls).toEqual([]);

      harness.consent.grant();

      expect(
        harness.posthogCalls.map((call: [string, Record<string, unknown>]) => {
          return call[0];
        }),
      ).toEqual(["home/utm_event"]);
    });

    test("is never emitted after a refusal", () => {
      const harness: Harness = loadHarness(html, {
        url: AD_URL,
        storedConsent: "false",
      });

      harness.fireDomContentLoaded();
      harness.consent.deny();

      expect(harness.posthogCalls).toEqual([]);
    });

    test("is not emitted for a visit carrying no attribution", () => {
      const harness: Harness = loadHarness(html, {
        url: "https://oneuptime.com/pricing",
        storedConsent: "true",
      });

      harness.fireDomContentLoaded();

      expect(
        harness.posthogCalls.some((call: [string, Record<string, unknown>]) => {
          return call[0] === "home/utm_event";
        }),
      ).toBe(false);
    });
  });

  /*
   * The marketing site's own PostHog loader (head-basic.ejs), run against a
   * stand-in browser: idle callbacks are held until the test lets them run,
   * and the library's <script> is recorded rather than fetched.
   */
  describe("PostHog loading", () => {
    const POSTHOG_LIBRARY: string = "https://eu.posthog.com/static/array.js";

    interface PostHogHarness {
      consent: ConsentApi;
      // The stub's queue: what the library is told once it arrives.
      queue: Array<unknown>;
      idleCallbacks: Array<() => void>;
      loadedScripts: () => Array<string>;
      runIdle: () => void;
    }

    type LoadPostHogFunction = (options?: HarnessOptions) => PostHogHarness;

    const loadPostHog: LoadPostHogFunction = (
      options: HarnessOptions = {},
    ): PostHogHarness => {
      const consentSource: string = extractScript(
        html,
        "window.oneUptimeConsent = (function ()",
      );
      const posthogSource: string = extractScript(
        html,
        "function initPostHog()",
      );

      const storage: FakeStorage = new FakeStorage();

      if (options.storedConsent !== undefined) {
        storage.store.set("cookiesAccepted", options.storedConsent);
      }

      const idleCallbacks: Array<() => void> = [];
      const inserted: Array<Record<string, unknown>> = [];
      const firstScript: Record<string, unknown> = {
        parentNode: {
          insertBefore: (element: Record<string, unknown>): void => {
            inserted.push(element);
          },
        },
      };

      /*
       * The page's `posthog` is window.posthog; the loader augments the
       * object in place, so one array serves as both.
       */
      const queue: Array<unknown> = [];

      const fakeWindow: Record<string, unknown> = {
        localStorage: storage,
        location: {
          href: "https://oneuptime.com/",
          search: "",
          pathname: "/",
          hostname: "oneuptime.com",
        },
        navigator: {
          globalPrivacyControl: Boolean(options.globalPrivacyControl),
        },
        posthog: queue,
        requestIdleCallback: (callback: () => void): void => {
          idleCallbacks.push(callback);
        },
      };

      const fakeDocument: Record<string, unknown> = {
        cookie: "",
        createElement: (): Record<string, unknown> => {
          return {};
        },
        getElementsByTagName: (): Array<unknown> => {
          return [firstScript];
        },
      };

      // eslint-disable-next-line no-new-func
      const build: (...args: Array<unknown>) => unknown = new Function(
        "window",
        "document",
        "posthog",
        "requestIdleCallback",
        "Intl",
        `${consentSource}\n${posthogSource}\nreturn window.oneUptimeConsent;`,
      ) as (...args: Array<unknown>) => unknown;

      const consent: ConsentApi = build(
        fakeWindow,
        fakeDocument,
        queue,
        fakeWindow["requestIdleCallback"],
        fakeIntl(options.timeZone ?? OPT_OUT_ZONE),
      ) as ConsentApi;

      return {
        consent,
        queue,
        idleCallbacks,
        loadedScripts: (): Array<string> => {
          return inserted.map((element: Record<string, unknown>) => {
            return element["src"] as string;
          });
        },
        runIdle: (): void => {
          for (const callback of idleCallbacks.splice(0)) {
            callback();
          }
        },
      };
    };

    test("loads when the browser is idle, where measurement runs until refused", () => {
      const harness: PostHogHarness = loadPostHog({ timeZone: OPT_OUT_ZONE });

      // Deferred for LCP: nothing yet.
      expect(harness.loadedScripts()).toEqual([]);

      harness.runIdle();

      expect(harness.loadedScripts()).toEqual([POSTHOG_LIBRARY]);
    });

    test("does not load before the visitor accepts, where consent comes first", () => {
      const harness: PostHogHarness = loadPostHog({
        timeZone: CONSENT_FIRST_ZONE,
      });

      harness.runIdle();

      expect(harness.idleCallbacks).toEqual([]);
      expect(harness.loadedScripts()).toEqual([]);
    });

    test("loads once the visitor accepts", () => {
      const harness: PostHogHarness = loadPostHog({
        timeZone: CONSENT_FIRST_ZONE,
      });

      harness.consent.grant();
      harness.runIdle();

      expect(harness.loadedScripts()).toEqual([POSTHOG_LIBRARY]);
    });

    test.each([
      ["a refusal on an earlier visit", { storedConsent: "false" }],
      ["Global Privacy Control", { globalPrivacyControl: true }],
    ])("does not load after %s", (_label: string, options: HarnessOptions) => {
      const harness: PostHogHarness = loadPostHog({
        timeZone: OPT_OUT_ZONE,
        ...options,
      });

      harness.runIdle();

      expect(harness.loadedScripts()).toEqual([]);
    });

    /*
     * The loader is scheduled at page load and runs when the browser is idle;
     * a visitor can press "Reject all" in between.
     */
    test("does not load if the visitor refuses before the browser is idle", () => {
      const harness: PostHogHarness = loadPostHog({ timeZone: OPT_OUT_ZONE });

      harness.consent.deny();
      harness.runIdle();

      expect(harness.loadedScripts()).toEqual([]);
    });

    test("loads once, however it was asked to", () => {
      const harness: PostHogHarness = loadPostHog({ timeZone: OPT_OUT_ZONE });

      harness.consent.grant();
      harness.runIdle();

      expect(harness.loadedScripts()).toEqual([POSTHOG_LIBRARY]);
    });

    /*
     * PostHog remembers an opt-out by itself, so a visitor who refused once
     * and accepted later would otherwise stay opted out. Lifted silently: no
     * $opt_in event for a visitor who did nothing.
     */
    test("lifts an earlier opt-out silently when it loads", () => {
      const harness: PostHogHarness = loadPostHog({ timeZone: OPT_OUT_ZONE });

      harness.runIdle();

      expect(harness.queue).toContainEqual([
        "opt_in_capturing",
        { captureEventName: false },
      ]);
    });

    test("stops on the page where the visitor refuses", () => {
      const harness: PostHogHarness = loadPostHog({ timeZone: OPT_OUT_ZONE });

      harness.runIdle();
      harness.consent.deny();

      expect(harness.queue[harness.queue.length - 1]).toEqual([
        "opt_out_capturing",
      ]);
    });

    test("starts again when the visitor accepts after refusing", () => {
      const harness: PostHogHarness = loadPostHog({ timeZone: OPT_OUT_ZONE });

      harness.runIdle();
      harness.consent.deny();
      harness.consent.grant();

      expect(harness.queue[harness.queue.length - 1]).toEqual([
        "opt_in_capturing",
        { captureEventName: false },
      ]);
      // And it is not loaded a second time.
      expect(harness.loadedScripts()).toEqual([POSTHOG_LIBRARY]);
    });
  });

  describe("Cal booking metadata", () => {
    /*
     * Cal takes booking metadata as FLAT, BRACKETED config keys —
     * metadata[utm_source] — and returns them as payload.metadata.utm_source.
     *
     * A nested `metadata: { ... }` object does NOT work: Cal serialises each
     * config value into a query parameter, so the object becomes the string
     * "[object Object]" and every key inside it is lost. Nothing errors —
     * bookings are still recorded, they just arrive attributable to nothing,
     * which is exactly the bug this path exists to fix. These assertions are
     * the only thing standing between the right shape and a silent no-op.
     *
     * https://cal.com/help/embedding/prefill-booking-form-embed
     */
    test("brackets every key the way Cal expects", () => {
      const harness: Harness = loadHarness(html, {
        url: AD_URL,
        storedConsent: "true",
      });

      expect(harness.calMetadata()).toMatchObject({
        "metadata[utm_source]": "google",
        "metadata[utm_medium]": "cpc",
        "metadata[utm_campaign]": "enterprise-q3",
        "metadata[gclid]": "abc123",
      });
    });

    test("never emits an unbracketed key", () => {
      const harness: Harness = loadHarness(html, {
        url: AD_URL,
        storedConsent: "true",
      });

      for (const key of Object.keys(harness.calMetadata())) {
        expect(key).toMatch(/^metadata\[[a-z0-9_]+\]$/);
      }
    });

    /*
     * The inner names are the wire contract with the CRM's Cal webhook
     * receiver, which reads payload.metadata.<name>. Bracketing changes how
     * they travel, not what they are called on arrival.
     */
    test("uses the snake_case inner names the receiver parses", () => {
      const harness: Harness = loadHarness(html, {
        url: AD_URL,
        storedConsent: "true",
      });

      const innerNames: Array<string> = Object.keys(harness.calMetadata()).map(
        (key: string) => {
          return key.slice("metadata[".length, -1);
        },
      );

      expect(innerNames).toEqual(
        expect.arrayContaining([
          "utm_source",
          "utm_medium",
          "utm_campaign",
          "utm_url",
          "gclid",
          "ou_first_touch",
        ]),
      );
    });

    test("carries the landing URL", () => {
      const harness: Harness = loadHarness(html, {
        url: AD_URL,
        storedConsent: "true",
      });

      expect(harness.calMetadata()["metadata[utm_url]"]).toBe(AD_URL);
    });

    test("serializes the first touch as one JSON string", () => {
      const harness: Harness = loadHarness(html, {
        url: AD_URL,
        storedConsent: "true",
      });

      expect(
        JSON.parse(harness.calMetadata()["metadata[ou_first_touch]"]!),
      ).toMatchObject({
        utmSource: "google",
        clickIds: { gclid: "abc123" },
      });
    });

    /*
     * The first touch is JSON, and it is bounded as JSON — 4000 characters —
     * not by the 500-character per-value bound the flat fields get.
     *
     * This fixture is deliberately REALISTIC rather than minimal. A real first
     * touch carries five UTM values, a click id, and a landing URL that repeats
     * all of them as query parameters; that runs past 500 characters without
     * being unusual. Truncating JSON at 500 produces a string the webhook's
     * JSON.parse rejects, so the whole first touch would be dropped — silently,
     * and only for the visitors whose attribution is richest.
     *
     * An earlier version of this test used a short fixture and passed while the
     * code truncated.
     */
    test("keeps a realistic first touch intact and parseable", () => {
      const longClickId: string = "CjwKCAjw1oy0BhAKEiwAWDVpV" + "x".repeat(60);
      const landingUrl: string =
        "https://oneuptime.com/enterprise/demo?utm_source=google" +
        "&utm_medium=cpc&utm_campaign=enterprise-observability-q3" +
        `&utm_term=datadog+alternative&utm_content=demo-cta-variant-b&gclid=${longClickId}`;

      const firstTouch: Record<string, unknown> = {
        utmSource: "google",
        utmMedium: "cpc",
        utmCampaign: "enterprise-observability-q3",
        utmTerm: "datadog alternative",
        utmContent: "demo-cta-variant-b",
        clickIds: { gclid: longClickId },
        landingUrl: landingUrl,
        referrer: "https://www.google.com/",
        timestamp: "2026-08-22T10:00:00.000Z",
      };

      const serialized: string = JSON.stringify(firstTouch);

      // The fixture only tests anything if it is over the per-value bound.
      expect(serialized.length).toBeGreaterThan(500);

      const harness: Harness = loadHarness(html, {
        storedConsent: "true",
        storedAttribution: { firstTouch: serialized, utmSource: "google" },
      });

      const sent: string = harness.calMetadata()["metadata[ou_first_touch]"]!;

      expect(sent).toHaveLength(serialized.length);
      expect(() => {
        return JSON.parse(sent);
      }).not.toThrow();
      expect(JSON.parse(sent)).toEqual(firstTouch);
    });

    /*
     * Cal serialises config values into query parameters, so anything that is
     * not already a string is stringified by JavaScript — which is how a nested
     * object turns into "[object Object]".
     */
    test("holds only scalar strings", () => {
      const harness: Harness = loadHarness(html, {
        url: AD_URL,
        storedConsent: "true",
      });

      for (const value of Object.values(harness.calMetadata())) {
        expect(typeof value).toBe("string");
      }
    });

    /*
     * THE WIRE CONTRACT, ASSERTED MECHANICALLY.
     *
     * The browser writes these keys and the CRM's Cal webhook receiver reads
     * them. The two live in different systems entirely, edited at different
     * times by different people — and a key the browser sends that the
     * receiver does not read is dropped in total silence. Nothing errors, the
     * booking is still recorded, the attribution just is not there.
     *
     * Checking that correspondence by eye is how the last two bugs on this path
     * got through, so the browser half is pinned here against the shared
     * contract instead.
     */
    test("sends no key outside the agreed set", () => {
      const readableKeys: Set<string> = new Set<string>([
        ...AdClickIdKeys,
        ...Object.keys(UtmWireKeyToPropertyKey),
        "utm_url",
        "ou_first_touch",
        "ou_booking_kind",
      ]);

      const harness: Harness = loadHarness(html, {
        url: EVERY_PARAM_URL,
        storedConsent: "true",
      });

      const innerNames: Array<string> = Object.keys(
        harness.calMetadata("enterprise_demo"),
      ).map((key: string) => {
        return key.slice("metadata[".length, -1);
      });

      // The fixture has to actually exercise the keys for this to mean anything.
      expect(innerNames.length).toBeGreaterThanOrEqual(readableKeys.size);

      for (const name of innerNames) {
        expect(readableKeys).toContain(name);
      }
    });

    /*
     * And the other direction: a key the receiver learns to read but the
     * browser never sends is dead weight that looks like working code.
     */
    test("sends every click id the shared contract names", () => {
      const harness: Harness = loadHarness(html, {
        url: EVERY_PARAM_URL,
        storedConsent: "true",
      });

      const metadata: Record<string, string> = harness.calMetadata();

      for (const clickIdKey of AdClickIdKeys) {
        expect(metadata[`metadata[${clickIdKey}]`]).toBe(`${clickIdKey}-value`);
      }
    });

    test("sends every UTM parameter the shared contract names", () => {
      const harness: Harness = loadHarness(html, {
        url: EVERY_PARAM_URL,
        storedConsent: "true",
      });

      const metadata: Record<string, string> = harness.calMetadata();

      for (const wireKey of Object.keys(UtmWireKeyToPropertyKey)) {
        expect(metadata[`metadata[${wireKey}]`]).toBe(`${wireKey}-value`);
      }
    });

    test("is empty when there is nothing to attribute and no kind", () => {
      const harness: Harness = loadHarness(html, {
        url: "https://oneuptime.com/enterprise/demo",
      });

      expect(harness.calMetadata()).toEqual({});
    });

    /*
     * All three embeds book the same Cal event type (oneuptimehq/demo), so the
     * booking kind is the only thing that tells a support call apart from an
     * enterprise demo on the receiver's side. It travels even when there is no
     * campaign to report, because the embed always knows what it is.
     */
    test("always carries the booking kind, campaign or not", () => {
      const harness: Harness = loadHarness(html, {
        url: "https://oneuptime.com/enterprise/demo",
      });

      expect(harness.calMetadata("support_call")).toEqual({
        "metadata[ou_booking_kind]": "support_call",
      });
    });

    test("carries the booking kind alongside the campaign", () => {
      const harness: Harness = loadHarness(html, { url: AD_URL });

      expect(harness.calMetadata("architecture_assessment")).toMatchObject({
        "metadata[ou_booking_kind]": "architecture_assessment",
        "metadata[utm_source]": "google",
        "metadata[gclid]": "abc123",
      });
    });

    /*
     * A browser that refuses localStorage outright — private mode, "block all
     * site data", a sandboxed iframe, enterprise storage policy — swallows
     * every setItem as best-effort. The touch still has to reach Cal, or a
     * paid click in that context books a demo the receiver records as
     * unattributed, which is the failure this whole path exists to prevent.
     */
    test("still attributes the booking when storage is unavailable", () => {
      const working: Record<string, string> = loadHarness(html, {
        url: AD_URL,
      }).calMetadata("enterprise_demo");

      const blocked: Record<string, string> = loadHarness(html, {
        url: AD_URL,
        storageThrows: true,
      }).calMetadata("enterprise_demo");

      expect(blocked["metadata[gclid]"]).toBe("abc123");
      expect(blocked["metadata[utm_source]"]).toBe("google");
      expect(blocked["metadata[utm_url]"]).toBe(AD_URL);
      expect(JSON.parse(blocked["metadata[ou_first_touch]"]!)).toMatchObject({
        utmSource: "google",
        clickIds: { gclid: "abc123" },
      });

      /*
       * Nothing about a working store should change what is sent. The first
       * touch is compared with its `timestamp` dropped, because that is
       * stamped at load and the two harnesses load milliseconds apart.
       */
      const withoutTimestamp: (
        bag: Record<string, string>,
      ) => Record<string, unknown> = (
        bag: Record<string, string>,
      ): Record<string, unknown> => {
        const copy: Record<string, unknown> = { ...bag };
        const firstTouch: Record<string, unknown> = JSON.parse(
          bag["metadata[ou_first_touch]"]!,
        ) as Record<string, unknown>;

        delete firstTouch["timestamp"];
        copy["metadata[ou_first_touch]"] = firstTouch;

        return copy;
      };

      expect(withoutTimestamp(blocked)).toEqual(withoutTimestamp(working));
    });

    test("carries the campaign before the banner is answered, where that is allowed", () => {
      const harness: Harness = loadHarness(html, {
        url: AD_URL,
        timeZone: OPT_OUT_ZONE,
      });

      expect(harness.calMetadata()).toMatchObject({
        "metadata[utm_campaign]": "enterprise-q3",
        "metadata[gclid]": "abc123",
      });
    });

    /*
     * The booking still goes through and still says what kind it is; it just
     * carries no campaign. The CRM receives it unattributed.
     */
    test("carries only the booking kind while measurement waits for consent", () => {
      const harness: Harness = loadHarness(html, {
        url: AD_URL,
        timeZone: CONSENT_FIRST_ZONE,
      });

      expect(harness.calMetadata("enterprise_demo")).toEqual({
        "metadata[ou_booking_kind]": "enterprise_demo",
      });
    });

    test("carries only the booking kind after a refusal", () => {
      const harness: Harness = loadHarness(html, {
        url: AD_URL,
        timeZone: OPT_OUT_ZONE,
      });

      harness.consent.deny();

      expect(harness.calMetadata("support_call")).toEqual({
        "metadata[ou_booking_kind]": "support_call",
      });
    });

    test("drops an oversized first touch rather than sending it", () => {
      const harness: Harness = loadHarness(html, {
        storedConsent: "true",
        storedAttribution: {
          firstTouch: JSON.stringify({ utmSource: "s".repeat(5000) }),
          utmSource: "google",
        },
      });

      const metadata: Record<string, string> = harness.calMetadata();

      expect(metadata["metadata[ou_first_touch]"]).toBeUndefined();
      // The rest still travels.
      expect(metadata["metadata[utm_source]"]).toBe("google");
    });
  });

  describe("the cookie banner", () => {
    test("routes both buttons through the consent helper", () => {
      expect(html).toContain("window.oneUptimeConsent.grant();");
      expect(html).toContain("window.oneUptimeConsent.deny();");
    });

    /*
     * Re-asking someone who declined is how a consent banner turns into a dark
     * pattern; both answers close it.
     */
    test("shows itself only while the visitor has not answered", () => {
      expect(html).toContain("if (state === 'unset') {");
    });
  });
});
