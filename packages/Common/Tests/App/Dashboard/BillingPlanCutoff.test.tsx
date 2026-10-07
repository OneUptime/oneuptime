import "@testing-library/jest-dom";
import { act, cleanup, render, screen, within } from "@testing-library/react";
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
 * The Billing page names how many API keys a plan stops and how many SCIM
 * connections it limits - API keys stop working below Growth, and SCIM
 * connections only remove people below Scale (Common/Types/Billing/
 * PlanCutoffCredentials) - before anyone picks a lower plan: each plan in
 * the picker says what moving to it stops. And it says what the project's
 * own plan has stopped, above the plan, with the plan that turns each fully
 * back on.
 *
 * The real page and its counts; ModelAPI, the plan editor (CardModelDetail,
 * drawn here as its plan options), the payment methods table and Stripe are
 * test boundaries.
 */

const getListMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
let billingEnabled: boolean = true;

const CLOUD_PLAN_ENV: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,price_free_month,price_free_year,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_growth_month,price_growth_year,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_scale_month,price_scale_year,99,84,3,14",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,price_enterprise_month,price_enterprise_year,-1,-1,4,14",
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
      get: async () => {
        return { data: { balance: 0 } };
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
    default: { capture: () => {}, captureRevenueEvent: () => {} },
  };
});

