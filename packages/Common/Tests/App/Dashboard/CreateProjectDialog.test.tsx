import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Create New Project dialog (Dashboard > project picker, and the welcome
 * page after sign-up), drawn for real - DashboardProjectPicker, ModelFormModal,
 * ModelForm, BasicForm, the plan picker - with only the network, the
 * deployment's settings, analytics and the signed-in user stubbed.
 *
 * The maintainer: "Can we improve this model and make it easier for people
 * to understand? Hide the promo code in advanced options." It walked two
 * steps (Basic, Select Plan) for three fields, stacked the plans over a
 * "Yearly Plan (Save 20%)" switch, and showed the promo code to everyone.
 * Now:
 *
 *   - one page, with no steps and no Next, billing or not;
 *   - self-hosted, it asks for the name alone;
 *   - on OneUptime Cloud, the plans are one comparison under a Monthly |
 *     Yearly switch, Free is picked to start with, and a line under them says
 *     what the picked plan costs and when;
 *   - the promo code is folded under More fields; one from the sign-up link
 *     is filled in, shown on the folded header, and can be changed;
 *   - what is sent is the plan's Stripe price for the period shown.
 */

let billingEnabled: boolean = true;

// As configured on OneUptime Cloud (packages/Common/test-setup.sh).
const CLOUD_PLAN_ENV: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,price_free_month,price_free_year,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_growth_month,price_growth_year,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_scale_month,price_scale_year,99,84,3,14",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,price_enterprise_month,price_enterprise_year,-1,-1,4,14",
};

// A deployment that sells only paid plans: nothing is picked for anyone.
const PAID_ONLY_PLAN_ENV: Record<string, string> = {
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_growth_month,price_growth_year,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_scale_month,price_scale_year,99,84,3,14",
};

let planEnv: Record<string, string> = CLOUD_PLAN_ENV;

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
    return planEnv;
  };
  return config;
});

jest.mock("../../../UI/Utils/Permission", () => {
  const actualPermission: Record<string, unknown> = jest.requireActual(
    "../../../Types/Permission",
  ) as Record<string, unknown>;
  const PermissionEnum: Record<string, string> = actualPermission[
    "default"
  ] as Record<string, string>;
  // A signed-in user who belongs to no project yet.
  const granted: Array<string> = [
    PermissionEnum["User"]!,
    PermissionEnum["CurrentUser"]!,
    PermissionEnum["Public"]!,
  ];

  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return granted;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: granted };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/GlobalConfig", () => {
  return {
    __esModule: true,
    default: {
      fetchVars: async (): Promise<{ disableUserProjectCreation: boolean }> => {
        return { disableUserProjectCreation: false };
      },
    },
  };
});

const captureRevenueEventMock: MockFunction = getJestMockFunction();
const capturePurchaseMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/Analytics", () => {
  return {
    __esModule: true,
    default: {
      capture: () => {},
      captureRevenueEvent: (...args: Array<unknown>) => {
        return captureRevenueEventMock(...args);
      },
      capturePurchase: (...args: Array<unknown>) => {
        return capturePurchaseMock(...args);
      },
    },
  };
});

const createOrUpdateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async (): Promise<{ data: Array<unknown>; count: number }> => {
        return { data: [], count: 0 };
      },
      count: async (): Promise<number> => {
        return 0;
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
      createOrUpdate: (...args: Array<unknown>) => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

import DashboardProjectPicker from "../../../../App/FeatureSet/Dashboard/src/Components/Header/ProjectPicker";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { RevenueEventName } from "../../../Types/Analytics/RevenueEvent";
import { PRICING_PAGE_URL } from "../../../Types/Billing/PayAsYouGoPricing";
import {
  listedNames,
  setChips,
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";

const NEW_PROJECT_ID: string = "6c1f0a0e-1111-4c1e-9a1e-000000000001";

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const german: i18n = createInstance();

beforeAll(async () => {
  await german.init({
    lng: "de",
    fallbackLng: "de",
    resources: {
      de: {
        translation: JSON.parse(
          fs.readFileSync(path.join(LOCALES_DIR, "de.json"), "utf8"),
        ) as Record<string, string>,
      },
    },
    interpolation: { escapeValue: false },
  });
});

const onProjectSelectedMock: MockFunction = getJestMockFunction();
const onProjectModalCloseMock: MockFunction = getJestMockFunction();

interface SentProject {
  name: unknown;
  paymentProviderPlanId: unknown;
  paymentProviderPromoCode: unknown;
}

function sentProjects(): Array<SentProject> {
  return createOrUpdateMock.mock.calls.map(
    (call: Array<unknown>): SentProject => {
      const data: { model: Project } = call[0] as { model: Project };

      return {
        name: data.model.name,
        paymentProviderPlanId: data.model.paymentProviderPlanId,
        paymentProviderPromoCode: data.model.paymentProviderPromoCode,
      };
    },
  );
}

function sentRequestOptions(): Record<string, unknown> {
  const data: { requestOptions: Record<string, unknown> } = createOrUpdateMock
    .mock.calls[0]![0] as { requestOptions: Record<string, unknown> };

  return data.requestOptions;
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 5; i++) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }
  });
}

