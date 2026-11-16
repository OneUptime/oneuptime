import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { SpyInstance } from "jest-mock";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * ADMIN DASHBOARD > PROJECTS > (PROJECT) > SUBSCRIPTION > CHANGE PLAN, on
 * the real page, in the real locales (issue #6771: "I'm not able to change
 * plan for the project on the admin dashboard").
 *
 * The Trial and Subscription card carries Change Plan beside Extend Trial.
 * It opens the customer's own plan picker on the plan the project is on,
 * marked Current plan; keeping that plan is refused under the plans and
 * never sent; another plan is sent to the master-admin route, the dialog
 * closes, the page says what the project moved to and the card reads it. A
 * refusal keeps the dialog open with the plan picked and why. A project a
 * cloud marketplace bills sees the monthly prices alone.
 *
 * The admin API, the HTTP client, the page chrome and the side menu are
 * stand-ins. The admin API holds the project as a server would: what a
 * plan change writes, the next read returns. The i18next instance reaches
 * the page through I18nextProvider only.
 */

jest.setTimeout(60000);

const PROJECT_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194165002";

// Generous: these drive the real form and card, on a CI box that may be busy.
const WAIT: { timeout: number } = { timeout: 20000 };

const mockGetItem: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Utils/ModelAPI",
  () => {
    return {
      __esModule: true,
      default: {
        getItem: (...args: Array<unknown>): unknown => {
          return mockGetItem(...args);
        },
        getList: async (): Promise<unknown> => {
          return { data: [], count: 0, skip: 0, limit: 0 };
        },
        updateById: async (): Promise<unknown> => {
          return {};
        },
        createOrUpdate: async (): Promise<unknown> => {
          return { data: {} };
        },
      },
    };
  },
);

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

// The page is billing-only, and its plans are the server's.
jest.mock("../../../UI/Config", () => {
  const mocked: Record<string, unknown> = {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
  };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return true;
    },
  });

  mocked["getAllEnvVars"] = (): Record<string, string> => {
    return CLOUD_PLAN_ENV;
  };

  return mocked;
});

jest.mock("../../../UI/Components/Page/Page", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  return {
    __esModule: true,
    default: (props: { children?: React.ReactNode }) => {
      return react.createElement("div", null, props.children);
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Pages/Projects/View/SideMenu",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

import ProjectSubscription from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Projects/View/Subscription";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import { JSONObject } from "../../../Types/JSON";
import CloudMarketplace from "../../../Types/Marketplace/CloudMarketplace";
import BaseAPI from "../../../UI/Utils/API/API";
import UserUtil from "../../../UI/Utils/User";

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "AdminDashboard",
  "src",
  "Locales",
);

type Locale = Record<string, unknown>;

function readLocale(locale: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Locale;
}

async function instanceFor(locale: string): Promise<i18n> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: locale,
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      [locale]: { translation: readLocale(locale) },
    },
    interpolation: { escapeValue: false },
  });

  return instance;
}

// The plan names, by the price ids above.
const PLAN_NAMES: Record<string, PlanType> = {
  price_free_month: PlanType.Free,
  price_free_year: PlanType.Free,
  price_growth_month: PlanType.Growth,
  price_growth_year: PlanType.Growth,
  price_scale_month: PlanType.Scale,
  price_scale_year: PlanType.Scale,
  price_enterprise_month: PlanType.Enterprise,
  price_enterprise_year: PlanType.Enterprise,
};

interface StoredProject {
  planId: string;
  marketplace?: CloudMarketplace | undefined;
}

// The project as the server holds it.
let storedProject: StoredProject = { planId: "price_free_month" };

interface PutRequest {
  url: { toString: () => string };
  data: JSONObject;
}

let putSpy: SpyInstance<typeof BaseAPI.put>;

function onProject(values: StoredProject): void {
  storedProject = { ...values };

  mockGetItem.mockImplementation(async (): Promise<Project> => {
    const project: Project = new Project();
    project._id = PROJECT_ID;
    project.name = "Acme Production";
    project.paymentProviderPlanId = storedProject.planId;
    // Every plan the suite stores is one of PLAN_NAMES'.
    project.planName = PLAN_NAMES[storedProject.planId]!;

    if (storedProject.marketplace) {
      project.billingMarketplace = storedProject.marketplace;
    }

    return project;
  });
}

// The server moves the project to the plan it is sent.
function changesGoThrough(): void {
  putSpy.mockImplementation((async (
    request: PutRequest,
  ): Promise<HTTPResponse<JSONObject>> => {
    const data: JSONObject = request.data["data"] as JSONObject;
    storedProject.planId = data["paymentProviderPlanId"] as string;
    return new HTTPResponse<JSONObject>(200, {}, {});
  }) as unknown as typeof BaseAPI.put);
}

