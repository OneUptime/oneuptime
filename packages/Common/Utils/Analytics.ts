import Email from "../Types/Email";
import { JSONObject } from "../Types/JSON";
import posthog from "posthog-js";
import {
  REVENUE_EVENT_SCHEMA_VERSION,
  RevenueEventName,
  RevenueEventProperties,
} from "../Types/Analytics/RevenueEvent";

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
    if (apiHost && apiKey) {
      posthog.init(apiKey, { api_host: apiHost, autocapture: false });
      this.isInitialized = true;
    }
  }

  public userAuth(email: Email): void {
    if (!this.isInitialized) {
      return;
    }
    posthog.identify(email.toString());
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

    /*
     * GA4 tracking via dataLayer (for Google Analytics / Google Ads conversion
     * tracking). This must not depend on PostHog being configured — GTM is
     * loaded independently of ANALYTICS_KEY / ANALYTICS_HOST.
     */
    if (typeof window !== "undefined" && (window as any).dataLayer) {
      (window as any).dataLayer.push({
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