async function openDialog(language?: i18n): Promise<void> {
  const Wrapper: (props: { children?: ReactNode }) => ReactElement = (props: {
    children?: ReactNode;
  }): ReactElement => {
    return language ? (
      <I18nextProvider i18n={language}>{props.children}</I18nextProvider>
    ) : (
      <>{props.children}</>
    );
  };

  render(
    <MemoryRouter>
      <DashboardProjectPicker
        projects={[]}
        showProjectModal={true}
        onProjectModalClose={() => {
          onProjectModalCloseMock();
        }}
        onProjectSelected={(project: Project) => {
          onProjectSelectedMock(project);
        }}
        selectedProject={null}
      />
    </MemoryRouter>,
    { wrapper: Wrapper },
  );

  await screen.findByTestId("modal");
  await screen.findByLabelText(
    language ? language.t("Project Name") : "Project Name",
  );
  await settle();
}

function dialog(): HTMLElement {
  return screen.getByTestId("modal");
}

function nameInput(): HTMLInputElement {
  return within(dialog()).getByLabelText("Project Name") as HTMLInputElement;
}

async function typeName(name: string): Promise<void> {
  await act(async () => {
    fireEvent.change(nameInput(), { target: { value: name } });
  });
  await settle();
}

function planRadio(planName: string): HTMLInputElement {
  return within(dialog()).getByRole("radio", {
    name: planName,
  }) as HTMLInputElement;
}

async function pickPlan(planName: string): Promise<void> {
  await act(async () => {
    fireEvent.click(planRadio(planName));
  });
  await settle();
}

async function pressPeriod(period: "monthly" | "yearly"): Promise<void> {
  await act(async () => {
    fireEvent.click(
      within(dialog()).getByTestId(`plan-picker-period-${period}`),
    );
  });
  await settle();
}

function termsText(): string {
  return (
    within(dialog()).queryByTestId("plan-picker-terms")?.textContent || ""
  ).replace(/\s+/g, " ");
}

function moreFieldsHeader(): HTMLElement {
  return within(dialog()).getByTestId("folded-section-header");
}

async function openMoreFields(): Promise<void> {
  await act(async () => {
    fireEvent.click(
      within(dialog()).getByRole("button", { name: /More fields/ }),
    );
  });
  await settle();
}

// In the page while folded (a folded field keeps its value), but hidden.
function promoInput(): HTMLInputElement | null {
  return within(dialog()).queryByLabelText(
    /Promo Code/,
  ) as HTMLInputElement | null;
}

async function pressCreate(): Promise<void> {
  await act(async () => {
    fireEvent.click(within(dialog()).getByTestId("modal-footer-submit-button"));
  });
  await settle();
}

function createdProjectJSON(data: {
  name: string;
  planId: string;
}): Record<string, unknown> {
  return {
    _id: NEW_PROJECT_ID,
    name: data.name,
    paymentProviderPlanId: data.planId,
  };
}

beforeEach(() => {
  billingEnabled = true;
  planEnv = CLOUD_PLAN_ENV;
  window.localStorage.clear();
  createOrUpdateMock.mockReset();
  captureRevenueEventMock.mockReset();
  capturePurchaseMock.mockReset();
  onProjectSelectedMock.mockReset();
  onProjectModalCloseMock.mockReset();

  createOrUpdateMock.mockImplementation(async (...args: Array<unknown>) => {
    const data: { model: Project } = args[0] as { model: Project };

    return {
      data: createdProjectJSON({
        name: data.model.name || "",
        planId: data.model.paymentProviderPlanId || "",
      }),
      miscData: {},
    };
  });
});