jest.mock("../../../UI/Config", () => {
  const config: Record<string, unknown> = {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
  };
  Object.defineProperty(config, "BILLING_ENABLED", {
    get: () => {
      return billingEnabled;
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

interface RecordedOption {
  value: string;
  title: string;
  description: string;
}

// The plan editor, drawn as the plans it offers: a title and a description each.
jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: {
      cardProps: { title: string };
      formFields: Array<{ radioButtonOptions?: Array<RecordedOption> }>;
    }): ReactElement => {
      if (props.cardProps.title !== "Current Plan") {
        return <></>;
      }

      return (
        <section aria-label="Plan options">
          {(props.formFields[0]?.radioButtonOptions || []).map(
            (option: RecordedOption) => {
              return (
                <div key={option.value} data-testid={`plan-${option.title}`}>
                  <h3>{option.title}</h3>
                  <p data-testid="plan-description">{option.description}</p>
                </div>
              );
            },
          )}
        </section>
      );
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
import { PLAN_CUTOFF_NOTE_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Billing/PlanCutoffNote";
import ApiKey from "../../../Models/DatabaseModels/ApiKey";
import BillingPaymentMethod from "../../../Models/DatabaseModels/BillingPaymentMethod";
import ProjectSCIM from "../../../Models/DatabaseModels/ProjectSCIM";
import StatusPageSCIM from "../../../Models/DatabaseModels/StatusPageSCIM";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "81000000-0000-4000-8000-000000000001",
);

// What the project has: counted by model, or a count that cannot be read.
let counts: Map<unknown, number | Error>;

const PLAN_TITLES: Array<string> = ["Free", "Growth", "Scale", "Enterprise"];

async function renderBillingOn(planId: string | null): Promise<void> {
  getItemMock.mockResolvedValue(
    planId ? { paymentProviderPlanId: planId } : {},
  );

  await act(async () => {
    render(
      <Billing
        pageRoute={new Route("/settings/billing")}
        currentProject={null}
        hasPaymentMethod={true}
      />,
    );
  });

  await screen.findByTestId("payment-methods-table");

  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

function descriptionOf(plan: string): string {
  return within(screen.getByTestId(`plan-${plan}`)).getByTestId(
    "plan-description",
  ).textContent as string;
}

function countedModels(): Array<unknown> {
  return countMock.mock.calls.map((call: Array<unknown>): unknown => {
    return (call[0] as { modelType: unknown }).modelType;
  });
}

beforeEach(() => {
  billingEnabled = true;
  counts = new Map<unknown, number | Error>([
    [ApiKey, 3],
    [ProjectSCIM, 1],
    [StatusPageSCIM, 1],
    [BillingPaymentMethod, 1],
  ]);

  getListMock.mockReset().mockResolvedValue({ data: [], count: 1 });
  countMock.mockReset().mockImplementation(async (request: unknown) => {
    const value: number | Error | undefined = counts.get(
      (request as { modelType: unknown }).modelType,
    );

    if (value instanceof Error) {
      throw value;
    }

    return value ?? 0;
  });
  getItemMock.mockReset();

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  getJestSpyOn(Navigation, "getCurrentURL").mockReturnValue(
    URL.fromString("https://example.com/dashboard/project/settings/billing"),
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a project on Scale with 3 API keys and 2 SCIM connections", () => {
  it("names, on each lower plan, what moving to it stops", async () => {
    await renderBillingOn("price_scale_month");

    expect(descriptionOf("Free")).toContain(
      "Your 3 API keys stop working on this plan.",
    );
    expect(descriptionOf("Free")).toContain(
      "Your 2 SCIM connections only remove people on this plan.",
    );

    // Growth keeps the keys: only SCIM stops.
    expect(descriptionOf("Growth")).toContain(
      "Your 2 SCIM connections only remove people on this plan.",
    );
    expect(descriptionOf("Growth")).not.toContain("API key");
  });

  it("says nothing on the plans that keep them", async () => {
    await renderBillingOn("price_scale_month");

    for (const plan of ["Scale", "Enterprise"]) {
      expect(descriptionOf(plan)).not.toContain("stop working");
    }
  });

  it("keeps each plan's own description first", async () => {
    await renderBillingOn("price_scale_month");

    expect(descriptionOf("Free")).toMatch(
      /^\$0 subscription\. Paid features are billed separately when pay as you go is enabled\. Your 3 API keys/,
    );
  });

  it("shows no stopped note: nothing stopped on Scale", async () => {
    await renderBillingOn("price_scale_month");

    expect(screen.queryByTestId(PLAN_CUTOFF_NOTE_TEST_ID)).toBeNull();
  });

  it("counts the project's API keys that have not expired, and its SCIM connections", async () => {
    await renderBillingOn("price_scale_month");

    expect(countedModels()).toEqual(
      expect.arrayContaining([ApiKey, ProjectSCIM, StatusPageSCIM]),
    );

    const apiKeyCount: { query: Record<string, unknown> } =
      countMock.mock.calls.find((call: Array<unknown>) => {
        return (call[0] as { modelType: unknown }).modelType === ApiKey;
      })![0] as { query: Record<string, unknown> };

    expect(String(apiKeyCount.query["projectId"])).toBe(PROJECT_ID.toString());
    expect(apiKeyCount.query["expiresAt"]).toBeInstanceOf(GreaterThan);
  });
});

/*
 * Someone who may change the plan (a billing manager) need not be able to
 * read the project's API keys or SCIM connections. A count they may not
 * read is not known: the picker still says that the kind stops, without a
 * number, and the other kind's count still shows.
 */
describe("someone who may not read the project's API keys, on Scale", () => {
  it("is told on Free that API keys stop, without a number, and how many SCIM connections only remove people", async () => {
    counts.set(ApiKey, Error("not allowed") as never);

    await renderBillingOn("price_scale_month");

    expect(descriptionOf("Free")).toContain(
      "API keys stop working on this plan.",
    );
    expect(descriptionOf("Free")).not.toContain("Your 3 API keys");
    expect(descriptionOf("Free")).toContain(
      "Your 2 SCIM connections only remove people on this plan.",
    );

    // Growth keeps the keys: nothing is said about them there.
    expect(descriptionOf("Growth")).not.toContain("API key");
  });
});

describe("a project on Growth", () => {
  it("names only the API keys Free would stop: its SCIM connections only remove people on Growth already", async () => {
    // Whether or not the SCIM count can be read, Free stops none of them.
    counts.set(ProjectSCIM, Error("not allowed") as never);
    counts.set(StatusPageSCIM, 0);

    await renderBillingOn("price_growth_year");

    expect(descriptionOf("Free")).toContain(
      "Your 3 API keys stop working on this plan.",
    );
    expect(descriptionOf("Free")).not.toContain("SCIM");
  });

  it("says above the plan that its SCIM connections only remove people, and which plan turns them fully back on", async () => {
    await renderBillingOn("price_growth_month");

    const note: HTMLElement = screen.getByTestId(PLAN_CUTOFF_NOTE_TEST_ID);

    expect(note).toHaveTextContent("Not included in this plan");
    expect(note).toHaveTextContent(
      "Your 2 SCIM connections only remove people on this plan: your identity provider can no longer add or change people. They work fully again on the Scale plan.",
    );
    expect(note).not.toHaveTextContent("API key");
  });
});

describe("a project on Free", () => {
  it("says above the plan what stopped, and the plan that turns each back on", async () => {
    counts.set(ProjectSCIM, 1);
    counts.set(StatusPageSCIM, 0);

    await renderBillingOn("price_free_month");

    const note: HTMLElement = screen.getByTestId(PLAN_CUTOFF_NOTE_TEST_ID);

    expect(note).toHaveTextContent(
      "Your 3 API keys stopped working on this plan. They work again on the Growth plan.",
    );
    expect(note).toHaveTextContent(
      "Your SCIM connection only removes people on this plan: your identity provider can no longer add or change people. It works fully again on the Scale plan.",
    );
  });

  it("offers every plan without a stop sentence: nothing works on Free to stop", async () => {
    await renderBillingOn("price_free_month");

    for (const plan of PLAN_TITLES) {
      expect(descriptionOf(plan)).not.toContain("stop working");
    }
  });

  it("shows no note for a project with no API keys or SCIM connections", async () => {
    counts.set(ApiKey, 0);
    counts.set(ProjectSCIM, 0);
    counts.set(StatusPageSCIM, 0);

    await renderBillingOn("price_free_month");

    expect(screen.queryByTestId(PLAN_CUTOFF_NOTE_TEST_ID)).toBeNull();
  });
});

describe("when nothing can be said", () => {
  it("billing off (self-hosted): counts nothing, shows nothing", async () => {
    billingEnabled = false;

    await renderBillingOn("price_free_month");

    expect(countedModels()).not.toContain(ApiKey);
    expect(countedModels()).not.toContain(ProjectSCIM);
    expect(screen.queryByTestId(PLAN_CUTOFF_NOTE_TEST_ID)).toBeNull();
  });

  it("a plan that is not one of the configured plans: counts nothing", async () => {
    await renderBillingOn("price_not_configured");

    expect(countedModels()).not.toContain(ApiKey);
    expect(screen.queryByTestId(PLAN_CUTOFF_NOTE_TEST_ID)).toBeNull();
  });

  it("no plan at all: counts nothing", async () => {
    await renderBillingOn(null);

    expect(countedModels()).not.toContain(ApiKey);
  });
});
