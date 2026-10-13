import Email from "../../Types/Email";
import { JSONObject } from "../../Types/JSON";
import Analytics, { COOKIE_CONSENT_STORAGE_KEY } from "../../Utils/Analytics";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import posthog from "posthog-js";
import {
  GoogleAnalyticsEventParameters,
  REVENUE_EVENT_SCHEMA_VERSION,
  RevenueEventName,
  RevenueFunnelStage,
  isRevenueEventName,
} from "../../Types/Analytics/RevenueEvent";

jest.mock("posthog-js", () => {
  return {
    init: jest.fn(),
    identify: jest.fn(),
    reset: jest.fn(),
    capture: jest.fn(),
  };
});

const apiHost: string = "https://example.com";
const apiKey: string = "your-api-key";

describe("Analytics Class", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should initialize the Analytics class", () => {
    const analytics: Analytics = new Analytics(apiHost, apiKey);

    expect(posthog.init).toHaveBeenCalledWith(apiKey, {
      api_host: apiHost,
      autocapture: false,
    });
    expect(analytics.isInitialized).toBe(true);
  });

  it("should not initialize if apiHost and apiKey are not provided", () => {
    const analytics: Analytics = new Analytics("", "");

    expect(posthog.init).not.toHaveBeenCalled();
    expect(analytics.isInitialized).toBe(false);
  });

  it("should authenticate a user", () => {
    const analytics: Analytics = new Analytics(apiHost, apiKey);
    const email: Email = new Email("test@example.com");

    analytics.userAuth(email);
    expect(posthog.identify).toHaveBeenCalledWith(email.toString());
  });

  it("should not authenticate a user if not initialized", () => {
    const analytics: Analytics = new Analytics("", "");
    const email: Email = new Email("test@example.com");

    analytics.userAuth(email);
    expect(posthog.identify).not.toHaveBeenCalled();
  });

  it("should reset the user session on logout", () => {
    const analytics: Analytics = new Analytics(apiHost, apiKey);

    analytics.logout();
    expect(posthog.reset).toHaveBeenCalled();
  });

  it("should not reset the user session if not initialized", () => {
    const analytics: Analytics = new Analytics("", "");

    analytics.logout();
    expect(posthog.reset).not.toHaveBeenCalled();
  });

  it("should capture an event with optional data", () => {
    const analytics: Analytics = new Analytics(apiHost, apiKey);
    const eventName: string = "testEvent";
    const data: JSONObject = { key: "value" };

    analytics.capture(eventName, data);
    expect(posthog.capture).toHaveBeenCalledWith(eventName, data);
  });

  it("should capture a versioned revenue event", () => {
    const analytics: Analytics = new Analytics(apiHost, apiKey);

    analytics.captureRevenueEvent(RevenueEventName.WorkspaceCreated, {
      funnel_stage: RevenueFunnelStage.Activation,
      project_id: "project-123",
    });

    expect(posthog.capture).toHaveBeenCalledWith(
      RevenueEventName.WorkspaceCreated,
      {
        funnel_stage: RevenueFunnelStage.Activation,
        project_id: "project-123",
        event_schema_version: REVENUE_EVENT_SCHEMA_VERSION,
      },
    );
  });

  it("should not capture an event if not initialized", () => {
    const analytics: Analytics = new Analytics("", "");

    analytics.capture("testEvent");
    expect(posthog.capture).not.toHaveBeenCalled();
  });
});