afterEach(() => {
  cleanup();
});

describe("Create New Project, self-hosted (billing off)", () => {
  beforeEach(() => {
    billingEnabled = false;
  });

  test("asks for the project name alone, on one page", async () => {
    await openDialog();

    expect(within(dialog()).getByText("Create New Project")).toBeVisible();
    expect(
      within(dialog()).getByText(
        "A project holds your monitors, incidents, status pages and team.",
      ),
    ).toBeVisible();
    expect(
      within(dialog()).getByText(
        "Such as your company or team name. You can change it later.",
      ),
    ).toBeVisible();
    expect(nameInput()).toHaveAttribute("placeholder", "My Project");

    // No plan, no promo code, no fold, no steps.
    expect(within(dialog()).queryByTestId("plan-picker")).toBeNull();
    expect(within(dialog()).queryAllByRole("radio")).toHaveLength(0);
    expect(within(dialog()).queryByText(/More fields/)).toBeNull();
    expect(promoInput()).toBeNull();
    expect(
      within(dialog()).queryByRole("navigation", { name: "Progress" }),
    ).toBeNull();
    expect(
      within(dialog()).queryByTestId("modal-footer-next-button"),
    ).toBeNull();
    expect(
      within(dialog()).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Create Project");
  });

  test("creates the project with its name only, as a request of no project", async () => {
    await openDialog();
    await typeName("Acme Production");
    await pressCreate();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });
    expect(sentProjects()).toEqual([
      {
        name: "Acme Production",
        paymentProviderPlanId: undefined,
        paymentProviderPromoCode: undefined,
      },
    ]);
    expect(sentRequestOptions()["isMultiTenantRequest"]).toBe(true);

    await waitFor(() => {
      expect(screen.queryByTestId("modal")).toBeNull();
    });
    expect(onProjectSelectedMock).toHaveBeenCalledTimes(1);
    expect(
      (onProjectSelectedMock.mock.calls[0]![0] as Project).id?.toString(),
    ).toBe(NEW_PROJECT_ID);
  });

  test("is the narrow dialog it always was", async () => {
    await openDialog();

    expect(dialog()).toHaveClass("sm:max-w-lg");
    expect(dialog()).not.toHaveClass("sm:max-w-3xl");
  });
});

