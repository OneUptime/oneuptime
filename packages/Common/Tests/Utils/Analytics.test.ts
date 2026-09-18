import Email from "../../Types/Email";
import { JSONObject } from "../../Types/JSON";
import Analytics from "../../Utils/Analytics";
import { describe, expect, it } from "@jest/globals";
import posthog from "posthog-js";
import {
  REVENUE_EVENT_SCHEMA_VERSION,
  RevenueEventName,
  RevenueFunnelStage,
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
