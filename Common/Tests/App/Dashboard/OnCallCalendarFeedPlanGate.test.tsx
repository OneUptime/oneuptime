import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Growth-plan gate on calendar feeds.
 *
 * All three feed models carry @TableBillingAccessControl(Growth), and the
 * public render path checks the plan again per project: a below-plan project
 * is served an EMPTY calendar (decision 1.3), never a 404. Without a
 * client-side gate the dashboard cheerfully mints a link that can never show
 * a shift, and the settings card answers a save with a bare 402.
 *
 * What these tests pin:
 *   - on a below-plan Cloud project, Generate / Publish are replaced by an
 *     upgrade notice that links to Billing, and the settings card is gone;
 *   - a sufficient plan, an unknown plan and a self-hosted install (billing
 *     disabled) all leave the surfaces exactly as they were - the gate FAILS
 *     OPEN, because hiding the feature from somebody entitled to it is the
 *     worse mistake.
 */

let billingEnabledForTest: boolean = false;
let currentPlanForTest: string | null = null;

const getMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

const PLAN_ENV: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,priceMonthlyId,priceYearlyId,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH: "Growth,priceMonthlyId2,priceYearlyId2,0,0,2,14",
  SUBSCRIPTION_PLAN_SCALE: "Scale,priceMonthlyId3,priceYearlyId3,0,0,3,0",
};

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return billingEnabledForTest;
    },
  });

  mocked["getAllEnvVars"] = (): Record<string, string> => {
    return PLAN_ENV;
  };

  return mocked;
});

jest.mock("../../../UI/Utils/Project", () => {
  const actual: Record<string, any> = jest.requireActual(
    "../../../UI/Utils/Project",
  ) as Record<string, any>;

  return {
    __esModule: true,
    ...actual,
    default: {
      ...actual["default"],
      getCurrentPlan: (): string | null => {
        return currentPlanForTest;
      },
      getCurrentProjectId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<any>) => {
        return getMock(...args);
      },
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown): string => {
        if (
          error &&
          typeof error === "object" &&
          "message" in (error as Record<string, unknown>)
        ) {
          return String((error as Record<string, unknown>)["message"]);
        }

        return "Something went wrong";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
      updateById: async (): Promise<void> => {
        return undefined;
      },
      deleteItem: async (): Promise<void> => {
        return undefined;
      },
      getList: async (): Promise<Record<string, unknown>> => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      },
    },
  };
});

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (): unknown => {
      return React.createElement("div", {
        "data-testid": "card-model-detail-stub",
      });
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return true;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return [];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: [] };
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