// The server refuses every plan change, saying why.
function changesAreRefused(message: string): void {
  putSpy.mockImplementation((async (): Promise<
    HTTPErrorResponse | HTTPResponse<JSONObject>
  > => {
    return new HTTPErrorResponse(400, { message: message }, {});
  }) as unknown as typeof BaseAPI.put);
}

function sentRequest(index: number = 0): PutRequest {
  return (putSpy.mock.calls[index] as unknown as Array<PutRequest>)[0]!;
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

// The Trial and Subscription card's fields, where it shows the plan.
function cardPlan(): HTMLElement {
  const card: HTMLElement | null = document.querySelector(
    "#model-detail-project-subscription",
  );

  if (!card) {
    throw new Error("The Trial and Subscription card has not drawn yet.");
  }

  return card;
}

async function renderPage(locale: string = "en"): Promise<void> {
  const instance: i18n = await instanceFor(locale);

  render(
    <I18nextProvider i18n={instance}>
      <ProjectSubscription />
    </I18nextProvider>,
  );

  await flush();

  // The card has read the project, so Change Plan opens on its plan.
  await waitFor(() => {
    expect(mockGetItem).toHaveBeenCalled();
    expect(
      within(cardPlan()).getByText(PLAN_NAMES[storedProject.planId]!),
    ).toBeInTheDocument();
  }, WAIT);
}

function dialog(): HTMLElement {
  return screen.getByRole("dialog");
}

async function openChangePlan(name: string = "Change Plan"): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: name }));
  await flush();

  await waitFor(() => {
    expect(
      within(dialog()).getByTestId("admin-change-plan-picker"),
    ).toBeInTheDocument();
  }, WAIT);
}

function option(planName: string): HTMLElement {
  return within(dialog()).getByTestId(`plan-picker-option-${planName}`);
}

async function pick(planName: string): Promise<void> {
  fireEvent.click(within(option(planName)).getByRole("radio"));
  await flush();
}

async function submit(): Promise<void> {
  fireEvent.click(within(dialog()).getByTestId("modal-footer-submit-button"));
  await flush();
}

