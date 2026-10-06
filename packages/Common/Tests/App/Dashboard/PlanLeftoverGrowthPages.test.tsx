import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Settings > API Keys and On-Call Duty > Schedules on OneUptime Cloud.
 *
 * API keys and on-call schedules are sold on the Growth plan, and both keep
 * working after a project drops below it: a key still authenticates, a
 * schedule still pages the people on it through the escalation rules that
 * name it. Below the plan, before this, the pages only showed the server's
 * refusal - a key could not even be listed to be revoked. Now a project
 * known to be below Growth gets the plan note with what it still has under
 * it, to delete (PlanLeftoverPage, PlanLeftoverTable); a project on the
 * plan, a self-hosted install and a project whose plan is not known get the
 * page.
 *
 * The tables are stand-ins recording what they were handed; the leftover
 * table's own behaviour is PlanLeftoverTable.test.tsx's.
 */

let billingEnabledForTest: boolean = false;
let currentPlanForTest: string | null = null;

const PROJECT_ID: string = "55555555-5555-4555-8555-555555555555";

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
  const actual: Record<string, any> = jest.requireActual(
    "../../../UI/Utils/Project",
  ) as Record<string, any>;

  return {
    __esModule: true,
    ...actual,
    default: {
      ...actual["default"],
      getCurrentProjectId: (): string => {
        return "55555555-5555-4555-8555-555555555555";
      },
      getCurrentPlan: (): string | null => {
        return currentPlanForTest;
      },
    },
  };
});

interface RecordedLeftover {
  id: string;
  modelType: { new (): { tableName?: string | undefined } };
  query: Record<string, unknown>;
  requiredPlan: string;
  title: string;
  columns: Array<{ field: Record<string, unknown>; title: string }>;
}

const mockRecorded: {
  leftovers: Array<RecordedLeftover>;
  tables: Array<string>;
} = { leftovers: [], tables: [] };

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Billing/PlanLeftoverTable",
  () => {
    const react: typeof React = jest.requireActual("react") as typeof React;

    return {
      __esModule: true,
      default: (props: RecordedLeftover): ReactElement => {
        mockRecorded.leftovers.push(props);
        return react.createElement("div", {
          "data-testid": `leftover-${props.id}`,
        });
      },
    };
  },
);

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  return {
    __esModule: true,
    default: (props: { id: string }): ReactElement => {
      mockRecorded.tables.push(props.id);
      return react.createElement("div", {
        "data-testid": `model-table-${props.id}`,
      });
    },
  };
});

import APIKeysPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/APIKeys";
import OnCallDutySchedulesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutySchedules";
import { PLAN_LEFTOVER_NOTE_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Billing/PlanLeftoverCopy";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Route from "../../../Types/API/Route";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";

interface PageCase {
  name: string;
  Page: FunctionComponent<PageComponentProps>;
  table: string;
  leftover: string;
  model: string;
  title: string;
  columns: Array<string>;
}

const PAGE_CASES: Array<PageCase> = [
  {
    name: "Settings > API Keys",
    Page: APIKeysPage,
    table: "api-keys-table",
    leftover: "api-keys",
    model: "ApiKey",
    title: "API keys still set up",
    columns: ["Name", "Expires"],
  },
  {
    name: "On-Call Duty > Schedules",
    Page: OnCallDutySchedulesPage,
    table: "on-call-schedules-table",
    leftover: "on-call-schedules",
    model: "OnCallDutyPolicySchedule",
    title: "On-call schedules still set up",
    columns: ["Name", "Description"],
  },
];

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(`/dashboard/${PROJECT_ID}/page`),
  currentProject: null,
  hasPaymentMethod: true,
};

beforeEach(() => {
  billingEnabledForTest = false;
  currentPlanForTest = null;
  mockRecorded.leftovers = [];
  mockRecorded.tables = [];
});

afterEach(() => {
  cleanup();
});

describe.each(PAGE_CASES)("$name", (pageCase: PageCase) => {
  test.each([PlanType.Free])(
    "on OneUptime Cloud below Growth (%s): the plan note, with what the project still has under it - never the page",
    async (plan: PlanType) => {
      billingEnabledForTest = true;
      currentPlanForTest = plan;

      await act(async () => {
        render(<pageCase.Page {...PAGE_PROPS} />);
      });

      expect(screen.getByTestId(PLAN_LEFTOVER_NOTE_TEST_ID)).toHaveTextContent(
        "Available on the Growth plan",
      );
      expect(
        screen.getByTestId(`leftover-${pageCase.leftover}`),
      ).toBeInTheDocument();
      // The page's own table - with Create, Edit, Reset - is not drawn.
      expect(mockRecorded.tables).toEqual([]);

      expect(mockRecorded.leftovers).toHaveLength(1);

      const leftover: RecordedLeftover = mockRecorded.leftovers[0]!;

      expect(new leftover.modelType().tableName).toBe(pageCase.model);
      expect(leftover.requiredPlan).toBe(PlanType.Growth);
      expect(leftover.title).toBe(pageCase.title);
      expect(String(leftover.query["projectId"])).toBe(PROJECT_ID);
      expect(
        leftover.columns.map(
          (column: { field: Record<string, unknown>; title: string }) => {
            return column.title;
          },
        ),
      ).toEqual(pageCase.columns);
    },
  );

  test.each([
    ["on OneUptime Cloud on Growth", true, PlanType.Growth],
    ["on OneUptime Cloud on Scale", true, PlanType.Scale],
    ["on OneUptime Cloud with the plan not known", true, null],
    ["self-hosted (billing off)", false, PlanType.Free],
  ])(
    "%s: the page itself, and nothing is listed for the plan",
    async (_label: string, billing: boolean, plan: string | null) => {
      billingEnabledForTest = billing;
      currentPlanForTest = plan;

      await act(async () => {
        render(<pageCase.Page {...PAGE_PROPS} />);
      });

      expect(
        screen.getByTestId(`model-table-${pageCase.table}`),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId(PLAN_LEFTOVER_NOTE_TEST_ID),
      ).not.toBeInTheDocument();
      expect(mockRecorded.leftovers).toEqual([]);
    },
  );
});
