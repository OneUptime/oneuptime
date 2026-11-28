import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";
import GlossaryTerm from "../../../Types/Docs/GlossaryTerm";
import {
  COMMON_PRODUCT_EVENT_PROPERTIES,
  ProductEventName,
} from "../../../Types/Analytics/ProductEvent";
import { COOKIE_CONSENT_STORAGE_KEY } from "../../../Types/Analytics/CookieConsent";
import {
  DefinitionOpened,
  DefinitionOpenedTrigger,
} from "../../../UI/Components/Glossary/DefinitionOpened";
import { JSONObject } from "../../../Types/JSON";

jest.mock("posthog-js", () => {
  return {
    __esModule: true,
    default: {
      init: jest.fn(),
      identify: jest.fn(),
      reset: jest.fn(),
      capture: jest.fn(),
    },
  };
});

/*
 * WHAT THE DASHBOARD SENDS WHEN A DEFINITION IS OPENED, AND WHERE (#7019).
 *
 * `glossary/definition_opened` goes the way every Dashboard event goes
 * (Utils/ProductEvents, Utils/Analytics): to product analytics only where
 * ANALYTICS_KEY and ANALYTICS_HOST are set - OneUptime Cloud, never a
 * self-hosted server that did not set them - only for a visitor who has not
 * refused cookies, whose browser sends no Global Privacy Control, and never
 * from a page that measures nothing for OneUptime (a status page, a public
 * dashboard, the admin console). It carries the term, how it was opened and
 * the page as a route with no ids, besides what every event carries -
 * nothing of the person, nothing they wrote.
 *
 * Each case loads the Dashboard's analytics afresh, as a page does, with
 * the server's settings and the browser's answers it starts with: what
 * PostHog would be handed is what the case reads.
 */

interface PostHogMock {
  init: jest.Mock;
  capture: jest.Mock;
}

const postHog: () => PostHogMock = (): PostHogMock => {
  return (jest.requireMock("posthog-js") as { default: PostHogMock }).default;
};

interface LoadedDashboard {
  recordGlossaryDefinitionOpened: (opened: DefinitionOpened) => void;
  whenAnalyticsLoaded: () => Promise<void>;
  setPage: (page: string) => void;
}

const ENVIRONMENT_KEYS: Array<string> = [
  "ANALYTICS_KEY",
  "ANALYTICS_HOST",
  "BILLING_ENABLED",
];

let savedEnvironment: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnvironment = {};

  for (const key of ENVIRONMENT_KEYS) {
    savedEnvironment[key] = process.env[key];
    delete process.env[key];
  }

  postHog().init.mockClear();
  postHog().capture.mockClear();
  window.localStorage.removeItem(COOKIE_CONSENT_STORAGE_KEY);
});

afterEach(() => {
  for (const key of ENVIRONMENT_KEYS) {
    if (savedEnvironment[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnvironment[key];
    }
  }

  window.localStorage.removeItem(COOKIE_CONSENT_STORAGE_KEY);
  delete (window as unknown as Record<string, unknown>)[
    "oneUptimeProductAnalyticsDisabled"
  ];
  Object.defineProperty(window.navigator, "globalPrivacyControl", {
    value: undefined,
    configurable: true,
  });
});

// The Dashboard's analytics, loaded as a page loads them, in this setting.
const loadDashboard: (setting: {
  isAnalyticsSetUp: boolean;
  isCloud?: boolean | undefined;
  consent?: "granted" | "denied" | undefined;
  sendsGlobalPrivacyControl?: boolean | undefined;
  measuresNothing?: boolean | undefined;
}) => LoadedDashboard = (setting: {
  isAnalyticsSetUp: boolean;
  isCloud?: boolean | undefined;
  consent?: "granted" | "denied" | undefined;
  sendsGlobalPrivacyControl?: boolean | undefined;
  measuresNothing?: boolean | undefined;
}): LoadedDashboard => {
  if (setting.isAnalyticsSetUp) {
    process.env["ANALYTICS_KEY"] = "phc_test_key";
    process.env["ANALYTICS_HOST"] = "https://analytics.example.com";
  }

  if (setting.isCloud) {
    process.env["BILLING_ENABLED"] = "true";
  }

  if (setting.consent) {
    window.localStorage.setItem(
      COOKIE_CONSENT_STORAGE_KEY,
      setting.consent === "granted" ? "true" : "false",
    );
  }

  if (setting.sendsGlobalPrivacyControl) {
    Object.defineProperty(window.navigator, "globalPrivacyControl", {
      value: true,
      configurable: true,
    });
  }

  if (setting.measuresNothing) {
    (window as unknown as Record<string, unknown>)[
      "oneUptimeProductAnalyticsDisabled"
    ] = true;
  }

  let loaded: LoadedDashboard | null = null;

  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const events: {
      recordGlossaryDefinitionOpened: (opened: DefinitionOpened) => void;
    } = require("../../../UI/Utils/GlossaryEvents");
    const analytics: { whenPostHogLoaded: () => Promise<void> } =
      require("../../../UI/Utils/Analytics").default;
    const feedback: { setPageResolver: (resolver: () => string) => void } =
      require("../../../UI/Utils/ProductFeedback").default;
    /* eslint-enable @typescript-eslint/no-require-imports */

    loaded = {
      recordGlossaryDefinitionOpened: events.recordGlossaryDefinitionOpened,
      whenAnalyticsLoaded: (): Promise<void> => {
        return analytics.whenPostHogLoaded();
      },
      setPage: (page: string): void => {
        feedback.setPageResolver((): string => {
          return page;
        });
      },
    };
  });

  return loaded!;
};