describe("Create New Project, OneUptime Cloud (billing on)", () => {
  test("is one page: name, plan and More fields, with no steps and no Next", async () => {
    await openDialog();

    expect(nameInput()).toBeVisible();
    expect(within(dialog()).getByTestId("plan-picker")).toBeVisible();
    expect(listedNames(moreFieldsHeader())).toEqual(["Promo Code"]);

    expect(
      within(dialog()).queryByRole("navigation", { name: "Progress" }),
    ).toBeNull();
    expect(within(dialog()).queryByText("Basic")).toBeNull();
    expect(within(dialog()).queryByText("Select Plan")).toBeNull();
    expect(
      within(dialog()).queryByTestId("modal-footer-next-button"),
    ).toBeNull();
    expect(
      within(dialog()).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Create Project");

    // Room for the plans side by side with their prices.
    expect(dialog()).toHaveClass("sm:max-w-3xl");
  });

  test("never says the old words", async () => {
    await openDialog();
    const text: string = dialog().textContent || "";

    for (const retired of [
      "Please create a new OneUptime project to get started.",
      "Please select a plan.",
      "Yearly Plan",
      "Save 20%",
      "Pick a friendly name.",
      "If you have a coupon code, enter it here.",
      "Our sales team will contact you soon.",
      "This plan is free, forever.",
      "/mo billed yearly",
    ]) {
      expect({ retired, shown: text.includes(retired) }).toEqual({
        retired,
        shown: false,
      });
    }
  });

  test("lists every plan the deployment sells, in its order, with Free picked", async () => {
    await openDialog();

    const radios: Array<HTMLInputElement> = within(dialog()).getAllByRole(
      "radio",
    ) as Array<HTMLInputElement>;

    expect(
      radios.map((radio: HTMLInputElement): string => {
        return radio.getAttribute("aria-labelledby")
          ? document.getElementById(radio.getAttribute("aria-labelledby")!)!
              .textContent || ""
          : "";
      }),
    ).toEqual(["Free", "Growth", "Scale", "Enterprise"]);

    expect(planRadio("Free")).toBeChecked();
    expect(planRadio("Growth")).not.toBeChecked();
    expect(termsText()).toContain("Free forever.");
    expect(termsText()).toContain(
      "Active monitors and telemetry are pay as you go, and need a payment method.",
    );
  });

  test("creates a Free project with the yearly Free price when nothing else is touched", async () => {
    await openDialog();
    await typeName("Acme Production");
    await pressCreate();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });
    expect(sentProjects()).toEqual([
      {
        name: "Acme Production",
        paymentProviderPlanId: "price_free_year",
        paymentProviderPromoCode: undefined,
      },
    ]);

    // A free project is an activation, not a paid conversion.
    await waitFor(() => {
      expect(onProjectSelectedMock).toHaveBeenCalledTimes(1);
    });
    expect(
      captureRevenueEventMock.mock.calls.map((call: Array<unknown>) => {
        return call[0];
      }),
    ).toEqual([RevenueEventName.WorkspaceCreated]);
    expect(capturePurchaseMock).not.toHaveBeenCalled();
  });

  test("sends the picked plan's yearly price, and reports the paid conversion", async () => {
    await openDialog();
    await typeName("Acme Production");
    await pickPlan("Growth");

    expect(planRadio("Growth")).toBeChecked();
    expect(planRadio("Free")).not.toBeChecked();
    expect(termsText()).toContain("Free for 14 days, no card needed to start.");
    expect(termsText()).toContain("Then $240 per user, billed yearly.");

    await pressCreate();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });
    expect(sentProjects()[0]!.paymentProviderPlanId).toBe("price_growth_year");

    await waitFor(() => {
      expect(capturePurchaseMock).toHaveBeenCalledTimes(1);
    });
    const events: Array<unknown> = captureRevenueEventMock.mock.calls.map(
      (call: Array<unknown>) => {
        return call[0];
      },
    );
    expect(events).toEqual([
      RevenueEventName.WorkspaceCreated,
      RevenueEventName.SubscriptionStarted,
    ]);
    const started: Record<string, unknown> = captureRevenueEventMock.mock
      .calls[1]![1] as Record<string, unknown>;
    expect(started["plan"]).toBe("Growth");
    // The yearly price is quoted per month.
    expect(started["value"]).toBe(20);
  });

  test("Monthly shows the monthly prices and sends the monthly price of the same plan", async () => {
    await openDialog();
    await typeName("Acme Production");
    await pickPlan("Scale");
    await pressPeriod("monthly");

    expect(planRadio("Scale")).toBeChecked();
    expect(
      within(dialog()).getByTestId("plan-picker-period-monthly"),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(
        within(dialog()).getByTestId("plan-picker-option-Scale"),
      ).getByText("$99"),
    ).toBeVisible();
    expect(termsText()).toContain("Then $99 per user, billed monthly.");

    await pressCreate();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });
    expect(sentProjects()[0]!.paymentProviderPlanId).toBe("price_scale_month");
  });

  test("switching back to Yearly keeps the plan and its yearly price", async () => {
    await openDialog();
    await typeName("Acme Production");
    await pickPlan("Growth");
    await pressPeriod("monthly");
    await pressPeriod("yearly");

    expect(planRadio("Growth")).toBeChecked();
    expect(termsText()).toContain("Then $240 per user, billed yearly.");

    await pressCreate();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });
    expect(sentProjects()[0]!.paymentProviderPlanId).toBe("price_growth_year");
  });

  test("says what yearly saves from the real prices: up to 15%, not 20%", async () => {
    await openDialog();

    expect(
      within(dialog()).getByTestId("plan-picker-saving"),
    ).toHaveTextContent("Save up to 15%");
  });

  test("Enterprise says the sales team agrees on the price, and is created on its yearly price", async () => {
    await openDialog();
    await typeName("Acme Production");
    await pickPlan("Enterprise");

    expect(
      within(
        within(dialog()).getByTestId("plan-picker-option-Enterprise"),
      ).getByText("Custom Price"),
    ).toBeVisible();
    expect(termsText()).toContain("Free for 14 days.");
    expect(termsText()).toContain(
      "Our sales team will contact you to agree on a price.",
    );

    await pressCreate();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });
    expect(sentProjects()[0]!.paymentProviderPlanId).toBe(
      "price_enterprise_year",
    );
  });

  test("the compare link opens the pricing page in a new tab", async () => {
    await openDialog();
    const link: HTMLElement = within(dialog()).getByTestId(
      "plan-picker-compare-plans",
    );

    expect(link).toHaveTextContent("Compare plans");
    expect(link.getAttribute("href")).toBe(PRICING_PAGE_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });
});