describe("Analytics.toGA4EventName", () => {
  /*
   * GA4 event names must start with a letter and contain only letters, digits
   * and underscores, with a maximum length of 40 characters.
   */
  const GA4_EVENT_NAME_REGEX: RegExp = /^[a-z][a-z0-9_]*$/;

  it.each([
    // Names product code sends today that GA4 would otherwise reject.
    ["Page View: Project > Home", "page_view_project_home"],
    ["FORM SUBMIT: Register", "form_submit_register"],
    ["accounts/login", "accounts_login"],
    ["accounts/register", "accounts_register"],
    ["dashboard/home", "dashboard_home"],
    ["dashboard/ai-copilot", "dashboard_ai_copilot"],
    ["dashboard/billing/plan-changed", "dashboard_billing_plan_changed"],
    [
      "dashboard/home/getting-started-task",
      "dashboard_home_getting_started_task",
    ],
    [
      "dashboard/home/getting-started-dismissed",
      "dashboard_home_getting_started_dismissed",
    ],
    // Leading and trailing separators are dropped rather than kept.
    ["  /accounts/login/  ", "accounts_login"],
    // A name with no leading letter gets a prefix.
    ["404 page not found", "event_404_page_not_found"],
    ["_leading_underscore", "leading_underscore"],
    // A name with nothing usable in it falls back entirely.
    ["***", "event"],
    ["", "event"],
    // Casing is normalised.
    ["testEvent", "testevent"],
  ])("normalises %j to %j", (input: string, expected: string) => {
    expect(Analytics.toGA4EventName(input)).toBe(expected);
  });

  it("truncates to 40 characters without leaving a trailing underscore", () => {
    const normalized: string = Analytics.toGA4EventName(
      "Page View: Project > Settings > Notification > Email",
    );

    expect(normalized).toBe("page_view_project_settings_notification");
    expect(normalized.length).toBeLessThanOrEqual(40);
  });

  it("truncates a name that is exactly at the boundary", () => {
    const normalized: string = Analytics.toGA4EventName(
      "Page View: Project > Settings > Notifications > Email",
    );

    expect(normalized).toBe("page_view_project_settings_notifications");
    expect(normalized).toHaveLength(40);
  });

  it("leaves already GA4-compatible revenue event names untouched", () => {
    for (const eventName of Object.values(RevenueEventName)) {
      expect(Analytics.toGA4EventName(eventName)).toBe(eventName);
    }
  });

  it("always produces a GA4-valid name", () => {
    const inputs: Array<string> = [
      "Page View: Project > Home",
      "FORM SUBMIT: Register",
      "accounts/login",
      "404",
      "___",
      "!!!",
      "",
      "  ",
      "a".repeat(200),
      "1".repeat(200),
      "Page View: " + "Very Long Breadcrumb > ".repeat(10),
    ];

    for (const input of inputs) {
      const normalized: string = Analytics.toGA4EventName(input);

      expect(normalized).toMatch(GA4_EVENT_NAME_REGEX);
      expect(normalized.length).toBeGreaterThan(0);
      expect(normalized.length).toBeLessThanOrEqual(40);
      // Normalising an already-normalised name must be a no-op.
      expect(Analytics.toGA4EventName(normalized)).toBe(normalized);
    }
  });
});

describe("Analytics dataLayer (GA4) branch", () => {
  let dataLayer: Array<JSONObject>;

  beforeEach(() => {
    dataLayer = [];
    (window as any).dataLayer = dataLayer;
  });

  afterEach(() => {
    delete (window as any).dataLayer;
    jest.clearAllMocks();
  });

  it("pushes a normalised event name while PostHog keeps the original", () => {
    const analytics: Analytics = new Analytics(apiHost, apiKey);

    analytics.capture("Page View: Project > Home");

    expect(posthog.capture).toHaveBeenCalledWith(
      "Page View: Project > Home",
      undefined,
    );
    expect(dataLayer).toHaveLength(1);
    expect(dataLayer[0]).toEqual({
      event: "page_view_project_home",
      eventCategory: "analytics",
      eventAction: "Page View: Project > Home",
    });
  });

  it("pushes to the dataLayer even when PostHog is not initialized", () => {
    const analytics: Analytics = new Analytics("", "");

    analytics.capture("FORM SUBMIT: Register");

    expect(posthog.capture).not.toHaveBeenCalled();
    expect(dataLayer).toHaveLength(1);
    expect(dataLayer[0]).toMatchObject({
      event: "form_submit_register",
      eventAction: "FORM SUBMIT: Register",
    });
  });

  it("includes event properties in the pushed payload", () => {
    const analytics: Analytics = new Analytics(apiHost, apiKey);

    analytics.capture("dashboard/billing/plan-changed", {
      plan_name: "growth",
      is_paid_conversion: true,
    });

    expect(dataLayer[0]).toEqual({
      event: "dashboard_billing_plan_changed",
      eventCategory: "analytics",
      eventAction: "dashboard/billing/plan-changed",
      plan_name: "growth",
      is_paid_conversion: true,
    });
  });

  it("does not let event properties override the GA4 event name", () => {
    const analytics: Analytics = new Analytics(apiHost, apiKey);

    analytics.capture("accounts/login", { event: "Not A Valid GA4 Name" });

    expect(dataLayer[0]).toMatchObject({ event: "accounts_login" });
  });

  it("pushes revenue event names unchanged", () => {
    const analytics: Analytics = new Analytics(apiHost, apiKey);

    analytics.captureRevenueEvent(RevenueEventName.WorkspaceCreated, {
      funnel_stage: RevenueFunnelStage.Activation,
      project_id: "project-123",
    });

    expect(dataLayer[0]).toEqual({
      event: RevenueEventName.WorkspaceCreated,
      eventCategory: "analytics",
      eventAction: RevenueEventName.WorkspaceCreated,
      funnel_stage: RevenueFunnelStage.Activation,
      project_id: "project-123",
      event_schema_version: REVENUE_EVENT_SCHEMA_VERSION,
    });
  });

  it("does not throw when window.dataLayer is not defined", () => {
    delete (window as any).dataLayer;

    const analytics: Analytics = new Analytics(apiHost, apiKey);

    expect(() => {
      analytics.capture("accounts/login");
    }).not.toThrow();
    expect(posthog.capture).toHaveBeenCalledWith("accounts/login", undefined);
  });
});

