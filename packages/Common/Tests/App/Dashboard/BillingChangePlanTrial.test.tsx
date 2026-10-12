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
 * The Change Plan picker on the Billing page, and what it says about trials.
 *
 * A customer created a project on Free, hit Free's one-user limit, and
 * upgraded to Growth from this picker - which described Growth as "Billed
 * yearly. Free 14 days trial." A plan change never starts a trial
 * (BillingService.changePlan only keeps one the project is already on), so
 * Stripe charged the year on the spot, and then again for each person they
 * invited. They reported being charged during their trial.
 *
 * The picker now promises no trial on any plan, and says under the plans
 * either which trial carries over and until when, or that changing plan
 * starts none and what is billed straight away.
 *
 * The real page; ModelAPI, the plan editor (CardModelDetail, drawn here as
 * its plan options and the footer under them), the payment methods table
 * and Stripe are test boundaries.
 */

const getListMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
let billingEnabled: boolean = true;

// As configured on OneUptime cloud: Free has no trial, the paid plans 14 days.
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

/*
 * The plan editor, drawn as what its form shows: each plan with its
 * description, and the footer under them.
 */
jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: {
      cardProps: { title: string };
      formFields: Array<{
        radioButtonOptions?: Array<RecordedOption>;
        footerElement?: ReactElement | undefined;
      }>;
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
                  <p data-testid="plan-value">{option.value}</p>
                  <p data-testid="plan-description">{option.description}</p>
                </div>
              );
            },
          )}
          <div data-testid="plan-footer">
            {props.formFields[0]?.footerElement}
          </div>
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
import {
  CHANGE_PLAN_BILLING_NOTE_TEST_ID,
  ChangePlanBillingCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Billing/ChangePlanBilling";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "83000000-0000-4000-8000-000000000001",
);

const PLAN_TITLES: Array<string> = ["Free", "Growth", "Scale", "Enterprise"];

type DaysFromNowFunction = (days: number) => Date;

// getSomeDaysAfter goes through PositiveNumber, so it cannot count backwards.
const daysFromNow: DaysFromNowFunction = (days: number): Date => {
  return OneUptimeDate.addRemoveDays(OneUptimeDate.getCurrentDate(), days);
};

async function renderBilling(project: {
  paymentProviderPlanId: string;
  trialEndsAt?: Date | null | undefined;
}): Promise<void> {
  getItemMock.mockResolvedValue(project);

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

function valueOf(plan: string): string {
  return within(screen.getByTestId(`plan-${plan}`)).getByTestId("plan-value")
    .textContent as string;
}

function noteText(): string {
  return screen.getByTestId(CHANGE_PLAN_BILLING_NOTE_TEST_ID)
    .textContent as string;
}

beforeEach(() => {
  billingEnabled = true;

  getListMock.mockReset().mockResolvedValue({ data: [], count: 1 });
  countMock.mockReset().mockResolvedValue(0);
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

describe("reading the project", () => {
  it("asks for the project's trial end along with its plan", async () => {
    await renderBilling({ paymentProviderPlanId: "price_free_month" });

    const projectRequest: { select: Record<string, unknown> } = getItemMock.mock
      .calls[0]![0] as { select: Record<string, unknown> };

    expect(projectRequest.select).toEqual(
      expect.objectContaining({
        paymentProviderPlanId: true,
        trialEndsAt: true,
      }),
    );
  });
});

describe("a project on Free with no trial - the reported case", () => {
  it("promises no trial on any plan", async () => {
    await renderBilling({
      paymentProviderPlanId: "price_free_month",
      trialEndsAt: null,
    });

    for (const plan of PLAN_TITLES) {
      expect(descriptionOf(plan)).not.toMatch(/trial/i);
    }
  });

  it("describes Growth by how it is billed, and nothing more", async () => {
    // Yearly is what the picker opens on.
    await renderBilling({
      paymentProviderPlanId: "price_free_month",
      trialEndsAt: null,
    });

    expect(valueOf("Growth")).toBe("price_growth_year");
    expect(descriptionOf("Growth")).toBe("Billed yearly.");
    expect(descriptionOf("Scale")).toBe("Billed yearly.");
  });

  it("says under the plans that changing plan starts no trial, and what is billed straight away", async () => {
    await renderBilling({
      paymentProviderPlanId: "price_free_month",
      trialEndsAt: null,
    });

    expect(noteText()).toContain(ChangePlanBillingCopy.noTrialTitle);
    expect(noteText()).toContain(ChangePlanBillingCopy.noTrialDescription);
  });

  it("still promises no trial once billed monthly", async () => {
    await renderBilling({
      paymentProviderPlanId: "price_free_month",
      trialEndsAt: null,
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: /Yearly Plan/ }));
    });

    expect(valueOf("Growth")).toBe("price_growth_month");
    expect(descriptionOf("Growth")).toBe("Billed monthly.");

    for (const plan of PLAN_TITLES) {
      expect(descriptionOf(plan)).not.toMatch(/trial/i);
    }

    expect(noteText()).toContain(ChangePlanBillingCopy.noTrialTitle);
  });

  it("keeps the yearly switch next to the note", async () => {
    await renderBilling({
      paymentProviderPlanId: "price_free_month",
      trialEndsAt: null,
    });

    const footer: HTMLElement = screen.getByTestId("plan-footer");

    expect(
      within(footer).getByRole("switch", { name: /Yearly Plan/ }),
    ).toBeInTheDocument();
    expect(
      within(footer).getByTestId(CHANGE_PLAN_BILLING_NOTE_TEST_ID),
    ).toBeInTheDocument();
  });

  it("treats the trial end a plan change stamps on a project with no trial as no trial", async () => {
    /*
     * An upgrade from Free leaves this on the project row: with no trial on
     * either side, ProjectService.changePlan writes the moment of the
     * upgrade as the trial end.
     */
    await renderBilling({
      paymentProviderPlanId: "price_growth_year",
      trialEndsAt: daysFromNow(-4),
    });

    expect(noteText()).toContain(ChangePlanBillingCopy.noTrialTitle);
    expect(noteText()).not.toContain(ChangePlanBillingCopy.trialTitle);
  });
});

