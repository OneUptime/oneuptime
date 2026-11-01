import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";

/*
 * Whether billing is on is read once, from the page's settings
 * (Common/UI/Config): a getter laid over the real module lets each test say
 * (the ActiveMonitorLimitNotice pattern).
 */
let billingEnabled: boolean = true;

jest.mock("../../../UI/Config", () => {
  const mocked: Record<string, unknown> = {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
  };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return billingEnabled;
    },
  });

  return mocked;
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
        i18n: { language: "en", resolvedLanguage: "en" },
      };
    },
  };
});

import AiFirstResponderSummary, {
  AI_FIRST_RESPONDER_PLAN_NEED,
  AI_FIRST_RESPONDER_SUMMARY_TEST_ID,
  getAiHoldPlanNeeded,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallRule/AiFirstResponderSummary";
import { OnCallRuleRecord } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallRule/WorkingHoursText";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import OnCallRuleWhenToPage from "../../../Types/OnCallDutyPolicy/OnCallRuleWhenToPage";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * "AFTER ONEUPTIME AI TRIES" NEEDS THE PLAN ITS HELD PAGE CAN BE SEEN ON.
 *
 * A held page is an on-call run, and a project below the runs' plan (Growth)
 * cannot read one: the AI card's "OneUptime AI is on it", Page now and the
 * execution logs all read it. The server pages right away there and says
 * the plan (AiFirstResponderEligibility.getAiHoldPlanShortfall); the rule's
 * form says it first, among what OneUptime AI needs, as a link to Billing -
 * and says nothing of plans where none is missing, or where billing is off.
 *
 * The plan lines are the ones CI's packages/Common/test-setup.sh writes.
 */

const PLAN_LINES: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC:
    "Free,price_1M4niQANuQdJ93r7AVjhnik5,price_1M4niQANuQdJ93r7l1Wz1dkm,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_1M4nhZANuQdJ93r7yfQ1MePQ,price_1M4r3OANuQdJ93r7g8NyoCBq,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_1MKidGANuQdJ93r7FoaZ1dOb,price_1MKidRANuQdJ93r7LVOc0BUy,99,84,3,14",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,price_1M4ng9ANuQdJ93r7CP90ezSN,price_1M4ng9ANuQdJ93r72ZYUp4PU,-1,-1,4,14",
};

const savedPlanLines: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const [key, value] of Object.entries(PLAN_LINES)) {
    savedPlanLines[key] = process.env[key];
    process.env[key] = value;
  }
});

afterAll(() => {
  for (const key of Object.keys(PLAN_LINES)) {
    if (savedPlanLines[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedPlanLines[key];
    }
  }
});

afterEach(() => {
  cleanup();
  billingEnabled = true;
  jest.restoreAllMocks();
});

function onPlan(plan: PlanType | null): void {
  jest.spyOn(ProjectUtil, "getCurrentPlan").mockReturnValue(plan);
}

function renderSummary(record: OnCallRuleRecord): void {
  render(
    <AiFirstResponderSummary
      rule={{
        whenToPage: OnCallRuleWhenToPage.AfterOneUptimeAI,
        aiHoldTimeInMinutes: 10,
      }}
      record={record}
    />,
  );
}

describe("the plan a held page needs, as the form reads it (getAiHoldPlanNeeded)", () => {
  test("a project on the Free plan needs Growth", () => {
    onPlan(PlanType.Free);

    expect(getAiHoldPlanNeeded()).toBe(PlanType.Growth);
  });

  test("Growth and every plan above it need nothing", () => {
    for (const plan of [PlanType.Growth, PlanType.Scale, PlanType.Enterprise]) {
      onPlan(plan);
      expect(getAiHoldPlanNeeded()).toBeNull();
      jest.restoreAllMocks();
    }
  });

  test("with billing off, or a plan not known yet, nothing is said of plans", () => {
    onPlan(PlanType.Free);
    billingEnabled = false;
    expect(getAiHoldPlanNeeded()).toBeNull();

    billingEnabled = true;
    jest.restoreAllMocks();
    onPlan(null);
    expect(getAiHoldPlanNeeded()).toBeNull();
  });

  test("the words of the need are one sentence to translate, the plan a value in it", () => {
    expect(AI_FIRST_RESPONDER_PLAN_NEED).toBe("The {{plan}} plan");
  });
});

describe("the rule form's list of what OneUptime AI needs", () => {
  for (const record of [OnCallRuleRecord.Incident, OnCallRuleRecord.Alert]) {
    test(`below the plan, an ${record} rule's list starts with the plan, a link to Billing`, () => {
      onPlan(PlanType.Free);

      renderSummary(record);

      const summary: HTMLElement = screen.getByTestId(
        AI_FIRST_RESPONDER_SUMMARY_TEST_ID,
      );
      const needs: Array<HTMLElement> =
        within(summary).getAllByRole("listitem");
      const plan: HTMLElement = screen.getByTestId(
        "ai-first-responder-need-plan",
      );

      expect(needs[0]).toBe(plan);
      expect(plan).toHaveTextContent("The Growth plan");

      const link: HTMLElement = within(plan).getByRole("link");
      expect(link.getAttribute("href") || "").toContain("/settings/billing");
    });
  }

  test("on a plan that has it, the list is what it was: no plan", () => {
    onPlan(PlanType.Growth);

    renderSummary(OnCallRuleRecord.Incident);

    expect(screen.queryByTestId("ai-first-responder-need-plan")).toBeNull();
    expect(
      within(
        screen.getByTestId(AI_FIRST_RESPONDER_SUMMARY_TEST_ID),
      ).getAllByRole("listitem"),
    ).toHaveLength(3);
  });

  test("with billing off - every self-hosted install - no plan is named", () => {
    billingEnabled = false;
    onPlan(PlanType.Free);

    renderSummary(OnCallRuleRecord.Alert);

    expect(screen.queryByTestId("ai-first-responder-need-plan")).toBeNull();
  });

  test("a rule that pages right away shows no list at all", () => {
    onPlan(PlanType.Free);

    render(
      <AiFirstResponderSummary
        rule={{ whenToPage: OnCallRuleWhenToPage.RightAway }}
        record={OnCallRuleRecord.Incident}
      />,
    );

    expect(screen.queryByTestId(AI_FIRST_RESPONDER_SUMMARY_TEST_ID)).toBeNull();
  });
});
