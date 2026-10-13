import Email from "../Types/Email";
import { JSONObject, JSONValue } from "../Types/JSON";
import posthog from "posthog-js";
import {
  GoogleAnalyticsEventParameters,
  REVENUE_EVENT_SCHEMA_VERSION,
  RevenueEventName,
  RevenueEventProperties,
  isRevenueEventName,
} from "../Types/Analytics/RevenueEvent";

/*
 * Where the visitor's answer on the cookie banner is kept. Must match
 * Common/Server/Views/Partials/AnalyticsConsent.ejs; the origins share one
 * hostname on OneUptime Cloud, so the product reads the marketing site's
 * answer here.
 */
export const COOKIE_CONSENT_STORAGE_KEY: string = "cookiesAccepted";

/*
 * What the server-rendered page tells this class about measurement, on window:
 * set by Common/Server/Views/Partials/AnalyticsConsent.ejs and
 * NoProductAnalytics.ejs.
 */
interface MeasurementWindow {
  oneUptimeProductAnalyticsDisabled?: boolean | undefined;
  oneUptimeConsent?: { state: () => string } | undefined;
  oneUptimeGoogleTagMode?: string | undefined;
  dataLayer?: Array<JSONObject> | undefined;
  gtag?: ((...args: Array<unknown>) => void) | undefined;
  localStorage?: Storage | undefined;
  navigator?: { globalPrivacyControl?: boolean | undefined } | undefined;
}

const measurementWindow: () => MeasurementWindow | null =
  (): MeasurementWindow | null => {
    if (typeof window === "undefined") {
      return null;
    }

    return window as unknown as MeasurementWindow;
  };

export interface PurchaseData {
  /*
   * The server's marketing event ID for the same conversion
   * (Docs/analytics/marketing-event-webhooks.md), so the two can be joined.
   */
  transactionId: string;
  // Monthly recurring revenue after the change, as the server reports it.
  value: number;
  currency: string;
  plan: string;
}

// GA4 rejects event names longer than 40 characters.
const GA4_MAX_EVENT_NAME_LENGTH: number = 40;

/*
 * Prefix used when a name has no usable leading letter (GA4 requires the first
 * character to be a letter, so names like "404_page" cannot be sent as-is).
 */
const GA4_EVENT_NAME_FALLBACK: string = "event";

// GA4 requires the first character of an event name to be a letter.
const GA4_EVENT_NAME_LEADING_LETTER: RegExp = /^[a-z]/;

export default class Analytics {
  private _isInitialized: boolean = false;
  public get isInitialized(): boolean {
    return this._isInitialized;
  }
  public set isInitialized(v: boolean) {
    this._isInitialized = v;
  }

  public constructor(apiHost: string, apiKey: string) {
    if (apiHost && apiKey && Analytics.isProductAnalyticsAllowed()) {
      posthog.init(apiKey, { api_host: apiHost, autocapture: false });
      this.isInitialized = true;
    }
  }

  /**
   * Whether product analytics (PostHog) may start on this page.
   *
   * Not on pages that measure nothing for OneUptime - status pages, public
   * dashboards and the admin console, which set
   * window.oneUptimeProductAnalyticsDisabled - and not for a visitor who
   * pressed "Reject all" on the marketing site's cookie banner, or who has
   * not answered it and whose browser sends Global Privacy Control.
   *
   * Unlike the Google tag, it does not wait for an answer where the law asks
   * for consent first: the product has no banner to give one on.
   */
  public static isProductAnalyticsAllowed(): boolean {
    const page: MeasurementWindow | null = measurementWindow();

    if (!page) {
      return true;
    }

    if (page.oneUptimeProductAnalyticsDisabled === true) {
      return false;
    }

    const consent: string = Analytics.getConsentState(page);

    if (consent === "granted") {
      return true;
    }

    if (consent === "denied") {
      return false;
    }

    return !Analytics.hasGlobalPrivacyControl(page);
  }

  private static hasGlobalPrivacyControl(page: MeasurementWindow): boolean {
    try {
      return page.navigator?.globalPrivacyControl === true;
    } catch {
      return false;
    }
  }

  private static getConsentState(page: MeasurementWindow): string {
    if (page.oneUptimeConsent) {
      return page.oneUptimeConsent.state();
    }

    // A page without the consent partial still reads the stored answer.
    try {
      const raw: string | null =
        page.localStorage?.getItem(COOKIE_CONSENT_STORAGE_KEY) ?? null;

      if (raw === "true") {
        return "granted";
      }

      if (raw === "false") {
        return "denied";
      }
    } catch {
      // Unreadable storage is not an answer.
    }

    return "unset";
  }

  /**
   * The parameters Google Analytics receives with a key event: the agreed
   * list (GoogleAnalyticsEventParameters), with plain values only.
   */
  public static toGoogleAnalyticsParameters(data?: JSONObject): JSONObject {
    const parameters: JSONObject = {};

    for (const key of GoogleAnalyticsEventParameters) {
      const value: JSONValue | undefined = data?.[key];

      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        parameters[key] = value;
      }
    }

