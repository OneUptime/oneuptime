import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement, ReactNode } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * The Billing page of a project a cloud marketplace bills: it says which
 * marketplace bills it, and shows what the last three months of that bill
 * were made of (Marketplace Usage). It asks for no card: there are no
 * payment methods to list.
 *
 * The real page; ModelAPI, API, the plan editor, the payment methods table
 * and Stripe are test boundaries, as in BillingPlanCutoff.test.tsx.
 */

const getListMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const apiGetMock: MockFunction = getJestMockFunction();

const CLOUD_PLAN_ENV: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,price_free_month,price_free_year,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_growth_month,price_growth_year,22,20,2,14",
};

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      count: (...args: Array<unknown>) => {
        return countMock(...args);
      },
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<unknown>) => {
        return apiGetMock(...args);
      },
      post: async () => {
        return { data: {} };
      },
      getFriendlyMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Analytics", () => {
  return {
    __esModule: true,
    default: {
      capture: () => {},
      captureRevenueEvent: () => {},
      capturePurchase: () => {},
    },
  };
});

jest.mock("../../../UI/Config", () => {
  const config: Record<string, unknown> = {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
  };
  Object.defineProperty(config, "BILLING_ENABLED", {
    get: () => {
      return true;
    },
  });
  config["getAllEnvVars"] = (): Record<string, string> => {
    return CLOUD_PLAN_ENV;
  };
  return config;
});

jest.mock(
  "@stripe/stripe-js/pure",
  () => {
    return {
      loadStripe: async () => {
        return {};
      },
    };
  },
  { virtual: true },
);

jest.mock(
  "@stripe/react-stripe-js",
  () => {
    return {
      Elements: (props: { children: ReactNode }) => {
        return <>{props.children}</>;
      },
      PaymentElement: () => {
        return <div>Payment details</div>;
      },
      useStripe: () => {
        return {};
      },
      useElements: () => {
        return {};
      },
    };
  },
  { virtual: true },
);

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: { cardProps: { title: string } }): ReactElement => {
      return <section aria-label={props.cardProps.title} />;
    },
  };
});

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: () => {
      return <div data-testid="payment-methods-table" />;
    },
  };
});

import Billing from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/Billing";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import { MARKETPLACE_USAGE_ROUTE } from "../../../Types/Marketplace/MarketplaceUsageSummary";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "81000000-0000-4000-8000-000000000002",
);

async function renderBilling(billingMarketplace: string | null): Promise<void> {
  getItemMock.mockResolvedValue({
    paymentProviderPlanId: "price_growth_month",
    ...(billingMarketplace ? { billingMarketplace } : {}),
  });

  await act(async () => {
    render(
      <Billing
        pageRoute={new Route("/settings/billing")}
        currentProject={null}
        hasPaymentMethod={false}
      />,
    );
  });

  await act(async () => {
    for (let i: number = 0; i < 20; i++) {
      await Promise.resolve();
    }
  });
}

function usageRequests(): Array<unknown> {
  return apiGetMock.mock.calls.filter((call: Array<unknown>): boolean => {
    return (call[0] as { url: URL }).url
      .toString()
      .includes(MARKETPLACE_USAGE_ROUTE);
  });
}

beforeEach(() => {
  getListMock.mockReset().mockResolvedValue({ data: [], count: 0 });
  countMock.mockReset().mockResolvedValue(0);
  getItemMock.mockReset();
  apiGetMock.mockReset().mockImplementation(async (request: unknown) => {
    const url: string = (request as { url: URL }).url.toString();

    if (url.includes(MARKETPLACE_USAGE_ROUTE)) {
      return new HTTPResponse<JSONObject>(
        200,
        {
          marketplace: "AWS",
          usageUnitInUSD: 0.01,
          months: [
            {
              month: "2026-10",
              billedUnits: 2200,
              pendingUnits: 0,
              usersInUSD: 22,
              activeMonitorsInUSD: 0,
              telemetryInUSD: 0,
              smsOrCallBalanceInUSD: 0,
              aiBalanceInUSD: 0,
            },
          ] as unknown as JSONObject,
        },
        {},
      );
    }

    return new HTTPResponse<JSONObject>(200, { balance: 0 }, {});
  });

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  getJestSpyOn(Navigation, "getCurrentURL").mockReturnValue(
    URL.fromString("https://example.com/dashboard/project/settings/billing"),
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a project a cloud marketplace bills", () => {
  it("says which marketplace bills it, and what its bill was made of", async () => {
    await renderBilling("AWS");

    expect(
      screen.getByText("Billed through AWS Marketplace"),
    ).toBeInTheDocument();
    expect(await screen.findByText("Marketplace Usage")).toBeInTheDocument();
    expect(
      await screen.findByTestId("marketplace-usage-table"),
    ).toBeInTheDocument();
    expect(screen.getByText("$22.00", { selector: "div" })).toBeInTheDocument();

    expect(usageRequests()).toHaveLength(1);
    // No card: no payment methods to list.
    expect(screen.queryByTestId("payment-methods-table")).toBeNull();
  });
});

describe("a project billed by card", () => {
  it("shows no marketplace usage, and asks for none", async () => {
    await renderBilling(null);

    expect(screen.queryByText("Marketplace Usage")).toBeNull();
    expect(usageRequests()).toHaveLength(0);
  });
});