describe("Create New Project: the promo code is folded under More fields", () => {
  test("is not shown until More fields is opened, and is optional", async () => {
    await openDialog();

    expect(promoInput()).not.toBeVisible();
    expect(
      within(dialog()).getByTestId("folded-section-header"),
    ).toHaveAttribute("aria-expanded", "false");
    expect(listedNames(moreFieldsHeader())).toEqual(["Promo Code"]);
    expect(setChips(moreFieldsHeader())).toEqual([]);

    await openMoreFields();

    expect(promoInput()).toBeVisible();
    expect(promoInput()).not.toBeDisabled();
    expect(
      within(dialog()).getByText(
        "If you have one, from an offer or a reseller.",
      ),
    ).toBeVisible();
    expect(within(dialog()).getByText("(Optional)")).toBeVisible();
  });

  test("a code typed in is sent with the project", async () => {
    await openDialog();
    await typeName("Acme Production");
    await pickPlan("Growth");
    await openMoreFields();

    await act(async () => {
      fireEvent.change(promoInput()!, { target: { value: "LAUNCH25" } });
    });
    await settle();
    await pressCreate();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });
    expect(sentProjects()).toEqual([
      {
        name: "Acme Production",
        paymentProviderPlanId: "price_growth_year",
        paymentProviderPromoCode: "LAUNCH25",
      },
    ]);
  });

  test("a code from the sign-up link is filled in, shown on the folded header, and sent", async () => {
    window.localStorage.setItem("promoCode", JSON.stringify("PARTNER-KR"));

    await openDialog();

    expect(setChips(moreFieldsHeader())).toEqual(["Promo Code: PARTNER-KR"]);

    await typeName("Acme Production");
    await pressCreate();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });
    expect(sentProjects()[0]!.paymentProviderPromoCode).toBe("PARTNER-KR");

    // Used once: the next project starts without it.
    await waitFor(() => {
      expect(window.localStorage.getItem("promoCode")).toBeNull();
    });
  });

  test("a code from the sign-up link can be cleared, so one that no longer applies cannot block every project", async () => {
    window.localStorage.setItem("promoCode", JSON.stringify("EXPIRED10"));

    await openDialog();
    await openMoreFields();

    expect(promoInput()!.value).toBe("EXPIRED10");
    expect(promoInput()).not.toBeDisabled();

    await act(async () => {
      fireEvent.change(promoInput()!, { target: { value: "" } });
    });
    await settle();
    await typeName("Acme Production");
    await pressCreate();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });
    expect(sentProjects()[0]!.paymentProviderPromoCode || "").toBe("");
  });

  /*
   * The server's answer is about the code, so it is said under the code:
   * More fields opens on it, where it can be changed or cleared. It used to
   * be said at the top of the dialog while the code stayed folded away.
   */
  test("a refused code opens More fields and says why under the code, keeping what was typed", async () => {
    createOrUpdateMock.mockImplementation(async () => {
      throw new HTTPErrorResponse(
        400,
        { message: "Promo code is invalid." },
        {},
      );
    });
    window.localStorage.setItem("promoCode", JSON.stringify("OLD10"));

    await openDialog();
    await typeName("Acme Production");
    await pressCreate();

    await waitFor(() => {
      expect(promoInput()).toBeVisible();
    });
    expect(moreFieldsHeader()).toHaveAttribute("aria-expanded", "true");
    expect(promoInput()!.value).toBe("OLD10");
    expect(promoInput()).toHaveAttribute("aria-invalid", "true");
    expect(promoInput()).toHaveAccessibleDescription(
      "If you have one, from an offer or a reseller. Promo code is invalid.",
    );
    // Said once, under the code - not again at the top of the dialog.
    expect(
      within(dialog()).getAllByText("Promo code is invalid."),
    ).toHaveLength(1);
    expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    expect(nameInput().value).toBe("Acme Production");
    expect(planRadio("Free")).toBeChecked();
    expect(onProjectSelectedMock).not.toHaveBeenCalled();
    // Kept for the next try.
    expect(window.localStorage.getItem("promoCode")).not.toBeNull();
  });

  test("changing the refused code puts the message away, and a cleared code creates the project", async () => {
    createOrUpdateMock.mockImplementationOnce(async () => {
      throw new HTTPErrorResponse(
        400,
        { message: "This promocode has already been used." },
        {},
      );
    });
    window.localStorage.setItem("promoCode", JSON.stringify("USED10"));

    await openDialog();
    await typeName("Acme Production");
    await pressCreate();

    await waitFor(() => {
      expect(
        within(dialog()).getByText("This promocode has already been used."),
      ).toBeVisible();
    });

    await act(async () => {
      fireEvent.change(promoInput()!, { target: { value: "" } });
    });
    await settle();

    expect(
      within(dialog()).queryByText("This promocode has already been used."),
    ).toBeNull();
    expect(promoInput()).not.toHaveAttribute("aria-invalid");

    await pressCreate();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(2);
    });
    expect(sentProjects()[1]!.paymentProviderPromoCode || "").toBe("");
  });

  test("the refused code is brought into view as More fields opens on it", async () => {
    const scrolled: Array<Element> = [];
    const scrollIntoView: unknown = Element.prototype.scrollIntoView;

    Element.prototype.scrollIntoView = function (this: Element): void {
      scrolled.push(this);
    };

    try {
      createOrUpdateMock.mockImplementation(async () => {
        throw new HTTPErrorResponse(
          400,
          { message: "Promo code is invalid." },
          {},
        );
      });
      window.localStorage.setItem("promoCode", JSON.stringify("OLD10"));

      await openDialog();
      await typeName("Acme Production");
      await pressCreate();

      await waitFor(() => {
        expect(promoInput()).toBeVisible();
      });

      expect(
        scrolled.some((element: Element): boolean => {
          return element.contains(promoInput());
        }),
      ).toBe(true);
    } finally {
      Element.prototype.scrollIntoView =
        scrollIntoView as typeof Element.prototype.scrollIntoView;
    }
  });
});

