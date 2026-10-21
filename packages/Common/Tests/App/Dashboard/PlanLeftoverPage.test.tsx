import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import React, { FunctionComponent, ReactElement, useEffect } from "react";

/*
 * The pages OneUptime Cloud sells on the Growth plan that lower plans used to
 * see only as a refusal - API keys, on-call schedules, and the Slack and
 * Microsoft Teams rules and summaries of every product - and the note they
 * become below the plan (Dashboard Components/Billing/PlanLeftoverPage).
 *
 * Configuration a lower plan cannot use can still be seen, switched off and
 * removed. For a project KNOWN to be below the plan, each page is a note -
 * what the plan includes, where to upgrade - with what the project still
 * has under it (PlanLeftoverTable). Everyone else gets the page: a project
 * on the plan, billing off (every self-hosted install), and a project whose
 * plan is not known - these pages were always reachable, so a guess never
 * hides them.
 *
 * Billing and the plan are pinned in every test (CI's config.env sets
 * BILLING_ENABLED=true). The leftover tables are stand-ins recording what
 * they were asked to list; their own behaviour is PlanLeftoverTable.test.tsx.
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
        return "44444444-4444-4444-8444-444444444444";
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

const mockLeftovers: { tables: Array<RecordedLeftover> } = { tables: [] };

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Billing/PlanLeftoverTable",
  () => {
    const react: typeof React = jest.requireActual("react") as typeof React;

    return {
      __esModule: true,
      default: (props: RecordedLeftover): ReactElement => {
        mockLeftovers.tables.push(props);
        return react.createElement("div", {
          "data-testid": `leftover-${props.id}`,
        });
      },
    };
  },
);

import PlanLeftoverPage from "../../../../App/FeatureSet/Dashboard/src/Components/Billing/PlanLeftoverPage";
import PlanLeftoverCopy, {
  PLAN_LEFTOVER_NOTE_TEST_ID,
  PlanLeftoverTitle,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Billing/PlanLeftoverCopy";
import WorkspacePlanLeftoverGate, {
  WORKSPACE_RULES_PLAN,
  getWorkspaceLeftoverIdSuffix,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/WorkspacePlanLeftoverGate";
import Includes from "../../../Types/BaseDatabase/Includes";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import WorkspaceNotificationSummaryType from "../../../Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryType";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";

let pageMounts: number = 0;

// A page with an effect, like the real ones (tables that load).
const FakePage: FunctionComponent = (): ReactElement => {
  useEffect(() => {
    pageMounts += 1;
  }, []);

  return <div data-testid="the-page">the page</div>;
};

const LEFTOVERS: ReactElement = (
  <div data-testid="what-is-left">what is left</div>
);

const renderGate: (requiredPlan?: PlanType) => void = (
  requiredPlan: PlanType = PlanType.Growth,
): void => {
  render(
    <PlanLeftoverPage requiredPlan={requiredPlan} leftovers={LEFTOVERS}>
      <FakePage />
    </PlanLeftoverPage>,
  );
};

beforeEach(() => {
  billingEnabledForTest = false;
  currentPlanForTest = null;
  pageMounts = 0;
  mockLeftovers.tables = [];
});

afterEach(() => {
  cleanup();
});

describe("the page itself, for everyone who is not known to be below the plan", () => {
  test("billing off (every self-hosted install): the page, whatever plan the project says", () => {
    currentPlanForTest = PlanType.Free;

    renderGate();

    expect(screen.getByTestId("the-page")).toBeInTheDocument();
    expect(pageMounts).toBe(1);
    expect(
      screen.queryByTestId(PLAN_LEFTOVER_NOTE_TEST_ID),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("what-is-left")).not.toBeInTheDocument();
  });

  test.each([PlanType.Growth, PlanType.Scale, PlanType.Enterprise])(
    "on OneUptime Cloud on %s: the page",
    (plan: PlanType) => {
      billingEnabledForTest = true;
      currentPlanForTest = plan;

      renderGate();

      expect(screen.getByTestId("the-page")).toBeInTheDocument();
      expect(
        screen.queryByTestId(PLAN_LEFTOVER_NOTE_TEST_ID),
      ).not.toBeInTheDocument();
    },
  );

  test("on OneUptime Cloud with the plan not known yet: the page - a guess never hides it", () => {
    billingEnabledForTest = true;
    currentPlanForTest = null;

    renderGate();

    expect(screen.getByTestId("the-page")).toBeInTheDocument();
    expect(
      screen.queryByTestId(PLAN_LEFTOVER_NOTE_TEST_ID),
    ).not.toBeInTheDocument();
  });
});

describe("a project known to be below the plan", () => {
  beforeEach(() => {
    billingEnabledForTest = true;
    currentPlanForTest = PlanType.Free;
  });

  test("gets the note and what it still has - never the page, whose requests never run", () => {
    renderGate();

    expect(screen.getByTestId(PLAN_LEFTOVER_NOTE_TEST_ID)).toBeInTheDocument();
    expect(screen.getByTestId("what-is-left")).toBeInTheDocument();
    expect(screen.queryByTestId("the-page")).not.toBeInTheDocument();
    expect(pageMounts).toBe(0);
  });

  test("the note names the plan, says why nothing can be added, and links to Billing", () => {
    renderGate(PlanType.Growth);

    const note: HTMLElement = screen.getByTestId(PLAN_LEFTOVER_NOTE_TEST_ID);

    expect(note).toHaveTextContent("Available on the Growth plan");
    expect(note).toHaveTextContent(
      "This project's plan does not include this, so nothing new can be added here.",
    );

    const link: HTMLElement = within(note).getByText(
      PlanLeftoverCopy.upgradeLink,
    );

    expect(link.closest("a")).toHaveAttribute(
      "href",
      expect.stringContaining("/settings/billing"),
    );
  });

  test("what is left sits under the note", () => {
    renderGate();

    expect(
      Boolean(
        screen
          .getByTestId(PLAN_LEFTOVER_NOTE_TEST_ID)
          .compareDocumentPosition(screen.getByTestId("what-is-left")) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
  });

  test("a Growth project is below a Scale page, and gets the note naming Scale", () => {
    currentPlanForTest = PlanType.Growth;

    renderGate(PlanType.Scale);

    expect(screen.getByTestId(PLAN_LEFTOVER_NOTE_TEST_ID)).toHaveTextContent(
      "Available on the Scale plan",
    );
  });
});

describe("a product's Slack or Microsoft Teams page", () => {
  const renderWorkspacePage: (data: {
    workspaceType: WorkspaceType;
    eventTypes: Array<NotificationRuleEventType>;
    summaryTypes?: Array<WorkspaceNotificationSummaryType>;
  }) => void = (data: {
    workspaceType: WorkspaceType;
    eventTypes: Array<NotificationRuleEventType>;
    summaryTypes?: Array<WorkspaceNotificationSummaryType>;
  }): void => {
    render(
      <WorkspacePlanLeftoverGate
        workspaceType={data.workspaceType}
        eventTypes={data.eventTypes}
        summaryTypes={data.summaryTypes}
      >
        <FakePage />
      </WorkspacePlanLeftoverGate>,
    );
  };

  test("rules and summaries are sold on Growth, as their model says", () => {
    expect(WORKSPACE_RULES_PLAN).toBe(PlanType.Growth);
  });

  test("below Growth: the page's own rules and summaries, of its workspace and events, under the note", async () => {
    billingEnabledForTest = true;
    currentPlanForTest = PlanType.Free;

    await act(async () => {
      renderWorkspacePage({
        workspaceType: WorkspaceType.Slack,
        eventTypes: [
          NotificationRuleEventType.Incident,
          NotificationRuleEventType.IncidentEpisode,
        ],
        summaryTypes: [
          WorkspaceNotificationSummaryType.Incident,
          WorkspaceNotificationSummaryType.IncidentEpisode,
        ],
      });
    });

    expect(screen.getByTestId(PLAN_LEFTOVER_NOTE_TEST_ID)).toBeInTheDocument();
    expect(screen.queryByTestId("the-page")).not.toBeInTheDocument();

    const [rules, summaries] = mockLeftovers.tables as [
      RecordedLeftover,
      RecordedLeftover,
    ];

    expect(mockLeftovers.tables).toHaveLength(2);

    expect(new rules.modelType().tableName).toBe("WorkspaceNotificationRule");
    expect(rules.title).toBe(PlanLeftoverTitle.notificationRules);
    expect(rules.requiredPlan).toBe(PlanType.Growth);
    expect(String(rules.query["projectId"])).toBe(
      "44444444-4444-4444-8444-444444444444",
    );
    expect(rules.query["workspaceType"]).toBe(WorkspaceType.Slack);
    expect(rules.query["eventType"]).toBeInstanceOf(Includes);
    expect((rules.query["eventType"] as Includes).values).toEqual([
      NotificationRuleEventType.Incident,
      NotificationRuleEventType.IncidentEpisode,
    ]);

    expect(new summaries.modelType().tableName).toBe(
      "WorkspaceNotificationSummary",
    );
    expect(summaries.title).toBe(PlanLeftoverTitle.summaries);
    expect(summaries.query["workspaceType"]).toBe(WorkspaceType.Slack);
    expect((summaries.query["summaryType"] as Includes).values).toEqual([
      WorkspaceNotificationSummaryType.Incident,
      WorkspaceNotificationSummaryType.IncidentEpisode,
    ]);

    // Two tables on one page, each with its own id.
    expect(rules.id).not.toBe(summaries.id);
  });

  test("a page without summaries lists its rules only", async () => {
    billingEnabledForTest = true;
    currentPlanForTest = PlanType.Free;

    await act(async () => {
      renderWorkspacePage({
        workspaceType: WorkspaceType.MicrosoftTeams,
        eventTypes: [NotificationRuleEventType.Monitor],
      });
    });

    expect(mockLeftovers.tables).toHaveLength(1);
    expect(mockLeftovers.tables[0]!.query["workspaceType"]).toBe(
      WorkspaceType.MicrosoftTeams,
    );
    expect(
      (mockLeftovers.tables[0]!.query["eventType"] as Includes).values,
    ).toEqual([NotificationRuleEventType.Monitor]);
  });

  test("on Growth, and with billing off, it is the page and nothing is listed for it", async () => {
    for (const state of [
      { billing: true, plan: PlanType.Growth },
      { billing: false, plan: PlanType.Free },
    ]) {
      billingEnabledForTest = state.billing;
      currentPlanForTest = state.plan;

      await act(async () => {
        renderWorkspacePage({
          workspaceType: WorkspaceType.Slack,
          eventTypes: [NotificationRuleEventType.Alert],
        });
      });

      expect(screen.getByTestId("the-page")).toBeInTheDocument();
      cleanup();
    }

    expect(mockLeftovers.tables).toEqual([]);
  });

  test("each page's tables have ids of their own, from its workspace and events", () => {
    expect(
      getWorkspaceLeftoverIdSuffix({
        workspaceType: WorkspaceType.MicrosoftTeams,
        eventTypes: [NotificationRuleEventType.OnCallDutyPolicy],
      }),
    ).toBe("microsoftteams-on-call-duty-policy");
    expect(
      getWorkspaceLeftoverIdSuffix({
        workspaceType: WorkspaceType.Slack,
        eventTypes: [
          NotificationRuleEventType.Alert,
          NotificationRuleEventType.AlertEpisode,
        ],
      }),
    ).toBe("slack-alert-alert-episode");
  });
});
