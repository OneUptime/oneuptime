import Email from "../../Types/Email";
import { JSONObject } from "../../Types/JSON";
import Analytics, {
  COOKIE_CONSENT_STORAGE_KEY,
  PostHogClient,
  PostHogLoader,
  PurchaseData,
} from "../../Utils/Analytics";
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

  it("should initialize the Analytics class", async () => {
    const analytics: Analytics = new Analytics(apiHost, apiKey);

    expect(analytics.isInitialized).toBe(true);

    await analytics.whenPostHogLoaded();

    expect(posthog.init).toHaveBeenCalledWith(apiKey, {
      api_host: apiHost,
      autocapture: false,
    });
    expect(analytics.isInitialized).toBe(true);
  });

  it("should not initialize if apiHost and apiKey are not provided", async () => {
    const analytics: Analytics = new Analytics("", "");

    await analytics.whenPostHogLoaded();

    expect(posthog.init).not.toHaveBeenCalled();
    expect(analytics.isInitialized).toBe(false);
  });

  it("should authenticate a user", async () => {
    const analytics: Analytics = new Analytics(apiHost, apiKey);
    const email: Email = new Email("test@example.com");

    analytics.userAuth(email);
    await analytics.whenPostHogLoaded();
    expect(posthog.identify).toHaveBeenCalledWith(email.toString());
  });

  it("should not authenticate a user if not initialized", async () => {
    const analytics: Analytics = new Analytics("", "");
    const email: Email = new Email("test@example.com");

    analytics.userAuth(email);
    await analytics.whenPostHogLoaded();
    expect(posthog.identify).not.toHaveBeenCalled();
  });

  it("should reset the user session on logout", async () => {
    const analytics: Analytics = new Analytics(apiHost, apiKey);

    analytics.logout();
    await analytics.whenPostHogLoaded();
    expect(posthog.reset).toHaveBeenCalled();
  });

  it("should not reset the user session if not initialized", async () => {
    const analytics: Analytics = new Analytics("", "");

    analytics.logout();
    await analytics.whenPostHogLoaded();
    expect(posthog.reset).not.toHaveBeenCalled();
  });

  it("should capture an event with optional data", async () => {
    const analytics: Analytics = new Analytics(apiHost, apiKey);
    const eventName: string = "testEvent";
    const data: JSONObject = { key: "value" };

    analytics.capture(eventName, data);
    await analytics.whenPostHogLoaded();
    expect(posthog.capture).toHaveBeenCalledWith(eventName, data);
  });

  it("should capture a versioned revenue event", async () => {
    const analytics: Analytics = new Analytics(apiHost, apiKey);

    analytics.captureRevenueEvent(RevenueEventName.WorkspaceCreated, {
      funnel_stage: RevenueFunnelStage.Activation,
      project_id: "project-123",
    });

    await analytics.whenPostHogLoaded();
    expect(posthog.capture).toHaveBeenCalledWith(
      RevenueEventName.WorkspaceCreated,
      {
        funnel_stage: RevenueFunnelStage.Activation,
        project_id: "project-123",
        event_schema_version: REVENUE_EVENT_SCHEMA_VERSION,
      },
    );
  });

  it("should not capture an event if not initialized", async () => {
    const analytics: Analytics = new Analytics("", "");

    analytics.capture("testEvent");
    await analytics.whenPostHogLoaded();
    expect(posthog.capture).not.toHaveBeenCalled();
  });
});

/*
 * PostHog is loaded with import() once analytics starts (issue #5619). It
 * used to be a static import: about 160 KB of script every page, the sign-in
 * page among them, downloaded and parsed before it could draw. What a page
 * asks of PostHog before it arrives waits for it, and reaches it in order,
 * after init.
 */