/*
 * Product analytics (PostHog) and the pages and visitors it must leave alone.
 * The server-rendered page tells Analytics about both on window: status pages,
 * public dashboards and the admin console set
 * oneUptimeProductAnalyticsDisabled (Common/Server/Views/Partials/
 * NoProductAnalytics.ejs), and the consent partial exposes the visitor's
 * answer as oneUptimeConsent.
 */
describe("when product analytics may start", () => {
  const measurementWindow: () => Record<string, unknown> = (): Record<
    string,
    unknown
  > => {
    return window as unknown as Record<string, unknown>;
  };

  const sendGlobalPrivacyControl: () => void = (): void => {
    Object.defineProperty(window.navigator, "globalPrivacyControl", {
      configurable: true,
      value: true,
    });
  };

  afterEach(() => {
    delete measurementWindow()["oneUptimeProductAnalyticsDisabled"];
    delete measurementWindow()["oneUptimeConsent"];
    delete (window.navigator as unknown as Record<string, unknown>)[
      "globalPrivacyControl"
    ];
    window.localStorage.clear();
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it("starts on an ordinary product page", () => {
    expect(Analytics.isProductAnalyticsAllowed()).toBe(true);
    expect(new Analytics(apiHost, apiKey).isInitialized).toBe(true);
  });

  it("never starts on a page that measures nothing for OneUptime", () => {
    measurementWindow()["oneUptimeProductAnalyticsDisabled"] = true;

    const analytics: Analytics = new Analytics(apiHost, apiKey);

    expect(posthog.init).not.toHaveBeenCalled();
    expect(analytics.isInitialized).toBe(false);

    analytics.capture("Page View: Status Page");
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it('does not start for a visitor who pressed "Reject all"', () => {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, "false");

    expect(new Analytics(apiHost, apiKey).isInitialized).toBe(false);
    expect(posthog.init).not.toHaveBeenCalled();
  });

  it('starts for a visitor who pressed "Accept all"', () => {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, "true");

    expect(new Analytics(apiHost, apiKey).isInitialized).toBe(true);
  });

  it.each([
    ["denied", false],
    ["granted", true],
    ["unset", true],
  ])(
    "asks the page's consent helper when it has one (%s)",
    (state: string, expected: boolean) => {
      // The helper wins over storage: it also knows an answer storage refused.
      window.localStorage.setItem(
        COOKIE_CONSENT_STORAGE_KEY,
        expected ? "false" : "true",
      );
      measurementWindow()["oneUptimeConsent"] = {
        state: (): string => {
          return state;
        },
      };

      expect(Analytics.isProductAnalyticsAllowed()).toBe(expected);
    },
  );

  it("does not start for an unanswered visitor whose browser sends Global Privacy Control", () => {
    sendGlobalPrivacyControl();

    expect(new Analytics(apiHost, apiKey).isInitialized).toBe(false);
  });

  it("lets an acceptance outrank Global Privacy Control", () => {
    sendGlobalPrivacyControl();
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, "true");

    expect(new Analytics(apiHost, apiKey).isInitialized).toBe(true);
  });

  it("treats storage it cannot read as no answer at all", () => {
    jest
      .spyOn(Object.getPrototypeOf(window.localStorage), "getItem")
      .mockImplementation(() => {
        throw new Error("storage disabled");
      });

    expect(Analytics.isProductAnalyticsAllowed()).toBe(true);
  });

  it("uses the storage key the cookie banner writes", () => {
    const partial: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "Server",
        "Views",
        "Partials",
        "AnalyticsConsent.ejs",
      ),
      "utf8",
    );

    expect(partial).toContain(
      `var STORAGE_KEY = '${COOKIE_CONSENT_STORAGE_KEY}';`,
    );
  });
});

