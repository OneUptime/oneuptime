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
 * The cookie banner wrote `cookiesAccepted` to localStorage and nothing
 * anywhere read it. Google Tag Manager, PostHog and the attribution capture
 * all ran identically whether the visitor pressed Accept, pressed Reject, or
 * never saw the banner — "Reject all" rejected nothing, and there was no
 * Google Consent Mode signal at all.
 *
 * Making consent real is what makes attribution delicate: gate storage on
 * consent naively and an ad visitor who lands, accepts, and signs up in one
 * session loses the click id that brought them, because it was discarded
 * before they answered the banner. Hence the pending buffer, which is the
 * behaviour most of these tests are about.
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
}

interface ConsentApi {
  state: () => string;
  isGranted: () => boolean;
  grant: () => void;
  deny: () => void;
  onChange: (listener: (granted: boolean) => void) => void;
}

interface AttributionSnapshot {
  utm: Record<string, string>;
  clickIds: Record<string, string>;
  firstTouch: Record<string, unknown> | null;
}

interface Harness {
  consent: ConsentApi;
  getAttribution: () => AttributionSnapshot;
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
    `${gtagSource}\n${consentSource}\n${reportingSource}\n${attributionSource}\nreturn {
       consent: window.oneUptimeConsent,
       getAttribution: window.oneUptimeGetAttribution
     };`,
  ) as (...args: Array<unknown>) => unknown;

  const exposed: {
    consent: ConsentApi;
    getAttribution: () => AttributionSnapshot;
  } = build(fakeWindow, fakeDocument, dataLayer, posthog, URLSearchParams) as {
    consent: ConsentApi;
    getAttribution: () => AttributionSnapshot;
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
    test("defaults every advertising and analytics signal to denied", () => {
      const harness: Harness = loadHarness(html);
      const [defaults] = consentSignals(harness);

      expect(defaults).toMatchObject({
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
        analytics_storage: "denied",
        functionality_storage: "denied",
        personalization_storage: "denied",
      });
    });

    /*
     * security_storage covers things like fraud prevention rather than
     * advertising, and is granted under Consent Mode's own guidance.
     */
    test("grants security storage in the defaults", () => {
      const harness: Harness = loadHarness(html);

      expect(consentSignals(harness)[0]).toMatchObject({
        security_storage: "granted",
      });
    });

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

    test("pushes an update signal when consent is granted", () => {
      const harness: Harness = loadHarness(html);

      harness.consent.grant();

      const signals: Array<Record<string, string>> = consentSignals(harness);

      expect(signals[signals.length - 1]).toMatchObject({
        ad_storage: "granted",
        ad_user_data: "granted",
        ad_personalization: "granted",
        analytics_storage: "granted",
      });
    });

    /*
     * "Reject all" used to do nothing at all. It must now say so explicitly
     * rather than merely failing to grant.
     */
    test("pushes an explicit denial when consent is refused", () => {
      const harness: Harness = loadHarness(html);

      harness.consent.deny();

      const signals: Array<Record<string, string>> = consentSignals(harness);

      expect(signals[signals.length - 1]).toMatchObject({
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
        analytics_storage: "denied",
      });
    });

    test("tells Google about a decision made on an earlier visit", () => {
      const harness: Harness = loadHarness(html, { storedConsent: "true" });

      // Default, then the stored grant, before the tag has loaded.
      expect(consentSignals(harness)).toHaveLength(2);
      expect(consentSignals(harness)[1]).toMatchObject({
        ad_storage: "granted",
      });
    });
  });

  /*
   * A self-hosted install loads no Google tag at all. Consent still has to
   * work — it gates the attribution capture and PostHog either way — but there
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

    test("still gates attribution storage on consent", () => {
      const harness: Harness = loadHarness(selfHostedHtml, { url: AD_URL });

      expect(harness.storage.store.size).toBe(0);

      harness.consent.grant();

      expect(harness.storage.store.get("utmSource")).toBe("google");
    });
  });

  describe("consent state", () => {
    test("is unset until the visitor answers", () => {
      expect(loadHarness(html).consent.state()).toBe("unset");
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
    test("stores nothing at all before the visitor consents", () => {
      const harness: Harness = loadHarness(html, { url: AD_URL });

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

    /*
     * THE CASE THIS DESIGN EXISTS FOR. Someone arrives from an ad, the banner
     * is in front of them, they accept, and they sign up. Discarding the touch
     * before they answered would lose the click id that brought them — which
     * is the single most valuable thing on the page.
     */
    test("flushes the held touch when consent is granted on the same page", () => {
      const harness: Harness = loadHarness(html, { url: AD_URL });

      expect(harness.storage.store.size).toBe(0);

      harness.consent.grant();

      expect(harness.storage.store.get("utmSource")).toBe("google");
      expect(JSON.parse(harness.storage.store.get("clickIds")!)).toEqual({
        gclid: "abc123",
      });
      expect(
        JSON.parse(harness.storage.store.get("firstTouch")!),
      ).toMatchObject({
        utmSource: "google",
        utmCampaign: "enterprise-q3",
        clickIds: { gclid: "abc123" },
      });
    });

    test("stores nothing when consent is refused on the same page", () => {
      const harness: Harness = loadHarness(html, { url: AD_URL });

      harness.consent.deny();

      expect(harness.storage.store.has("utmSource")).toBe(false);
      expect(harness.storage.store.has("clickIds")).toBe(false);
    });

    /*
     * Refusing has to undo, not merely stop. Someone who accepted last month
     * and refuses today expects what was kept to be forgotten.
     */
    test("clears what an earlier visit stored when consent is refused", () => {
      const harness: Harness = loadHarness(html, {
        storedConsent: "true",
        storedAttribution: {
          utmSource: "google",
          utmCampaign: "old-campaign",
          utmUrl: "https://oneuptime.com/?gclid=old",
          clickIds: JSON.stringify({ gclid: "old" }),
          firstTouch: JSON.stringify({ utmSource: "google" }),
        },
      });

      harness.consent.deny();

      for (const key of [
        "utmSource",
        "utmCampaign",
        "utmUrl",
        "clickIds",
        "firstTouch",
      ]) {
        expect(harness.storage.store.has(key)).toBe(false);
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
     * The held touch is readable even though it has not been stored, so a
     * signup on the very page the visitor landed on still carries the
     * campaign that brought them.
     */
    test("reads the held touch before consent has been given", () => {
      const harness: Harness = loadHarness(html, { url: AD_URL });

      expect(harness.getAttribution()).toMatchObject({
        utm: { utmSource: "google", utmCampaign: "enterprise-q3" },
        clickIds: { gclid: "abc123" },
      });
      expect(harness.storage.store.size).toBe(0);
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

  describe("PostHog loading", () => {
    test("is deferred until consent is granted", () => {
      // The library is only fetched inside initPostHog, behind the gate.
      expect(html).toContain(
        "if (window.oneUptimeConsent && window.oneUptimeConsent.isGranted()) {",
      );
      expect(html).toContain("initWhenIdle();");
    });

    test("loads later if the visitor accepts mid-session", () => {
      expect(html).toContain(
        "window.oneUptimeConsent.onChange(function (granted) {",
      );
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