describe("PostHog, loaded once analytics starts", () => {
  type Call = Array<unknown>;

  interface ControlledLoad {
    loadPostHog: PostHogLoader;
    // How many times the page asked for posthog-js.
    loads: () => number;
    arrive: (client: PostHogClient) => Promise<void>;
    fail: () => Promise<void>;
  }

  // A PostHog that writes down every call made to it, init included.
  const recordingPostHog: (
    calls: Array<Call>,
    overrides?: Partial<Record<keyof PostHogClient, () => void>>,
  ) => PostHogClient = (
    calls: Array<Call>,
    overrides?: Partial<Record<keyof PostHogClient, () => void>>,
  ): PostHogClient => {
    const record: (name: keyof PostHogClient) => (...args: Call) => void = (
      name: keyof PostHogClient,
    ): ((...args: Call) => void) => {
      return (...args: Call): void => {
        calls.push([name, ...args]);
        overrides?.[name]?.();
      };
    };

    return {
      init: record("init"),
      identify: record("identify"),
      reset: record("reset"),
      capture: record("capture"),
    } as unknown as PostHogClient;
  };

  // posthog-js arriving when the test says, as a slow network would have it.
  const controlledLoad: () => ControlledLoad = (): ControlledLoad => {
    let count: number = 0;
    let resolveLoad: (client: PostHogClient) => void = (): void => {};
    let rejectLoad: (error: Error) => void = (): void => {};
    const loaded: Promise<PostHogClient> = new Promise(
      (
        resolve: (client: PostHogClient) => void,
        reject: (error: Error) => void,
      ) => {
        resolveLoad = resolve;
        rejectLoad = reject;
      },
    );

    return {
      loadPostHog: (): Promise<PostHogClient> => {
        count++;
        return loaded;
      },
      loads: (): number => {
        return count;
      },
      arrive: async (client: PostHogClient): Promise<void> => {
        resolveLoad(client);
        await loaded;
      },
      fail: async (): Promise<void> => {
        rejectLoad(new Error("Blocked by the browser"));
        await loaded.catch((): void => {});
      },
    };
  };

  afterEach(() => {
    delete (window as any).dataLayer;
    jest.clearAllMocks();
  });

  it("fetches posthog-js once, as analytics starts", () => {
    const load: ControlledLoad = controlledLoad();
    const analytics: Analytics = new Analytics(
      apiHost,
      apiKey,
      load.loadPostHog,
    );

    analytics.capture("accounts/login");
    analytics.userAuth(new Email("test@example.com"));

    expect(load.loads()).toBe(1);
    expect(analytics.isInitialized).toBe(true);
  });

  it("holds what the page asks before PostHog arrives, and hands it over in order after init", async () => {
    const load: ControlledLoad = controlledLoad();
    const analytics: Analytics = new Analytics(
      apiHost,
      apiKey,
      load.loadPostHog,
    );
    const calls: Array<Call> = [];

    analytics.capture("accounts/login", { method: "password" });
    analytics.userAuth(new Email("test@example.com"));
    analytics.capture("FORM SUBMIT: Login");
    analytics.logout();

    expect(calls).toEqual([]);

    await load.arrive(recordingPostHog(calls));
    await analytics.whenPostHogLoaded();

    expect(calls).toEqual([
      ["init", apiKey, { api_host: apiHost, autocapture: false }],
      ["capture", "accounts/login", { method: "password" }],
      ["identify", "test@example.com"],
      ["capture", "FORM SUBMIT: Login", undefined],
      ["reset"],
    ]);
  });

  it("hands what it asks later straight to PostHog", async () => {
    const load: ControlledLoad = controlledLoad();
    const analytics: Analytics = new Analytics(
      apiHost,
      apiKey,
      load.loadPostHog,
    );
    const calls: Array<Call> = [];

    await load.arrive(recordingPostHog(calls));
    await analytics.whenPostHogLoaded();

    analytics.capture("dashboard/home");

    // Synchronously: nothing waits once PostHog is there.
    expect(calls).toEqual([
      ["init", apiKey, { api_host: apiHost, autocapture: false }],
      ["capture", "dashboard/home", undefined],
    ]);
  });

  it("sends an event's properties as they were when it happened", async () => {
    const load: ControlledLoad = controlledLoad();
    const analytics: Analytics = new Analytics(
      apiHost,
      apiKey,
      load.loadPostHog,
    );
    const calls: Array<Call> = [];
    const data: JSONObject = { plan_name: "growth" };

    analytics.capture("dashboard/billing/plan-changed", data);
    data["plan_name"] = "scale";

    await load.arrive(recordingPostHog(calls));
    await analytics.whenPostHogLoaded();

    expect(calls[1]).toEqual([
      "capture",
      "dashboard/billing/plan-changed",
      { plan_name: "growth" },
    ]);
  });

  it("keeps handing over what waited after a call PostHog refuses", async () => {
    const load: ControlledLoad = controlledLoad();
    const analytics: Analytics = new Analytics(
      apiHost,
      apiKey,
      load.loadPostHog,
    );
    const calls: Array<Call> = [];

    analytics.userAuth(new Email("test@example.com"));
    analytics.capture("accounts/login");

    await load.arrive(
      recordingPostHog(calls, {
        identify: (): void => {
          throw new Error("PostHog refused the call");
        },
      }),
    );
    await expect(analytics.whenPostHogLoaded()).resolves.toBeUndefined();

    expect(calls.slice(1)).toEqual([
      ["identify", "test@example.com"],
      ["capture", "accounts/login", undefined],
    ]);
  });

  it("measures nothing, and lets what waited go, when posthog-js cannot load", async () => {
    const load: ControlledLoad = controlledLoad();
    const analytics: Analytics = new Analytics(
      apiHost,
      apiKey,
      load.loadPostHog,
    );

    analytics.capture("accounts/login");

    await load.fail();
    // Settles rather than rejects: nothing waits on it with a catch.
    await expect(analytics.whenPostHogLoaded()).resolves.toBeUndefined();

    expect(analytics.isInitialized).toBe(false);
    expect(() => {
      analytics.capture("dashboard/home");
      analytics.userAuth(new Email("test@example.com"));
      analytics.logout();
    }).not.toThrow();
    // Nothing is fetched again, and nothing is called on the mocked module.
    expect(load.loads()).toBe(1);
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it("does not hold Google's events back while PostHog loads", () => {
    const dataLayer: Array<JSONObject> = [];
    (window as any).dataLayer = dataLayer;
    const load: ControlledLoad = controlledLoad();
    const analytics: Analytics = new Analytics(
      apiHost,
      apiKey,
      load.loadPostHog,
    );

    analytics.capture("accounts/login");

    expect(dataLayer).toEqual([
      {
        event: "accounts_login",
        eventCategory: "analytics",
        eventAction: "accounts/login",
      },
    ]);
  });

  it("is loaded at once where analytics never starts", async () => {
    const load: ControlledLoad = controlledLoad();
    const analytics: Analytics = new Analytics("", "", load.loadPostHog);

    await expect(analytics.whenPostHogLoaded()).resolves.toBeUndefined();
    expect(load.loads()).toBe(0);
  });

  it("loads the real posthog-js module by default", async () => {
    const analytics: Analytics = new Analytics(apiHost, apiKey);

    analytics.capture("accounts/register");

    expect(posthog.capture).not.toHaveBeenCalled();

    await analytics.whenPostHogLoaded();

    expect(posthog.init).toHaveBeenCalledTimes(1);
    expect(posthog.capture).toHaveBeenCalledWith(
      "accounts/register",
      undefined,
    );
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

  it("pushes a normalised event name while PostHog keeps the original", async () => {
    const analytics: Analytics = new Analytics(apiHost, apiKey);

    analytics.capture("Page View: Project > Home");

    await analytics.whenPostHogLoaded();
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

  it("pushes to the dataLayer even when PostHog is not initialized", async () => {
    const analytics: Analytics = new Analytics("", "");

    analytics.capture("FORM SUBMIT: Register");

    await analytics.whenPostHogLoaded();
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

  it("does not throw when window.dataLayer is not defined", async () => {
    delete (window as any).dataLayer;

    const analytics: Analytics = new Analytics(apiHost, apiKey);

    expect(() => {
      analytics.capture("accounts/login");
    }).not.toThrow();
    await analytics.whenPostHogLoaded();
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

  it("never starts on a page that measures nothing for OneUptime", async () => {
    measurementWindow()["oneUptimeProductAnalyticsDisabled"] = true;

    const loadPostHog: ReturnType<typeof jest.fn> = jest.fn();
    const analytics: Analytics = new Analytics(
      apiHost,
      apiKey,
      loadPostHog as unknown as PostHogLoader,
    );

    expect(analytics.isInitialized).toBe(false);

    analytics.capture("Page View: Status Page");
    await analytics.whenPostHogLoaded();

    // Not even downloaded: a status page carries no PostHog at all.
    expect(loadPostHog).not.toHaveBeenCalled();
    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it('does not start for a visitor who pressed "Reject all"', async () => {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, "false");

    const loadPostHog: ReturnType<typeof jest.fn> = jest.fn();
    const analytics: Analytics = new Analytics(
      apiHost,
      apiKey,
      loadPostHog as unknown as PostHogLoader,
    );

    await analytics.whenPostHogLoaded();

    expect(analytics.isInitialized).toBe(false);
    expect(loadPostHog).not.toHaveBeenCalled();
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

  it("still gives PostHog every event, under its original name", async () => {
    const analytics: Analytics = new Analytics(apiHost, apiKey);

    analytics.capture("Page View: Project > Home");

    await analytics.whenPostHogLoaded();
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

/*
 * Google Analytics' user_id and purchase, both sent only where the page loaded
 * Google Analytics itself (sign-up and the dashboard).
 */
describe("Analytics' user_id and purchase for Google Analytics", () => {
  let gtag: jest.Mock;

  const measurementWindow: () => Record<string, unknown> = (): Record<
    string,
    unknown
  > => {
    return window as unknown as Record<string, unknown>;
  };

  const PURCHASE: PurchaseData = {
    transactionId: "subscription_started:project-1",
    value: 49,
    currency: "USD",
    plan: "Growth",
  };

  beforeEach(() => {
    gtag = jest.fn();
    measurementWindow()["oneUptimeGoogleTagMode"] = "analytics-only";
    measurementWindow()["gtag"] = gtag;
  });

  afterEach(() => {
    delete measurementWindow()["oneUptimeGoogleTagMode"];
    delete measurementWindow()["gtag"];
    jest.clearAllMocks();
  });

  describe("setGoogleAnalyticsUserId", () => {
    it("sets user_id to the internal user ID", () => {
      new Analytics(apiHost, apiKey).setGoogleAnalyticsUserId("user-123");

      expect(gtag).toHaveBeenCalledTimes(1);
      expect(gtag).toHaveBeenCalledWith("set", { user_id: "user-123" });
    });

    it("sets nothing for an empty ID", () => {
      new Analytics(apiHost, apiKey).setGoogleAnalyticsUserId("");

      expect(gtag).not.toHaveBeenCalled();
    });

    it("sets nothing on a page that loads the Tag Manager container instead", () => {
      measurementWindow()["oneUptimeGoogleTagMode"] = "tag-manager";

      new Analytics(apiHost, apiKey).setGoogleAnalyticsUserId("user-123");

      expect(gtag).not.toHaveBeenCalled();
    });

    it("does nothing where no Google tag was loaded (a self-hosted install)", () => {
      delete measurementWindow()["gtag"];

      expect(() => {
        new Analytics(apiHost, apiKey).setGoogleAnalyticsUserId("user-123");
      }).not.toThrow();
    });

    it("never hands PostHog the ID", () => {
      new Analytics(apiHost, apiKey).setGoogleAnalyticsUserId("user-123");

      expect(posthog.identify).not.toHaveBeenCalled();
      expect(posthog.capture).not.toHaveBeenCalled();
    });
  });

  describe("capturePurchase", () => {
    it("sends GA4's purchase event with its transaction, value, currency and plan", () => {
      new Analytics(apiHost, apiKey).capturePurchase(PURCHASE);

      expect(gtag).toHaveBeenCalledTimes(1);
      expect(gtag).toHaveBeenCalledWith("event", "purchase", {
        transaction_id: "subscription_started:project-1",
        value: 49,
        currency: "USD",
        items: [
          {
            item_id: "Growth",
            item_name: "Growth",
            price: 49,
            quantity: 1,
          },
        ],
      });
    });

    it("leaves PostHog to the subscription event it already has", () => {
      new Analytics(apiHost, apiKey).capturePurchase(PURCHASE);

      expect(posthog.capture).not.toHaveBeenCalled();
    });

    it("sends nothing on a page that loads the Tag Manager container instead", () => {
      measurementWindow()["oneUptimeGoogleTagMode"] = "tag-manager";

      new Analytics(apiHost, apiKey).capturePurchase(PURCHASE);

      expect(gtag).not.toHaveBeenCalled();
    });

    it("does nothing where no Google tag was loaded (a self-hosted install)", () => {
      delete measurementWindow()["gtag"];

      expect(() => {
        new Analytics(apiHost, apiKey).capturePurchase(PURCHASE);
      }).not.toThrow();
    });
  });

  describe("purchaseForNewProject", () => {
    it("uses the server's event ID for the same conversion", () => {
      expect(
        Analytics.purchaseForNewProject({
          projectId: "project-1",
          planName: "Growth",
          monthlyAmountInUSD: 49,
          isOnFreeTrial: false,
        }),
      ).toEqual(PURCHASE);
    });

    it("is none on a free trial: no card was asked for, and nothing was bought", () => {
      expect(
        Analytics.purchaseForNewProject({
          projectId: "project-1",
          planName: "Growth",
          monthlyAmountInUSD: 49,
          isOnFreeTrial: true,
        }),
      ).toBeNull();
    });

    it("is none for custom pricing, which has no amount", () => {
      expect(
        Analytics.purchaseForNewProject({
          projectId: "project-1",
          planName: "Enterprise",
          monthlyAmountInUSD: null,
          isOnFreeTrial: false,
        }),
      ).toBeNull();
    });

    it("is none without a project ID to name it by", () => {
      expect(
        Analytics.purchaseForNewProject({
          projectId: "",
          planName: "Growth",
          monthlyAmountInUSD: 49,
          isOnFreeTrial: false,
        }),
      ).toBeNull();
    });
  });

  describe("purchaseForPlanChange", () => {
    const CHANGED_AT: Date = new Date("2026-10-13T09:30:00.000Z");

    it("is a free project becoming a paying one, valued at the new MRR", () => {
      expect(
        Analytics.purchaseForPlanChange({
          projectId: "project-1",
          planName: "Scale",
          isPaidConversion: true,
          monthlyAmountInUSD: 99,
          seats: 10,
          changedAt: CHANGED_AT,
        }),
      ).toEqual({
        transactionId:
          "subscription_upgraded:project-1:2026-10-13T09:30:00.000Z",
        value: 990,
        currency: "USD",
        plan: "Scale",
      });
    });

    it("tells two upgrades of one project apart", () => {
      const first: PurchaseData | null = Analytics.purchaseForPlanChange({
        projectId: "project-1",
        planName: "Growth",
        isPaidConversion: true,
        monthlyAmountInUSD: 22,
        seats: 1,
        changedAt: CHANGED_AT,
      });
      const second: PurchaseData | null = Analytics.purchaseForPlanChange({
        projectId: "project-1",
        planName: "Growth",
        isPaidConversion: true,
        monthlyAmountInUSD: 22,
        seats: 1,
        changedAt: new Date("2026-11-02T10:00:00.000Z"),
      });

      expect(first?.transactionId).not.toBe(second?.transactionId);
    });

    it("is none for a move between paid tiers, which is expansion", () => {
      expect(
        Analytics.purchaseForPlanChange({
          projectId: "project-1",
          planName: "Scale",
          isPaidConversion: false,
          monthlyAmountInUSD: 99,
          seats: 10,
          changedAt: CHANGED_AT,
        }),
      ).toBeNull();
    });

    it("is none for custom pricing, which has no amount", () => {
      expect(
        Analytics.purchaseForPlanChange({
          projectId: "project-1",
          planName: "Enterprise",
          isPaidConversion: true,
          monthlyAmountInUSD: null,
          seats: 10,
          changedAt: CHANGED_AT,
        }),
      ).toBeNull();
    });

    it("keeps transaction IDs within GA4's 100-character parameter limit", () => {
      const purchase: PurchaseData | null = Analytics.purchaseForPlanChange({
        projectId: "0195f2c1-7a4e-7c3b-9f0e-2d8a6b5c4e3f",
        planName: "Scale",
        isPaidConversion: true,
        monthlyAmountInUSD: 99,
        seats: 1,
        changedAt: CHANGED_AT,
      });

      expect(purchase?.transactionId.length).toBeLessThanOrEqual(100);
    });
  });
});
