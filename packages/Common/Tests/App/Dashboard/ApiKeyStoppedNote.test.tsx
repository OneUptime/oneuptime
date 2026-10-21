import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";

/*
 * An API key's own page, for a project known to be below the plan API keys
 * need: the key stopped working - every request made with it is refused
 * until the project is back on the plan (Common/Types/Billing/
 * PlanCutoffCredentials) - an upgrade turns it back on as it is, and it can
 * still be deleted (Dashboard Components/Billing/ApiKeyStoppedNote).
 *
 * Billing and the plan are pinned in every test (CI's config.env sets
 * BILLING_ENABLED=true).
 */

let billingEnabledForTest: boolean = false;
let currentPlanForTest: string | null = null;

const CLOUD_PLAN_ENV: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,priceMonthlyId1,priceYearlyId1,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH: "Growth,priceMonthlyId2,priceYearlyId2,0,0,2,14",
  SUBSCRIPTION_PLAN_SCALE: "Scale,priceMonthlyId3,priceYearlyId3,0,0,3,0",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,priceMonthlyId4,priceYearlyId4,-1,-1,4,14",
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
    return CLOUD_PLAN_ENV;
  };

  return mocked;
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): string => {
        return "82000000-0000-4000-8000-000000000001";
      },
      getCurrentPlan: (): string | null => {
        return currentPlanForTest;
      },
    },
  };
});

import ApiKeyStoppedNote from "../../../../App/FeatureSet/Dashboard/src/Components/Billing/ApiKeyStoppedNote";
import PlanLeftoverCopy, {
  API_KEY_STOPPED_NOTE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Billing/PlanLeftoverCopy";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";

beforeEach(() => {
  billingEnabledForTest = false;
  currentPlanForTest = null;
});

afterEach(() => {
  cleanup();
});

describe("on a project known to be below Growth", () => {
  beforeEach(() => {
    billingEnabledForTest = true;
    currentPlanForTest = PlanType.Free;
  });

  test("says the key stopped working, why, and that an upgrade turns it back on", () => {
    render(<ApiKeyStoppedNote />);

    const note: HTMLElement = screen.getByTestId(API_KEY_STOPPED_NOTE_TEST_ID);

    expect(note).toHaveTextContent("This API key stopped working");
    expect(note).toHaveTextContent(
      "Your plan does not include API keys, so every request made with this key is refused. Upgrading to the Growth plan turns it back on as it is. You can still delete it.",
    );
  });

  test("links to Billing, where the plan is changed", () => {
    render(<ApiKeyStoppedNote />);

    const link: HTMLElement = within(
      screen.getByTestId(API_KEY_STOPPED_NOTE_TEST_ID),
    ).getByText(PlanLeftoverCopy.upgradeLink);

    expect(link.closest("a")).toHaveAttribute(
      "href",
      expect.stringContaining("/settings/billing"),
    );
  });

  test("is a warning, not an always-on info banner", () => {
    render(<ApiKeyStoppedNote />);

    expect(screen.getByTestId(API_KEY_STOPPED_NOTE_TEST_ID)).toHaveAttribute(
      "role",
      "alert",
    );
  });
});

describe("everyone else sees nothing", () => {
  test.each([PlanType.Growth, PlanType.Scale, PlanType.Enterprise])(
    "a project on %s",
    (plan: PlanType) => {
      billingEnabledForTest = true;
      currentPlanForTest = plan;

      render(<ApiKeyStoppedNote />);

      expect(screen.queryByTestId(API_KEY_STOPPED_NOTE_TEST_ID)).toBeNull();
    },
  );

  test("billing off (self-hosted), whatever plan the project says", () => {
    billingEnabledForTest = false;
    currentPlanForTest = PlanType.Free;

    render(<ApiKeyStoppedNote />);

    expect(screen.queryByTestId(API_KEY_STOPPED_NOTE_TEST_ID)).toBeNull();
  });

  test("a project whose plan is not known yet: a guess never says a key stopped", () => {
    billingEnabledForTest = true;
    currentPlanForTest = null;

    render(<ApiKeyStoppedNote />);

    expect(screen.queryByTestId(API_KEY_STOPPED_NOTE_TEST_ID)).toBeNull();
  });
});