describe("Create New Project: answers from the server", () => {
  test("a name another of the reader's projects has is said under the name", async () => {
    createOrUpdateMock.mockImplementation(async () => {
      throw new HTTPErrorResponse(
        400,
        { message: "Project with the same name already exists" },
        {},
      );
    });

    await openDialog();
    await typeName("Acme Production");
    await pressCreate();

    await waitFor(() => {
      expect(nameInput()).toHaveAttribute("aria-invalid", "true");
    });
    expect(nameInput()).toHaveAccessibleDescription(
      "Such as your company or team name. You can change it later. Project with the same name already exists",
    );
    expect(
      within(dialog()).getAllByText(
        "Project with the same name already exists",
      ),
    ).toHaveLength(1);
    // Nothing about the promo code: More fields stays folded.
    expect(moreFieldsHeader()).toHaveAttribute("aria-expanded", "false");
  });

  test("an answer about nothing on the form stays above the form", async () => {
    createOrUpdateMock.mockImplementation(async () => {
      throw new HTTPErrorResponse(
        500,
        { message: "Server error. Please try again." },
        {},
      );
    });

    await openDialog();
    await typeName("Acme Production");
    await pressCreate();

    await waitFor(() => {
      expect(
        within(dialog()).getByText("Server error. Please try again."),
      ).toBeVisible();
    });
    expect(nameInput()).not.toHaveAttribute("aria-invalid");
    expect(moreFieldsHeader()).toHaveAttribute("aria-expanded", "false");
  });
});

/*
 * A field says what is wrong once it has been changed and left, or once
 * Create Project is pressed - not because the reader moved through it. The
 * name takes the focus as the dialog opens, and picking a plan or opening
 * More fields first used to say "Project Name is required." before anything
 * was typed.
 */
