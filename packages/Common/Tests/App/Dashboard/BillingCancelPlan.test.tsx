import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
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
 * The Billing page's Cancel Plan card (#9129). It used to say "If you would
 * like to cancel the plan, you need to delete the project." beside a red
 * Delete Project button, so somebody who only wanted to stop paying for
 * seats was sent to lose everything. It now moves the project to the Free
 * plan, which keeps everything, after one question that says what stops and
 * what Free still bills, and offers support.
 *
 * The real page; ModelAPI, API, the plan editor, the payment methods table
 * and Stripe are test boundaries, as in BillingMarketplaceProject.test.tsx.
 */

const getListMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const apiGetMock: MockFunction = getJestMockFunction();
const apiPutMock: MockFunction = getJestMockFunction();

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
      put: (...args: Array<unknown>) => {
        return apiPutMock(...args);
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
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import Toast from "../../../UI/Utils/Toast";

const PROJECT_ID: ObjectID = new ObjectID(
  "81000000-0000-4000-8000-000000000003",
);

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 20; i++) {
      await Promise.resolve();
    }
  });
}

async function renderBilling(input: {
  planId: string;
  paymentMethods: number;
  reseller?: JSONObject | undefined;
}): Promise<void> {
  getItemMock.mockResolvedValue({
    paymentProviderPlanId: input.planId,
    ...(input.reseller ? { reseller: input.reseller } : {}),
  });
  getListMock.mockResolvedValue({ data: [], count: input.paymentMethods });
  countMock.mockResolvedValue(input.paymentMethods);

  await act(async () => {
    render(
      <Billing
        pageRoute={new Route("/settings/billing")}
        currentProject={null}
        hasPaymentMethod={input.paymentMethods > 0}
      />,
    );
  });

  await flush();
}

beforeEach(() => {
  getListMock.mockReset();
  countMock.mockReset();
  getItemMock.mockReset();
  apiPutMock
    .mockReset()
    .mockResolvedValue(new HTTPResponse<JSONObject>(200, {}, {}));
  apiGetMock
    .mockReset()
    .mockResolvedValue(new HTTPResponse<JSONObject>(200, { balance: 0 }, {}));

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  getJestSpyOn(Navigation, "getCurrentURL").mockReturnValue(
    URL.fromString("https://example.com/dashboard/project/settings/billing"),
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Cancel Plan on a paid plan", () => {
  it("never sends anybody to delete the project to stop paying", async () => {
    await renderBilling({ planId: "price_growth_month", paymentMethods: 1 });

    expect(screen.getByText("Cancel Plan")).toBeInTheDocument();
    expect(screen.queryByText("Delete Project")).toBeNull();
    expect(screen.queryByText(/you need to delete the project/)).toBeNull();
    expect(
      screen.getByText(
        "Switch to the Free plan to stop paying for seats. Your monitors, incidents, status pages and their history stay as they are.",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("cancel-plan-facts")).getByText(
        /Usage is still billed as you go on the Free plan/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Contact Support")).toBeInTheDocument();
  });

  it("moves the project to the Free plan after one question, on the period it is billed for", async () => {
    const toast: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      Toast,
      "success",
    );

    await renderBilling({ planId: "price_growth_year", paymentMethods: 1 });

    await act(async () => {
      fireEvent.click(screen.getByText("Switch to Free Plan"));
    });

    const dialog: HTMLElement = screen.getByRole("dialog");
    expect(
      within(dialog).getByText("Switch to the Free plan?"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        /Features the Free plan does not include stop working, and nothing is deleted./,
      ),
    ).toBeInTheDocument();
    expect(apiPutMock).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(within(dialog).getByText("Switch to Free Plan"));
    });
    await flush();

    expect(apiPutMock).toHaveBeenCalledTimes(1);
    const request: { url: URL; data: JSONObject } = apiPutMock.mock
      .calls[0]![0] as { url: URL; data: JSONObject };
    expect(request.url.toString()).toContain(
      `/${PROJECT_ID.toString()}/change-plan`,
    );
    expect(request.data).toEqual({
      data: { paymentProviderPlanId: "price_free_year" },
    });
    expect(toast).toHaveBeenCalledWith("This project is now on the Free plan.");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the question open and says why when the switch fails", async () => {
    apiPutMock.mockRejectedValue(new Error("Your card was declined."));

    await renderBilling({ planId: "price_growth_month", paymentMethods: 1 });

    await act(async () => {
      fireEvent.click(screen.getByText("Switch to Free Plan"));
    });
    const dialog: HTMLElement = screen.getByRole("dialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByText("Switch to Free Plan"));
    });
    await flush();

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Your card was declined./)).toBeInTheDocument();
  });

  it("asks for a payment method first, as Change Plan does", async () => {
    await renderBilling({ planId: "price_growth_month", paymentMethods: 0 });

    await act(async () => {
      fireEvent.click(screen.getByText("Switch to Free Plan"));
    });

    expect(screen.queryByText("Switch to the Free plan?")).toBeNull();
    expect(apiPutMock).not.toHaveBeenCalled();
  });
});

describe("Cancel Plan on the Free plan", () => {
  it("says the project pays nothing for seats, and offers support", async () => {
    await renderBilling({ planId: "price_free_month", paymentMethods: 1 });

    expect(
      screen.getByText(
        "This project is on the Free plan, so it pays nothing for seats.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Switch to Free Plan")).toBeNull();
    expect(screen.getByText("Contact Support")).toBeInTheDocument();
    expect(screen.queryByText("Delete Project")).toBeNull();
  });
});