    return parameters;
  }

  public userAuth(email: Email): void {
    if (!this.isInitialized) {
      return;
    }
    posthog.identify(email.toString());
  }

  /**
   * Tell Google Analytics who is signed in, so one person's sessions join up
   * across devices: the internal user ID, never an email address. Only where
   * the page loaded Google Analytics itself (sign-up and the dashboard); gtag
   * holds the call until consent lets Google Analytics load.
   */
  public setGoogleAnalyticsUserId(userId: string): void {
    const page: MeasurementWindow | null = measurementWindow();

    if (
      !userId ||
      !page ||
      page.oneUptimeGoogleTagMode !== "analytics-only" ||
      typeof page.gtag !== "function"
    ) {
      return;
    }

    page.gtag("set", { user_id: userId });
  }

  /**
   * The purchase a project created on a paid plan makes. None for custom
   * pricing, which has no amount to report.
   */
  public static purchaseForNewProject(data: {
    projectId: string;
    planName: string;
    monthlyAmountInUSD: number | null;
  }): PurchaseData | null {
    if (!data.projectId || data.monthlyAmountInUSD === null) {
      return null;
    }

    return {
      transactionId: `subscription_started:${data.projectId}`,
      value: data.monthlyAmountInUSD,
      currency: "USD",
      plan: data.planName,
    };
  }

  /**
   * The purchase a plan change makes, if any: only a free project becoming a
   * paying one. A move between paid tiers is expansion, not a purchase, and
   * custom pricing has no amount to report. A project can upgrade more than
   * once, so the moment of the change is part of the ID, as it is on the
   * server's event.
   */
  public static purchaseForPlanChange(data: {
    projectId: string;
    planName: string;
    isPaidConversion: boolean;
    monthlyAmountInUSD: number | null;
    seats: number;
    changedAt: Date;
  }): PurchaseData | null {
    if (
      !data.projectId ||
      !data.isPaidConversion ||
      data.monthlyAmountInUSD === null
    ) {
      return null;
    }

    return {
      transactionId: `subscription_upgraded:${data.projectId}:${data.changedAt.toISOString()}`,
      value: data.monthlyAmountInUSD * data.seats,
      currency: "USD",
      plan: data.planName,
    };
  }

  /**
   * A paid conversion as Google Analytics' `purchase` event, so its revenue
   * reports and Google Ads' return on ad spend have something to count. Sent
   * alongside the subscription event rather than instead of it, and to Google
   * Analytics only: PostHog already has the subscription event.
   */
  public capturePurchase(data: PurchaseData): void {
    const page: MeasurementWindow | null = measurementWindow();

    if (
      !page ||
      page.oneUptimeGoogleTagMode !== "analytics-only" ||
      typeof page.gtag !== "function"
    ) {
      return;
    }

    page.gtag("event", "purchase", {
      transaction_id: data.transactionId,
      value: data.value,
      currency: data.currency,
      items: [
        {
          item_id: data.plan,
          item_name: data.plan,
          price: data.value,
          quantity: 1,
        },
      ],
    });
  }

  public logout(): void {
    if (!this.isInitialized) {
      return;
    }
    posthog.reset();
  }

  public captureRevenueEvent(
    eventName: RevenueEventName,
    data: RevenueEventProperties,
  ): void {
    this.capture(eventName, {
      ...data,
      event_schema_version: REVENUE_EVENT_SCHEMA_VERSION,
    });
  }

  /**
   * Coerce an arbitrary event name into one GA4 accepts: it must start with a
   * letter and contain only letters, digits and underscores, up to 40
   * characters.
   *
   * Product code calls capture() with free-form, human-readable names
   * ("Page View: Project > Home", "FORM SUBMIT: Register", "accounts/login"),
   * which GA4 would reject. Every name in RevenueEventName is already
   * compliant and passes through unchanged, so GTM tags keyed on those names
   * are unaffected.
   *
   * This is deliberately applied to the dataLayer branch only — the name sent
   * to PostHog is left untouched so existing PostHog insights and dashboards
   * keep matching.
   */
  public static toGA4EventName(eventName: string): string {
    let name: string = eventName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

    if (name.length === 0) {
      return GA4_EVENT_NAME_FALLBACK;
    }

    if (!GA4_EVENT_NAME_LEADING_LETTER.test(name)) {
      name = `${GA4_EVENT_NAME_FALLBACK}_${name}`;
    }

    /*
     * Truncating can leave a trailing underscore. The name starts with a
     * letter by this point, so stripping those always leaves a valid name.
     */
    return name.slice(0, GA4_MAX_EVENT_NAME_LENGTH).replace(/_+$/g, "");
  }

  public capture(eventName: string, data?: JSONObject): void {
    // PostHog tracking. The original, un-normalised name is used here.
    if (this.isInitialized) {
      posthog.capture(eventName, data);
    }

    const page: MeasurementWindow | null = measurementWindow();

    if (!page) {
      return;
    }

    /*
     * Sign-up and the dashboard load Google Analytics alone, with no Tag
     * Manager container to pick events off the dataLayer. So the funnel's key
     * events go to it directly - only those, with only the agreed parameters.
     * Google Analytics loads only once consent allows; until then gtag queues
     * the call and nothing is sent.
     */
    if (page.oneUptimeGoogleTagMode === "analytics-only") {
      if (typeof page.gtag === "function" && isRevenueEventName(eventName)) {
        page.gtag(
          "event",
          eventName,
          Analytics.toGoogleAnalyticsParameters(data),
        );
      }

      return;
    }

    /*
     * GA4 tracking via dataLayer (for Google Analytics / Google Ads conversion
     * tracking), on a page that loads the Tag Manager container. This must not
     * depend on PostHog being configured — GTM is loaded independently of
     * ANALYTICS_KEY / ANALYTICS_HOST.
     */
    if (page.dataLayer) {
      page.dataLayer.push({
        eventCategory: "analytics",
        // The raw name is kept here so the original is still readable in GTM.
        eventAction: eventName,
        ...(data || {}),
        /*
         * `event` is the GA4 event name and has to stay valid, so it is
         * applied after the spread and cannot be overridden by properties.
         */
        event: Analytics.toGA4EventName(eventName),
      });
    }
  }
}