/*
 * Sign-up and the dashboard load Google Analytics alone, with no Tag Manager
 * container to read the dataLayer. Analytics sends the funnel's key events to
 * it directly - those, and nothing else, with the agreed parameters only.
 */
describe("Analytics with Google Analytics and no container", () => {
  let gtag: jest.Mock;
  let dataLayer: Array<JSONObject>;

  const measurementWindow: () => Record<string, unknown> = (): Record<
    string,
    unknown
  > => {
    return window as unknown as Record<string, unknown>;
  };

  beforeEach(() => {
    gtag = jest.fn();
    dataLayer = [];
    measurementWindow()["oneUptimeGoogleTagMode"] = "analytics-only";
    measurementWindow()["gtag"] = gtag;
    measurementWindow()["dataLayer"] = dataLayer;
  });

  afterEach(() => {
    delete measurementWindow()["oneUptimeGoogleTagMode"];
    delete measurementWindow()["gtag"];
    delete measurementWindow()["dataLayer"];
    jest.clearAllMocks();
  });

  it("sends a key event with only the agreed parameters", () => {
    const analytics: Analytics = new Analytics(apiHost, apiKey);

    analytics.captureRevenueEvent(RevenueEventName.SubscriptionStarted, {
      funnel_stage: RevenueFunnelStage.Revenue,
      plan: "growth",
      value: 120,
      currency: "USD",
      is_paid_conversion: true,
      project_id: "project-123",
      // Never to Google: who the customer is, and anything not flat.
      email: "owner@example.com",
      company: "Acme",
      seats: { used: 3 },
    });

    expect(gtag).toHaveBeenCalledTimes(1);
    expect(gtag).toHaveBeenCalledWith(
      "event",
      RevenueEventName.SubscriptionStarted,
      {
        funnel_stage: RevenueFunnelStage.Revenue,
        plan: "growth",
        value: 120,
        currency: "USD",
        is_paid_conversion: true,
        project_id: "project-123",
        event_schema_version: REVENUE_EVENT_SCHEMA_VERSION,
      },
    );
  });

  it("sends every key event under its own name", () => {
    const analytics: Analytics = new Analytics(apiHost, apiKey);

    for (const eventName of Object.values(RevenueEventName)) {
      analytics.captureRevenueEvent(eventName, {
        funnel_stage: RevenueFunnelStage.Activation,
      });
    }

    expect(
      gtag.mock.calls.map((call: Array<unknown>) => {
        return call[1];
      }),
    ).toEqual(Object.values(RevenueEventName));
  });

  it("sends Google nothing that is not a key event", () => {
    const analytics: Analytics = new Analytics(apiHost, apiKey);

    analytics.capture("Page View: Project > Home");
    analytics.capture("FORM SUBMIT: Register", { email: "a@example.com" });

    expect(gtag).not.toHaveBeenCalled();
  });

  it("leaves the dataLayer alone, since no container reads it", () => {
    const analytics: Analytics = new Analytics(apiHost, apiKey);

    analytics.capture("dashboard/home");
    analytics.captureRevenueEvent(RevenueEventName.MonitorCreated, {
      funnel_stage: RevenueFunnelStage.Activation,
    });

    expect(dataLayer).toEqual([]);
  });

  it("still gives PostHog every event, under its original name", () => {
    const analytics: Analytics = new Analytics(apiHost, apiKey);

    analytics.capture("Page View: Project > Home");

    expect(posthog.capture).toHaveBeenCalledWith(
      "Page View: Project > Home",
      undefined,
    );
  });

  it("does nothing when the page loaded no tag (a self-hosted install)", () => {
    delete measurementWindow()["gtag"];

    const analytics: Analytics = new Analytics(apiHost, apiKey);

    expect(() => {
      analytics.captureRevenueEvent(RevenueEventName.SignupCompleted, {
        funnel_stage: RevenueFunnelStage.Signup,
      });
    }).not.toThrow();
    expect(dataLayer).toEqual([]);
  });
});