import ObjectID from "../../../Types/ObjectID";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import { isCalendarFeedAccessibleOnCurrentPlan } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/CalendarFeedPlanGate";
import PersonalCalendarFeedCard, {
  PersonalCalendarFeedVariant,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/PersonalCalendarFeedCard";
import SharedCalendarFeedCard, {
  SharedCalendarFeedKind,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/SharedCalendarFeedCard";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const FEED_ID: string = "11111111-1111-4111-8111-111111111111";
const SCHEDULE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const NOW: Date = new Date("2026-08-31T12:00:00.000Z");

const HTTPS_URL: string =
  "https://oneuptime.example.com/api/on-call-calendar/user/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG/shifts.ics";

const EMPTY_STATUS_JSON: JSONObject = {
  exists: false,
  feedId: null,
  isEnabled: false,
  needsRegeneration: false,
  tokenHint: null,
  rotatedAt: null,
  previousTokenExpiresAt: null,
  lastFetchedAt: null,
  lastFetchedClient: null,
  fetchCount: 0,
  lastRenderTruncated: false,
  settings: { pastDays: 2, futureDays: 90 },
  urls: null,
  hostWarning: null,
  protocolWarning: null,
};

const ACTIVE_STATUS_JSON: JSONObject = {
  ...EMPTY_STATUS_JSON,
  exists: true,
  feedId: FEED_ID,
  isEnabled: true,
  tokenHint: "k3Qx",
  rotatedAt: "2026-08-01T10:00:00.000Z",
  urls: {
    https: HTTPS_URL,
    webcal: HTTPS_URL.replace("https:", "webcals:"),
    googleAdd: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(HTTPS_URL)}`,
  },
};

type OkFunction = (json: JSONObject) => HTTPResponse<JSONObject>;

const ok: OkFunction = (json: JSONObject): HTTPResponse<JSONObject> => {
  return new HTTPResponse<JSONObject>(200, json, {});
};

function goToCalendarFeedPage(): void {
  window.history.pushState(
    {},
    "",
    `/dashboard/${PROJECT_ID}/user-settings/calendar-feed`,
  );
}

describe("isCalendarFeedAccessibleOnCurrentPlan", () => {
  afterEach(() => {
    billingEnabledForTest = false;
    currentPlanForTest = null;
  });

  test("a self-hosted install (billing disabled) is always accessible", () => {
    billingEnabledForTest = false;
    currentPlanForTest = "Free";

    expect(isCalendarFeedAccessibleOnCurrentPlan()).toBe(true);
  });

  test("an unknown plan fails open rather than hiding the feature", () => {
    billingEnabledForTest = true;
    currentPlanForTest = null;

    expect(isCalendarFeedAccessibleOnCurrentPlan()).toBe(true);
  });

  test("a plan name the environment does not describe fails open instead of throwing", () => {
    billingEnabledForTest = true;
    currentPlanForTest = "NoSuchPlan";

    expect(isCalendarFeedAccessibleOnCurrentPlan()).toBe(true);
  });

  test("Growth and above are accessible, below-Growth is not", () => {
    billingEnabledForTest = true;

    currentPlanForTest = "Free";
    expect(isCalendarFeedAccessibleOnCurrentPlan()).toBe(false);

    currentPlanForTest = "Growth";
    expect(isCalendarFeedAccessibleOnCurrentPlan()).toBe(true);

    currentPlanForTest = "Scale";
    expect(isCalendarFeedAccessibleOnCurrentPlan()).toBe(true);
  });
});

describe("PersonalCalendarFeedCard below the plan", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    goToCalendarFeedPage();
    billingEnabledForTest = true;
    currentPlanForTest = "Free";
  });

  afterEach(() => {
    cleanup();
    billingEnabledForTest = false;
    currentPlanForTest = null;
  });

  test("Generate is replaced by an upgrade notice pointing at Billing", async () => {
    getMock.mockResolvedValue(ok(EMPTY_STATUS_JSON));

    render(
      <PersonalCalendarFeedCard
        variant={PersonalCalendarFeedVariant.Full}
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("personal-calendar-feed-empty"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByTestId("personal-calendar-feed-plan-gate"),
    ).toHaveTextContent("Calendar feeds require the Growth plan");
    // The button that would mint a permanently-empty link is not offered.
    expect(
      screen.queryByTestId("personal-calendar-feed-generate"),
    ).not.toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();

    const billingRoute: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.SETTINGS_BILLING] as Route,
    );
    expect(
      screen.getByText("Upgrade your plan in Billing settings").closest("a"),
    ).toHaveAttribute("href", billingRoute.toString());
  });

  test("an existing (downgraded) feed explains itself and hides the settings card", async () => {
    getMock.mockResolvedValue(ok(ACTIVE_STATUS_JSON));

    render(
      <PersonalCalendarFeedCard
        variant={PersonalCalendarFeedVariant.Full}
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("personal-calendar-feed-active"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByTestId("personal-calendar-feed-plan-gate"),
    ).toBeInTheDocument();
    /*
     * The settings PUT is Growth-gated too, so the form would answer every
     * save with a 402. Hidden rather than shown-and-broken.
     */
    expect(
      screen.queryByTestId("card-model-detail-stub"),
    ).not.toBeInTheDocument();
  });

  test("on a sufficient plan nothing changes: Generate and the settings card are there", async () => {
    currentPlanForTest = "Growth";
    getMock.mockResolvedValue(ok(ACTIVE_STATUS_JSON));

    render(
      <PersonalCalendarFeedCard
        variant={PersonalCalendarFeedVariant.Full}
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("personal-calendar-feed-active"),
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByTestId("personal-calendar-feed-plan-gate"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("card-model-detail-stub")).toBeInTheDocument();
  });

  test("a self-hosted install never sees the gate, whatever plan string is around", async () => {
    billingEnabledForTest = false;
    getMock.mockResolvedValue(ok(EMPTY_STATUS_JSON));

    render(
      <PersonalCalendarFeedCard
        variant={PersonalCalendarFeedVariant.Full}
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("personal-calendar-feed-generate"),
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByTestId("personal-calendar-feed-plan-gate"),
    ).not.toBeInTheDocument();
  });
});

describe("SharedCalendarFeedCard below the plan", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    goToCalendarFeedPage();
    billingEnabledForTest = true;
    currentPlanForTest = "Free";
  });

  afterEach(() => {
    cleanup();
    billingEnabledForTest = false;
    currentPlanForTest = null;
  });

  test("Publish is replaced by the upgrade notice, even for a project admin", async () => {
    getMock.mockResolvedValue(ok(EMPTY_STATUS_JSON));

    render(
      <SharedCalendarFeedCard
        kind={SharedCalendarFeedKind.Schedule}
        scheduleId={SCHEDULE_ID}
        scheduleTimezone="Europe/Stockholm"
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("schedule-shared-calendar-feed-empty"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByTestId("schedule-shared-calendar-feed-plan-gate"),
    ).toHaveTextContent("Calendar feeds require the Growth plan");
    expect(
      screen.queryByTestId("schedule-shared-calendar-feed-publish"),
    ).not.toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  /*
   * The status read itself is Growth-gated, so on a below-plan project the
   * card's own load() 402s and `status` stays null. Relaying the server's
   * sentence with no way to act on it is what the gate replaces.
   */
  test("a 402 on the status read renders the upgrade notice, not a bare server error", async () => {
    getMock.mockRejectedValue(
      new Error("Please upgrade your plan to Growth to access this feature"),
    );

    render(
      <SharedCalendarFeedCard
        kind={SharedCalendarFeedKind.Project}
        now={NOW}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("project-shared-calendar-feed-plan-gate"),
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByText(
        "Please upgrade your plan to Growth to access this feature",
      ),
    ).not.toBeInTheDocument();
  });
});