describe("Create New Project: errors wait for a change or for Create Project", () => {
  test("picking a plan before typing a name says nothing about the name", async () => {
    await openDialog();

    act(() => {
      nameInput().focus();
    });
    await act(async () => {
      fireEvent.blur(nameInput());
    });
    await pickPlan("Growth");

    expect(
      within(dialog()).queryByText("Project Name is required."),
    ).toBeNull();
    expect(nameInput()).not.toHaveAttribute("aria-invalid");
  });

  test("opening More fields first says nothing about the name", async () => {
    await openDialog();

    await act(async () => {
      fireEvent.blur(nameInput());
    });
    await openMoreFields();

    expect(
      within(dialog()).queryByText("Project Name is required."),
    ).toBeNull();
  });

  test("a name typed, emptied and left says it is required", async () => {
    await openDialog();
    await typeName("Acme");
    await typeName("");

    await act(async () => {
      fireEvent.blur(nameInput());
    });

    expect(
      within(dialog()).getByText("Project Name is required."),
    ).toBeVisible();
    expect(nameInput()).toHaveAttribute("aria-invalid", "true");
  });

  test("a name too short says so once it is left", async () => {
    await openDialog();
    await typeName("A");

    expect(
      within(dialog()).queryByText(
        "Project Name cannot be less than 2 characters.",
      ),
    ).toBeNull();

    await act(async () => {
      fireEvent.blur(nameInput());
    });

    expect(
      within(dialog()).getByText(
        "Project Name cannot be less than 2 characters.",
      ),
    ).toBeVisible();
  });
});

describe("Create New Project: what it refuses before sending", () => {
  test("a missing name", async () => {
    await openDialog();
    await pressCreate();

    expect(
      within(dialog()).getByText("Project Name is required."),
    ).toBeVisible();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("a name of one character", async () => {
    await openDialog();
    await typeName("A");
    await pressCreate();

    expect(createOrUpdateMock).not.toHaveBeenCalled();
    expect(
      within(dialog()).getByText(
        "Project Name cannot be less than 2 characters.",
      ),
    ).toBeVisible();
  });

  // Two characters are a name, as everywhere else in the product.
  test.each(["QA", "IBM"])(
    "takes a short real name: %s",
    async (name: string) => {
      await openDialog();
      await typeName(name);
      await pressCreate();

      await waitFor(() => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      });
      expect(sentProjects()[0]!.name).toBe(name);
    },
  );

  test("no plan, where every plan costs money and none is picked for you", async () => {
    planEnv = PAID_ONLY_PLAN_ENV;

    await openDialog();

    expect(planRadio("Growth")).not.toBeChecked();
    expect(planRadio("Scale")).not.toBeChecked();
    expect(within(dialog()).queryByTestId("plan-picker-terms")).toBeNull();

    await typeName("Acme Production");
    await pressCreate();

    expect(createOrUpdateMock).not.toHaveBeenCalled();
    expect(
      within(within(dialog()).getByTestId("plan-picker")).getByRole("alert"),
    ).toHaveTextContent("Plan is required.");

    await pickPlan("Growth");
    await pressCreate();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });
    expect(sentProjects()[0]!.paymentProviderPlanId).toBe("price_growth_year");
  });
});

describe("Create New Project, in the reader's language", () => {
  test("German: the plan picker, its prices and its terms are translated", async () => {
    await openDialog(german);

    const picker: HTMLElement = within(dialog()).getByTestId("plan-picker");

    expect(within(picker).getByText(german.t("Plan"))).toBeVisible();
    expect(german.t("Plan")).toBe("Tarif");
    expect(within(picker).getByText("Monatlich")).toBeVisible();
    expect(within(picker).getByText("Jährlich")).toBeVisible();
    expect(within(picker).getByTestId("plan-picker-saving")).toHaveTextContent(
      "Bis zu 15 % sparen",
    );
    expect(
      within(within(picker).getByTestId("plan-picker-option-Growth")).getByText(
        "14 Tage kostenlos testen",
      ),
    ).toBeVisible();
    expect(
      within(within(picker).getByTestId("plan-picker-option-Growth")).getByText(
        "pro Benutzer / Monat",
      ),
    ).toBeVisible();
    expect(termsText()).toContain("Für immer kostenlos.");

    await act(async () => {
      fireEvent.click(within(picker).getByRole("radio", { name: "Growth" }));
    });
    await settle();

    expect(termsText()).toContain(
      "14 Tage kostenlos, zum Start ist keine Karte nötig.",
    );
    expect(termsText()).toContain(
      "Danach $240 pro Benutzer, jährlich abgerechnet.",
    );
  });
});
