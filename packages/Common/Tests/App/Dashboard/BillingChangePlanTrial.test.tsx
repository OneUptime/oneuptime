import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactNode } from "react";
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
 * The Change Plan dialog is the shared plan picker a new project starts on
 * (PlanPicker), for a plan change: it opens at the period the project is
 * billed for, marks the plan it is on, offers no trial on any plan, and
 * keeps the note under the plans.
 *
 * The real page and its plan field; ModelAPI, the rest of the plan editor
 * (CardModelDetail, drawn here as the field and its footer -
 * BillingPlanEditorStandIn), the payment methods table and Stripe are test
 * boundaries.
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

/*
 * The plan editor, drawn as its Change Plan dialog's field: the page's own
 * plan picker holding the plan the project is on, and the note under it.
 */
jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return jest.requireActual("./BillingPlanEditorStandIn");
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
import { setPlanEditorProjectPlan } from "./BillingPlanEditorStandIn";
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
  billingMarketplace?: string | undefined;
}): Promise<void> {
  getItemMock.mockResolvedValue(project);
  setPlanEditorProjectPlan(project.paymentProviderPlanId);

  await act(async () => {
    render(
      <Billing
        pageRoute={new Route("/settings/billing")}
        currentProject={null}
        hasPaymentMethod={true}
      />,
    );
  });

  // The Current Plan card: there with a card on file or a marketplace alike.
  await screen.findByTestId("plan-editor");

  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

// What a plan's row in the picker says: its name, pills, line, price.
function rowText(plan: string): string {
  return screen.getByTestId(`plan-picker-option-${plan}`).textContent || "";
}

// The Current plan pill on a plan's row, or null when it has none.
function currentPlanPill(plan: string): string | null {
  const pill: HTMLElement | null = within(
    screen.getByTestId(`plan-picker-option-${plan}`),
  ).queryByTestId("plan-picker-current-plan");

  return pill ? pill.textContent : null;
}

// What the dialog's form would say under the plans on Save Changes.
function editorError(): string {
  return screen.getByTestId("plan-editor-error").textContent || "";
}

// The price the plan's radio picks: the plan, at the period shown.
function valueOf(plan: string): string {
  return (screen.getByRole("radio", { name: plan }) as HTMLInputElement).value;
}

function periodButton(period: "monthly" | "yearly"): HTMLElement {
  return screen.getByTestId(`plan-picker-period-${period}`);
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
      expect(rowText(plan)).not.toMatch(/trial/i);
    }
  });

  it("is the plan picker a new project starts on, in the dialog called Change Plan", async () => {
    await renderBilling({
      paymentProviderPlanId: "price_free_month",
      trialEndsAt: null,
    });

    expect(screen.getByTestId("change-plan-picker")).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(PLAN_TITLES.length);
    expect(screen.getByTestId("plan-editor")).toHaveAttribute(
      "data-title",
      "Change Plan",
    );
  });

  it("opens at the period the project is billed for, with its plan marked", async () => {
    await renderBilling({
      paymentProviderPlanId: "price_free_month",
      trialEndsAt: null,
    });

    expect(periodButton("monthly")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("radio", { name: "Free" })).toBeChecked();
    expect(rowText("Free")).toContain("Current plan");
    expect(valueOf("Growth")).toBe("price_growth_month");
    expect(rowText("Growth")).toContain("$22");
    expect(rowText("Growth")).toContain("billed monthly");

    // Only the plan the project is on is marked.
    for (const plan of ["Growth", "Scale", "Enterprise"]) {
      expect(rowText(plan)).not.toContain("Current plan");
    }
  });

  it("says under the plans that changing plan starts no trial, and what is billed straight away", async () => {
    await renderBilling({
      paymentProviderPlanId: "price_free_month",
      trialEndsAt: null,
    });

    expect(noteText()).toContain(ChangePlanBillingCopy.noTrialTitle);
    expect(noteText()).toContain(ChangePlanBillingCopy.noTrialDescription);
    // The note is the dialog's: the picker draws no new project's terms.
    expect(screen.queryByTestId("plan-picker-terms")).toBeNull();
  });

  it("still promises no trial once the yearly prices are shown", async () => {
    await renderBilling({
      paymentProviderPlanId: "price_free_month",
      trialEndsAt: null,
    });

    await act(async () => {
      fireEvent.click(periodButton("yearly"));
    });

    expect(periodButton("yearly")).toHaveAttribute("aria-pressed", "true");
    expect(valueOf("Growth")).toBe("price_growth_year");
    expect(rowText("Growth")).toContain("$20");
    expect(rowText("Growth")).toContain("billed yearly");

    for (const plan of PLAN_TITLES) {
      expect(rowText(plan)).not.toMatch(/trial/i);
    }

    expect(noteText()).toContain(ChangePlanBillingCopy.noTrialTitle);
  });

  it("keeps the plan picked when the period changes, at the other period's price", async () => {
    await renderBilling({
      paymentProviderPlanId: "price_free_month",
      trialEndsAt: null,
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Growth" }));
    });

    expect(screen.getByTestId("plan-editor-value")).toHaveTextContent(
      "price_growth_month",
    );

    await act(async () => {
      fireEvent.click(periodButton("yearly"));
    });

    expect(screen.getByRole("radio", { name: "Growth" })).toBeChecked();
    expect(screen.getByTestId("plan-editor-value")).toHaveTextContent(
      "price_growth_year",
    );
  });

  it("keeps the note under the plans, and the Monthly | Yearly switch with them", async () => {
    await renderBilling({
      paymentProviderPlanId: "price_free_month",
      trialEndsAt: null,
    });

    const footer: HTMLElement = screen.getByTestId("plan-footer");

    expect(
      within(footer).getByTestId(CHANGE_PLAN_BILLING_NOTE_TEST_ID),
    ).toBeInTheDocument();
    // The old Yearly Plan switch is gone: the picker has the period.
    expect(screen.queryByRole("switch")).toBeNull();
    expect(
      screen.getByRole("group", { name: "Billing period" }),
    ).toBeInTheDocument();
  });

  /*
   * The switch promised "(Save 20%)" whatever the prices were. On these
   * plans - OneUptime Cloud's - yearly saves 9% on Growth ($22 or $20) and
   * 15% on Scale ($99 or $84), so it says "up to 15%", worked out from them
   * as the Create New Project dialog says it.
   */
  it("says what yearly saves from the plans' prices, not a flat 20%", async () => {
    await renderBilling({
      paymentProviderPlanId: "price_free_month",
      trialEndsAt: null,
    });

    const saving: HTMLElement = screen.getByTestId("plan-picker-saving");

    expect(saving).toHaveTextContent("Save up to 15%");
    expect(
      screen.getByTestId("change-plan-picker").textContent || "",
    ).not.toContain("20%");
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

describe("a project billed yearly", () => {
  it("opens at the yearly prices, with its plan marked - at the monthly prices too", async () => {
    await renderBilling({
      paymentProviderPlanId: "price_growth_year",
      trialEndsAt: null,
    });

    expect(periodButton("yearly")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("radio", { name: "Growth" })).toBeChecked();
    expect(currentPlanPill("Growth")).toBe("Current plan");

    /*
     * Growth billed monthly is another price to move to. The pill stays on
     * Growth and says how the project is billed now, so a reader looking at
     * the monthly prices still sees the plan they are on.
     */
    await act(async () => {
      fireEvent.click(periodButton("monthly"));
    });

    expect(currentPlanPill("Growth")).toBe("Current plan, billed yearly");
    expect(screen.getAllByTestId("plan-picker-current-plan")).toHaveLength(1);
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
      expect(rowText(plan)).not.toMatch(/days? (free )?trial/i);
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

describe("plans whose price is not per user", () => {
  it("shows Free at $0 and Enterprise at its custom price, each with who it is for", async () => {
    await renderBilling({
      paymentProviderPlanId: "price_free_month",
      trialEndsAt: null,
    });

    expect(rowText("Free")).toContain("$0");
    expect(rowText("Free")).toContain("For one person getting started.");
    expect(rowText("Free")).not.toContain("per user");
    expect(rowText("Enterprise")).toContain("Custom Price");
    expect(rowText("Enterprise")).toContain(
      "Custom terms, a dedicated engineer and phone support.",
    );
  });
});

/*
 * A cloud marketplace bills month to month - a yearly price is a private
 * offer there - so its project sees the monthly prices alone, with no
 * Monthly | Yearly switch and nothing said about what yearly saves.
 */
describe("a project a cloud marketplace bills", () => {
  it("offers the monthly prices alone, with no switch, and its plan marked", async () => {
    await renderBilling({
      paymentProviderPlanId: "price_growth_month",
      trialEndsAt: null,
      billingMarketplace: "AWS",
    });

    expect(screen.queryByTestId("plan-picker-period-yearly")).toBeNull();
    expect(screen.queryByTestId("plan-picker-period-monthly")).toBeNull();
    expect(screen.queryByTestId("plan-picker-saving")).toBeNull();
    expect(valueOf("Growth")).toBe("price_growth_month");
    expect(valueOf("Scale")).toBe("price_scale_month");
    expect(rowText("Growth")).toContain("Current plan");
    expect(rowText("Growth")).toContain("billed monthly");
  });

  it("shows the monthly prices even for a project on a yearly price", async () => {
    await renderBilling({
      paymentProviderPlanId: "price_growth_year",
      trialEndsAt: null,
      billingMarketplace: "AWS",
    });

    expect(valueOf("Growth")).toBe("price_growth_month");
    expect(rowText("Growth")).toContain("$22");
    // The yearly price it is on is not one of those shown: the pill says it.
    expect(currentPlanPill("Growth")).toBe("Current plan, billed yearly");
  });
});

/*
 * UI review: Save Changes with the plan the project is on still picked ran
 * a whole plan change - the price swapped for itself at the payment
 * provider, and the change reported - for a project that stayed where it
 * was. The dialog opens on that plan, so it was one press away. Now the
 * form's check says so under the plans instead (getChangePlanError).
 */
describe("Save Changes with the plan the project is on", () => {
  it("says the project is already on it, rather than changing nothing", async () => {
    await renderBilling({
      paymentProviderPlanId: "price_growth_year",
      trialEndsAt: null,
    });

    expect(editorError()).toBe(
      "The project is already on this plan. Pick another plan to change to.",
    );
  });

  it("goes ahead once another plan is picked", async () => {
    await renderBilling({
      paymentProviderPlanId: "price_growth_year",
      trialEndsAt: null,
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Scale" }));
    });

    expect(editorError()).toBe("");
  });

  it("goes ahead for the same paid plan at the other period: that is a change", async () => {
    await renderBilling({
      paymentProviderPlanId: "price_growth_year",
      trialEndsAt: null,
    });

    await act(async () => {
      fireEvent.click(periodButton("monthly"));
    });

    expect(screen.getByTestId("plan-editor-value")).toHaveTextContent(
      "price_growth_month",
    );
    expect(editorError()).toBe("");
  });

  it("says so for Free at the other period: it costs nothing either way", async () => {
    await renderBilling({
      paymentProviderPlanId: "price_free_month",
      trialEndsAt: null,
    });

    await act(async () => {
      fireEvent.click(periodButton("yearly"));
    });

    expect(screen.getByTestId("plan-editor-value")).toHaveTextContent(
      "price_free_year",
    );
    expect(editorError()).toBe(
      "The project is already on this plan. Pick another plan to change to.",
    );
  });
});

/*
 * After a plan change saves, the page is on the new plan: the Current plan
 * pill moves to it, and the next change is checked against it.
 */
describe("after a plan change is saved", () => {
  it("marks the plan the project moved to, and no longer the one it left", async () => {
    await renderBilling({
      paymentProviderPlanId: "price_growth_year",
      trialEndsAt: null,
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Scale" }));
    });

    // What the change-plan API left on the project.
    getItemMock.mockResolvedValue({
      paymentProviderPlanId: "price_scale_year",
      paymentProviderSubscriptionSeats: 4,
      trialEndsAt: null,
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("plan-editor-saved"));
    });

    await act(async () => {
      for (let i: number = 0; i < 10; i++) {
        await Promise.resolve();
      }
    });

    expect(currentPlanPill("Scale")).toBe("Current plan");
    expect(
      within(screen.getByTestId("plan-picker-option-Growth")).queryByTestId(
        "plan-picker-current-plan",
      ),
    ).toBeNull();
    // Scale is the plan the project is on now: saving it again changes nothing.
    expect(editorError()).toBe(
      "The project is already on this plan. Pick another plan to change to.",
    );
  });

  it("reads the project's trial again with its plan", async () => {
    await renderBilling({
      paymentProviderPlanId: "price_growth_year",
      trialEndsAt: null,
    });

    getItemMock.mockClear();
    getItemMock.mockResolvedValue({
      paymentProviderPlanId: "price_scale_year",
      paymentProviderSubscriptionSeats: 4,
      trialEndsAt: null,
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("plan-editor-saved"));
    });

    const request: { select: Record<string, unknown> } = getItemMock.mock
      .calls[0]![0] as { select: Record<string, unknown> };

    expect(request.select).toEqual(
      expect.objectContaining({
        paymentProviderPlanId: true,
        trialEndsAt: true,
      }),
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
