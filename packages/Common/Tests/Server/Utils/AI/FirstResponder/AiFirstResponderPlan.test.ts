/*
 * IsBillingEnabled is a module-load `const` in the real EnvironmentConfig. A
 * getter laid over the otherwise real module lets these tests read the plan
 * with billing on and off (the TelemetryUsageCatchUpStaging pattern).
 */
let mockIsBillingEnabled: boolean = true;

jest.mock("../../../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = {
    ...actual,
    __esModule: true,
  };

  Object.defineProperty(mocked, "IsBillingEnabled", {
    get: (): boolean => {
      return mockIsBillingEnabled;
    },
  });

  return mocked;
});

jest.mock("../../../../../Server/Utils/Logger");

import Incident from "../../../../../Models/DatabaseModels/Incident";
import OnCallDutyPolicyExecutionLog from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import ProjectService from "../../../../../Server/Services/ProjectService";
import AiFirstResponderEligibility, {
  AI_HOLD_CHECK_FAILED_REASON,
  AiHoldFacts,
} from "../../../../../Server/Utils/AI/FirstResponder/AiFirstResponderEligibility";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { PlanType } from "../../../../../Types/Billing/SubscriptionPlan";
import ObjectID from "../../../../../Types/ObjectID";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * ONEUPTIME AI HOLDS A PAGE ONLY WHERE THE PROJECT CAN SEE IT.
 *
 * A held page is an on-call run (OnCallDutyPolicyExecutionLog), and the
 * runs are a Growth table: below it the AI card's "OneUptime AI is on it",
 * its Page now and the execution logs cannot read one. On-call rules have
 * no plan of their own, so a cloud project on the Free plan could set a
 * rule to After OneUptime AI tries and have its pages held for up to 30
 * minutes where nobody could see them or page now. Below the runs' plan,
 * such a rule now pages right away and says the plan; with billing off -
 * every self-hosted install - nothing about the plan is read.
 *
 * The plan lines are the ones CI's packages/Common/test-setup.sh writes.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6c000000-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "6c000000-0000-4000-8000-000000000002",
);

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
  mockIsBillingEnabled = true;
  jest.restoreAllMocks();
});

function onPlan(plan: PlanType | null): void {
  jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: plan,
    isSubscriptionUnpaid: false,
  });
}

describe("the plan a held page needs (getAiHoldPlanShortfall)", () => {
  test("is the plan the on-call runs are read on: Growth", () => {
    expect(new OnCallDutyPolicyExecutionLog().getReadBillingPlan()).toBe(
      PlanType.Growth,
    );
    // Not readable below it: the notice could not read a held run there.
    expect(new OnCallDutyPolicyExecutionLog().readableBelowPlan).toBeFalsy();
  });

  test("a project on the Free plan is short of Growth", async () => {
    onPlan(PlanType.Free);

    expect(
      await AiFirstResponderEligibility.getAiHoldPlanShortfall(PROJECT_ID),
    ).toBe(PlanType.Growth);
  });

  test("Growth and every plan above it are not short", async () => {
    for (const plan of [PlanType.Growth, PlanType.Scale, PlanType.Enterprise]) {
      onPlan(plan);

      expect(
        await AiFirstResponderEligibility.getAiHoldPlanShortfall(PROJECT_ID),
      ).toBeNull();

      jest.restoreAllMocks();
    }
  });

  test("it asks for the project's own plan", async () => {
    onPlan(PlanType.Growth);

    await AiFirstResponderEligibility.getAiHoldPlanShortfall(PROJECT_ID);

    expect(ProjectService.getCurrentPlan).toHaveBeenCalledWith(PROJECT_ID);
  });

  test("with billing off nothing is read, and nothing is short", async () => {
    mockIsBillingEnabled = false;
    const planRead: SpyInstance<typeof ProjectService.getCurrentPlan> =
      jest.spyOn(ProjectService, "getCurrentPlan");

    expect(
      await AiFirstResponderEligibility.getAiHoldPlanShortfall(PROJECT_ID),
    ).toBeNull();
    expect(planRead).not.toHaveBeenCalled();
  });

  test("a plan the project's record does not name is not short (the server's billing check decides)", async () => {
    onPlan(null);

    expect(
      await AiFirstResponderEligibility.getAiHoldPlanShortfall(PROJECT_ID),
    ).toBeNull();
  });
});

describe("an incident in a project below the plan", () => {
  // Everything else lets AI hold: only the plan stands in the way.
  function factsBelowPlan(): AiHoldFacts {
    return {
      recordKind: "incident",
      isCreatedByPerson: false,
      isHighestSeverity: false,
      otherRecordsOpenedRecently: 0,
      planNeededToHold: PlanType.Growth,
      investigationNotStartedCode: null,
      isAutomaticFixingOn: true,
      hasMonitor: true,
      unattendedFixTargetCount: 1,
      hasRecentAiResolvedRecurrence: false,
    };
  }

  test("is paged right away, and the feed says the plan", async () => {
    jest
      .spyOn(AiFirstResponderEligibility, "readIncidentFacts")
      .mockResolvedValue(factsBelowPlan() as never);

    const incident: Incident = new Incident();
    incident.id = INCIDENT_ID;
    incident.projectId = PROJECT_ID;

    expect(
      await AiFirstResponderEligibility.decideForIncident(incident),
    ).toEqual({
      canHold: false,
      reason: "OneUptime AI responds first on the Growth plan and above.",
    });
  });

  test("a project with no plan yet cannot be checked: it pages right away, saying AI could not check", async () => {
    jest
      .spyOn(ProjectService, "getCurrentPlan")
      .mockRejectedValue(
        new BadDataException("Project does not have any plans") as never,
      );
    jest
      .spyOn(AiFirstResponderEligibility, "readIncidentFacts")
      .mockImplementation((async (data: {
        projectId: ObjectID;
      }): Promise<AiHoldFacts> => {
        return {
          ...factsBelowPlan(),
          planNeededToHold:
            await AiFirstResponderEligibility.getAiHoldPlanShortfall(
              data.projectId,
            ),
        };
      }) as never);

    const incident: Incident = new Incident();
    incident.id = INCIDENT_ID;
    incident.projectId = PROJECT_ID;

    expect(
      await AiFirstResponderEligibility.decideForIncident(incident),
    ).toEqual({ canHold: false, reason: AI_HOLD_CHECK_FAILED_REASON });
  });
});