describe("Analytics.toGoogleAnalyticsParameters", () => {
  it("keeps the agreed parameters with plain values", () => {
    expect(
      Analytics.toGoogleAnalyticsParameters({
        value: 0,
        currency: "EUR",
        is_paid_conversion: false,
        booking_kind: "enterprise_demo",
        user_id: "user-1",
      }),
    ).toEqual({
      value: 0,
      currency: "EUR",
      is_paid_conversion: false,
      booking_kind: "enterprise_demo",
    });
  });

  it("drops objects, arrays and nulls even under an agreed name", () => {
    expect(
      Analytics.toGoogleAnalyticsParameters({
        plan: { name: "growth" },
        project_id: ["a", "b"],
        currency: null,
      }),
    ).toEqual({});
  });

  it("is empty for an event with no data", () => {
    expect(Analytics.toGoogleAnalyticsParameters(undefined)).toEqual({});
  });

  /*
   * Docs/analytics/gtm-key-events.json is the container's key event tag. An
   * event has to report the same in Google Analytics whether it went through
   * that tag (the website) or straight to Google Analytics (the product).
   */
  describe("matches the container's key event tag", () => {
    const container: JSONObject = JSON.parse(
      fs.readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "..",
          "..",
          "Docs",
          "analytics",
          "gtm-key-events.json",
        ),
        "utf8",
      ),
    ) as JSONObject;
    const version: JSONObject = container["containerVersion"] as JSONObject;

    it("forwards exactly the same parameters", () => {
      const tag: JSONObject = (version["tag"] as Array<JSONObject>)[0]!;
      const table: JSONObject = (tag["parameter"] as Array<JSONObject>).find(
        (parameter: JSONObject) => {
          return parameter["key"] === "eventSettingsTable";
        },
      )!;
      const forwarded: Array<string> = (table["list"] as Array<JSONObject>).map(
        (row: JSONObject) => {
          return (row["map"] as Array<JSONObject>).find((entry: JSONObject) => {
            return entry["key"] === "parameter";
          })!["value"] as string;
        },
      );

      expect([...forwarded].sort()).toEqual(
        [...GoogleAnalyticsEventParameters].sort(),
      );
    });

    it("treats every revenue event as a key event", () => {
      const trigger: JSONObject = (version["trigger"] as Array<JSONObject>)[0]!;
      const filter: JSONObject = (
        trigger["customEventFilter"] as Array<JSONObject>
      )[0]!;
      const pattern: string = (filter["parameter"] as Array<JSONObject>).find(
        (parameter: JSONObject) => {
          return parameter["key"] === "arg1";
        },
      )!["value"] as string;

      for (const eventName of Object.values(RevenueEventName)) {
        expect([eventName, new RegExp(pattern).test(eventName)]).toEqual([
          eventName,
          true,
        ]);
      }
    });
  });
});

describe("isRevenueEventName", () => {
  it("knows every revenue event", () => {
    for (const eventName of Object.values(RevenueEventName)) {
      expect(isRevenueEventName(eventName)).toBe(true);
    }
  });

  it.each(["Page View: Project > Home", "signup", "SIGN_UP", "", "page_view"])(
    "does not count %j",
    (eventName: string) => {
      expect(isRevenueEventName(eventName)).toBe(false);
    },
  );
});