// Opens Criteria's definition on a monitor's page, as the Dashboard tells it.
const openCriteria: (dashboard: LoadedDashboard) => Promise<void> = async (
  dashboard: LoadedDashboard,
): Promise<void> => {
  dashboard.setPage(
    "/dashboard/64f1c2a7e5b9d3f0a1b2c3d4/monitors/64f1c2a7e5b9d3f0a1b2c3d5/criteria",
  );
  dashboard.recordGlossaryDefinitionOpened({
    term: GlossaryTerm.Criteria,
    trigger: DefinitionOpenedTrigger.Hover,
  });
  await dashboard.whenAnalyticsLoaded();
};

describe("where product analytics is set up, and the visitor allows it", () => {
  test("one event: the term, how it was opened and the page with no ids, beside what every event carries", async () => {
    const dashboard: LoadedDashboard = loadDashboard({
      isAnalyticsSetUp: true,
      isCloud: true,
    });

    await openCriteria(dashboard);

    expect(postHog().capture).toHaveBeenCalledTimes(1);

    const [name, properties] = postHog().capture.mock.calls[0] as [
      string,
      JSONObject,
    ];

    expect(name).toBe(ProductEventName.GlossaryDefinitionOpened);
    expect(name).toBe("glossary/definition_opened");
    expect(properties["term"]).toBe("criteria");
    expect(properties["trigger"]).toBe("hover");
    /*
     * The ids are gone (ProductFeedback.getPage), and the route is a token
     * as feedback/given's page is: ":id" travels as "_id".
     */
    expect(properties["page"]).toBe("/dashboard/_id/monitors/_id/criteria");
    expect(properties["edition"]).toBe("cloud");

    // Nothing but the event's own and the common properties.
    for (const key of Object.keys(properties)) {
      expect([
        "term",
        "trigger",
        "page",
        ...COMMON_PRODUCT_EVENT_PROPERTIES,
      ]).toContain(key);
    }
  });

  test("a visitor who pressed Accept all is measured the same", async () => {
    const dashboard: LoadedDashboard = loadDashboard({
      isAnalyticsSetUp: true,
      isCloud: true,
      consent: "granted",
    });

    await openCriteria(dashboard);

    expect(postHog().capture).toHaveBeenCalledTimes(1);
  });

  test("a term reads as its Glossary anchor, never as the words drawn", async () => {
    const dashboard: LoadedDashboard = loadDashboard({
      isAnalyticsSetUp: true,
      isCloud: true,
    });

    dashboard.recordGlossaryDefinitionOpened({
      term: GlossaryTerm.OnCallPolicy,
      trigger: DefinitionOpenedTrigger.Keyboard,
    });
    await dashboard.whenAnalyticsLoaded();

    const properties: JSONObject = postHog().capture.mock
      .calls[0]![1] as JSONObject;

    expect(properties["term"]).toBe("on-call-policy");
    expect(properties["trigger"]).toBe("keyboard");
  });
});

describe("every opt-out records nothing", () => {
  test.each<[string, Parameters<typeof loadDashboard>[0]]>([
    [
      "a self-hosted server that did not set up product analytics",
      { isAnalyticsSetUp: false },
    ],
    [
      "OneUptime Cloud, for a visitor who pressed Reject all",
      { isAnalyticsSetUp: true, isCloud: true, consent: "denied" },
    ],
    [
      "OneUptime Cloud, for a browser that sends Global Privacy Control",
      { isAnalyticsSetUp: true, isCloud: true, sendsGlobalPrivacyControl: true },
    ],
    [
      "a page that measures nothing for OneUptime",
      { isAnalyticsSetUp: true, isCloud: true, measuresNothing: true },
    ],
  ])("%s", async (_name: string, setting: Parameters<typeof loadDashboard>[0]) => {
    const dashboard: LoadedDashboard = loadDashboard(setting);

    await openCriteria(dashboard);

    expect(postHog().init).not.toHaveBeenCalled();
    expect(postHog().capture).not.toHaveBeenCalled();
  });
});

describe("the Dashboard tells it", () => {
  test("its master page hands every defined term on its pages the listener", () => {
    const masterPage: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Components/MasterPage/MasterPage.tsx",
      ),
      "utf8",
    );

    expect(masterPage).toContain("<DefinitionOpenedContext.Provider");
    expect(masterPage).toMatch(
      /value=\{recordGlossaryDefinitionOpened\}[\s\S]*\{props\.children\}[\s\S]*<\/DefinitionOpenedContext\.Provider>/,
    );
  });
});
