import Email from "../Types/Email";
import { JSONObject } from "../Types/JSON";
import posthog from "posthog-js";
import {
  REVENUE_EVENT_SCHEMA_VERSION,
  RevenueEventName,
  RevenueEventProperties,
} from "../Types/Analytics/RevenueEvent";

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

  public capture(eventName: string, data?: JSONObject): void {
    // PostHog tracking
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
        event: eventName,
        eventCategory: "analytics",
        eventAction: eventName,
        ...(data || {}),
      });
    }
  }
}
