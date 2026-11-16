import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
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
 * ADMIN DASHBOARD > PROJECTS > (PROJECT) > SUBSCRIPTION, BEFORE EXTEND TRIAL.
 *
 * Customers usually ask for more time once their trial has already turned
 * into a paid subscription. Extending the trial then waives the usage they
 * have accrued in the current billing period - the payment provider clears it
 * instead of invoicing it - and the page says so before the admin opens the
 * form. It used to warn that the customer would be invoiced for that usage
 * straight away, which is what extending a trial no longer does.
 *
 * A project still on its trial has no paid usage to waive, and is told
 * nothing.
 *
 * The admin API, the page chrome and the side menu are stand-ins; the page
 * and its locales are real.
 */

jest.setTimeout(60000);

const PROJECT_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194165003";

// Generous: these draw the real card, on a CI box that may be busy.
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

// The page is billing-only.
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
    return {
      SUBSCRIPTION_PLAN_GROWTH:
        "Growth,price_growth_month,price_growth_year,22,20,2,14",
    };
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
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import SubscriptionStatus from "../../../Types/Billing/SubscriptionStatus";
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

type Locale = {
  pages: { projectSubscription: Record<string, string> };
};

function readLocale(locale: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Locale;
}

// The notice, as the locale words it.
function noticeIn(locale: string): string {
  const notice: string | undefined =
    readLocale(locale).pages.projectSubscription["notTrialingUsageWaived"];

  if (!notice) {
    throw new Error(`The ${locale} locale has no notTrialingUsageWaived.`);
  }

  return notice;
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

// The project as the server holds it: on Growth, its trial ended or not.
function onProject(meteredSubscriptionStatus: SubscriptionStatus): void {
  mockGetItem.mockImplementation(async (): Promise<Project> => {
    const project: Project = new Project();
    project._id = PROJECT_ID;
    project.name = "Acme Production";
    project.paymentProviderPlanId = "price_growth_month";
    project.planName = PlanType.Growth;
    project.paymentProviderSubscriptionStatus =
      meteredSubscriptionStatus === SubscriptionStatus.Trialing
        ? SubscriptionStatus.Trialing
        : SubscriptionStatus.PastDue;
    project.paymentProviderMeteredSubscriptionStatus =
      meteredSubscriptionStatus;

    return project;
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

async function renderPage(locale: string = "en"): Promise<void> {
  const instance: i18n = await instanceFor(locale);

  render(
    <I18nextProvider i18n={instance}>
      <ProjectSubscription />
    </I18nextProvider>,
  );

  await flush();

  // The card has read the project, so the page knows whether it is trialing.
  await waitFor(() => {
    expect(mockGetItem).toHaveBeenCalled();

    const card: HTMLElement | null = document.querySelector(
      "#model-detail-project-subscription",
    );

    expect(card).not.toBeNull();
    expect(within(card!).getByText(PlanType.Growth)).toBeInTheDocument();
  }, WAIT);
}

describe("Admin > Project > Subscription > the usage an extension waives", () => {
  beforeEach(() => {
    window.history.pushState(
      {},
      "",
      `/admin/projects/${PROJECT_ID}/subscription`,
    );
    mockGetItem.mockReset();
    getJestSpyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("a project whose trial turned into a paid subscription is told its usage is waived", async () => {
    onProject(SubscriptionStatus.Active);

    await renderPage();

    const notice: HTMLElement = await screen.findByText(
      noticeIn("en"),
      {},
      WAIT,
    );

    expect(notice).toBeInTheDocument();
    expect(noticeIn("en")).toContain("waives the usage");
  });

  test("the notice is information, not a warning", async () => {
    onProject(SubscriptionStatus.Active);

    await renderPage();

    const notice: HTMLElement = await screen.findByText(
      noticeIn("en"),
      {},
      WAIT,
    );
    const alert: HTMLElement | null = notice.closest("[role='alert']");

    expect(alert).not.toBeNull();
    expect(alert!.className).toContain("bg-blue-50");
    expect(alert!.className).not.toContain("bg-amber-50");
  });

  test("a past_due metered subscription is told the same", async () => {
    onProject(SubscriptionStatus.PastDue);

    await renderPage();

    expect(
      await screen.findByText(noticeIn("en"), {}, WAIT),
    ).toBeInTheDocument();
  });

  test("the page no longer says the customer will be invoiced for that usage", async () => {
    onProject(SubscriptionStatus.Active);

    await renderPage();

    await screen.findByText(noticeIn("en"), {}, WAIT);

    expect(document.body.textContent).not.toContain("invoiced straight away");
    expect(document.body.textContent).not.toContain("notTrialing");
  });

  test("a project still on its trial is told nothing", async () => {
    onProject(SubscriptionStatus.Trialing);

    await renderPage();

    expect(screen.queryByText(noticeIn("en"))).not.toBeInTheDocument();
  });

  test("the notice reads in the admin's language", async () => {
    onProject(SubscriptionStatus.Active);

    await renderPage("de");

    expect(noticeIn("de")).not.toEqual(noticeIn("en"));
    expect(
      await screen.findByText(noticeIn("de"), {}, WAIT),
    ).toBeInTheDocument();
  });
});