describe("Admin > Project > Subscription > Change Plan", () => {
  beforeEach(() => {
    window.history.pushState(
      {},
      "",
      `/admin/projects/${PROJECT_ID}/subscription`,
    );
    mockGetItem.mockReset();
    getJestSpyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);
    // put is generic; its spy is the one instantiation the suite reads.
    putSpy = jest.spyOn(BaseAPI, "put") as unknown as SpyInstance<
      typeof BaseAPI.put
    >;
    changesGoThrough();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("sits on the Trial and Subscription card, beside Extend Trial", async () => {
    onProject({ planId: "price_free_month" });

    await renderPage();

    const changePlan: HTMLElement = screen.getByRole("button", {
      name: "Change Plan",
    });
    const extendTrial: HTMLElement = screen.getByRole("button", {
      name: "Extend Trial",
    });

    expect(changePlan).toBeInTheDocument();
    // Change Plan first, as the card reads: the plan, then its trial.
    expect(
      changePlan.compareDocumentPosition(extendTrial) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("opens on the plan the project is on, marked, with every plan and no trial offered", async () => {
    onProject({ planId: "price_free_month" });

    await renderPage();
    await openChangePlan();

    expect(screen.getByTestId("modal-title")).toHaveTextContent("Change Plan");
    expect(
      within(dialog()).getByText(
        "Move this project to another plan. A running trial carries over; otherwise the new plan is billed from now on, prorated on the next invoice.",
      ),
    ).toBeInTheDocument();

    for (const planName of ["Free", "Growth", "Scale", "Enterprise"]) {
      expect(option(planName)).toBeInTheDocument();
    }

    expect(option("Free")).toHaveAttribute("data-selected", "true");
    expect(
      within(option("Free")).getByTestId("plan-picker-current-plan"),
    ).toHaveTextContent("Current plan");
    expect(option("Growth")).toHaveAttribute("data-selected", "false");

    // A plan change keeps a running trial and never starts one.
    expect(within(dialog()).queryByText(/free trial/i)).toBeNull();

    // The button says what it does.
    expect(
      within(dialog()).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Change Plan");
  });

  test("opens at the billing period the project is on", async () => {
    onProject({ planId: "price_scale_year" });

    await renderPage();
    await openChangePlan();

    expect(option("Scale")).toHaveAttribute("data-selected", "true");
    expect(
      within(dialog()).getByTestId("plan-picker-period-yearly"),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("keeping the plan the project is on is refused under the plans, and nothing is sent", async () => {
    onProject({ planId: "price_free_month" });

    await renderPage();
    await openChangePlan();
    await submit();

    await waitFor(() => {
      expect(
        within(dialog()).getByText(
          "The project is already on this plan. Pick another plan to change to.",
        ),
      ).toBeInTheDocument();
    }, WAIT);
    expect(putSpy).not.toHaveBeenCalled();
  });

  test("another plan is sent to the admin route; the dialog closes, the page says so and the card reads it", async () => {
    onProject({ planId: "price_free_month" });

    await renderPage();
    await openChangePlan();
    await pick("Growth");
    await submit();

    await waitFor(() => {
      expect(putSpy).toHaveBeenCalledTimes(1);
    }, WAIT);

    expect(sentRequest().url.toString()).toContain(
      `/project/${PROJECT_ID}/admin-change-plan`,
    );
    // Opened at Monthly, the period of the plan the project was on.
    expect(sentRequest().data).toEqual({
      data: { paymentProviderPlanId: "price_growth_month" },
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    }, WAIT);

    expect(screen.getByText("Plan changed to Growth.")).toBeInTheDocument();

    await waitFor(() => {
      expect(within(cardPlan()).getByText("Growth")).toBeInTheDocument();
    }, WAIT);
  });

  test("Yearly sends the plan's yearly price", async () => {
    onProject({ planId: "price_growth_month" });

    await renderPage();
    await openChangePlan();

    fireEvent.click(within(dialog()).getByTestId("plan-picker-period-yearly"));
    await flush();
    await pick("Scale");
    await submit();

    await waitFor(() => {
      expect(putSpy).toHaveBeenCalledTimes(1);
    }, WAIT);
    expect(sentRequest().data).toEqual({
      data: { paymentProviderPlanId: "price_scale_year" },
    });
  });

  test("the custom-priced plan can be picked: staff set it once sales agree a price", async () => {
    onProject({ planId: "price_scale_month" });

    await renderPage();
    await openChangePlan();
    await pick("Enterprise");
    await submit();

    await waitFor(() => {
      expect(putSpy).toHaveBeenCalledTimes(1);
    }, WAIT);
    expect(sentRequest().data).toEqual({
      data: { paymentProviderPlanId: "price_enterprise_month" },
    });
    await waitFor(() => {
      expect(
        screen.getByText("Plan changed to Enterprise."),
      ).toBeInTheDocument();
    }, WAIT);
  });

  test("a refused change keeps the dialog open, with the plan picked and why", async () => {
    const why: string =
      "This project has no payment method, and its plan cannot change without one. Ask a Project Owner to add one under Project Settings > Billing and Invoices > Billing, then try again.";

    onProject({ planId: "price_free_month" });
    changesAreRefused(why);

    await renderPage();
    await openChangePlan();
    await pick("Growth");
    await submit();

    await waitFor(() => {
      expect(within(dialog()).getByText(why)).toBeInTheDocument();
    }, WAIT);

    expect(option("Growth")).toHaveAttribute("data-selected", "true");
    expect(screen.queryByText("Plan changed to Growth.")).toBeNull();
    expect(within(cardPlan()).getByText("Free")).toBeInTheDocument();
  });

  test("a project a cloud marketplace bills sees the monthly prices alone", async () => {
    onProject({
      planId: "price_growth_month",
      marketplace: CloudMarketplace.AWS,
    });

    await renderPage();
    await openChangePlan();

    expect(
      within(dialog()).queryByTestId("plan-picker-period-yearly"),
    ).toBeNull();
    expect(
      within(dialog()).queryByTestId("plan-picker-period-monthly"),
    ).toBeNull();

    await pick("Scale");
    await submit();

    await waitFor(() => {
      expect(putSpy).toHaveBeenCalledTimes(1);
    }, WAIT);
    expect(sentRequest().data).toEqual({
      data: { paymentProviderPlanId: "price_scale_month" },
    });
  });

  test("closing the dialog changes nothing", async () => {
    onProject({ planId: "price_free_month" });

    await renderPage();
    await openChangePlan();
    await pick("Scale");

    fireEvent.click(within(dialog()).getByTestId("modal-footer-close-button"));
    await flush();

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    }, WAIT);
    expect(putSpy).not.toHaveBeenCalled();
    expect(within(cardPlan()).getByText("Free")).toBeInTheDocument();
  });

  test("German: the button, the dialog and the refusal in German", async () => {
    onProject({ planId: "price_free_month" });

    await renderPage("de");
    await openChangePlan("Tarif ändern");

    expect(screen.getByTestId("modal-title")).toHaveTextContent("Tarif ändern");
    expect(
      within(dialog()).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Tarif ändern");

    await submit();

    await waitFor(() => {
      expect(
        within(dialog()).getByText(
          "Das Projekt ist bereits in diesem Tarif. Wählen Sie einen anderen Tarif, zu dem Sie wechseln möchten.",
        ),
      ).toBeInTheDocument();
    }, WAIT);
  });
});