describe("a project still on its trial", () => {
  it("says the trial carries over to whichever plan is picked, and until when", async () => {
    const trialEndsAt: Date = daysFromNow(9);

    await renderBilling({
      paymentProviderPlanId: "price_growth_month",
      trialEndsAt: trialEndsAt,
    });

    expect(noteText()).toContain(ChangePlanBillingCopy.trialTitle);
    expect(noteText()).toContain(
      `Your free trial runs until ${OneUptimeDate.getDateAsLocalFormattedString(
        trialEndsAt,
        true,
      )} on whichever plan you choose. Billing starts when it ends.`,
    );
    expect(noteText()).not.toContain(ChangePlanBillingCopy.noTrialTitle);
  });

  it("offers no new trial on top of the running one", async () => {
    await renderBilling({
      paymentProviderPlanId: "price_growth_month",
      trialEndsAt: daysFromNow(9),
    });

    for (const plan of PLAN_TITLES) {
      expect(descriptionOf(plan)).not.toMatch(/days? trial/i);
    }
  });
});

describe("a project whose trial has ended", () => {
  it("says changing plan starts no trial", async () => {
    await renderBilling({
      paymentProviderPlanId: "price_growth_month",
      trialEndsAt: daysFromNow(-30),
    });

    expect(noteText()).toContain(ChangePlanBillingCopy.noTrialTitle);
    expect(noteText()).not.toContain(ChangePlanBillingCopy.trialTitle);
  });
});

describe("plans whose description is their price", () => {
  it("keeps Free's and Enterprise's own descriptions", async () => {
    await renderBilling({
      paymentProviderPlanId: "price_free_month",
      trialEndsAt: null,
    });

    expect(descriptionOf("Free")).toBe(
      "$0 subscription. Paid features are billed separately when pay as you go is enabled.",
    );
    expect(descriptionOf("Enterprise")).toBe(
      "Our sales team will contact you soon.",
    );
  });
});

describe("billing off (self-hosted)", () => {
  it("shows no note: nothing is billed", async () => {
    billingEnabled = false;

    await renderBilling({
      paymentProviderPlanId: "price_free_month",
      trialEndsAt: null,
    });

    expect(screen.queryByTestId(CHANGE_PLAN_BILLING_NOTE_TEST_ID)).toBeNull();
  });
});
