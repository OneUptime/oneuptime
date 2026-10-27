/*
 * HOW MANY RUNS A PLAN ALLOWS (WorkflowPlan), as QueueWorkflow enforces it.
 *
 * Each plan allows so many workflow runs in any 30 days: Growth 500, Scale
 * 2,000, Enterprise no practical limit - and the Free plan none: on OneUptime
 * Cloud, workflows need the Growth plan or above (the docs' "Before you
 * begin", and the Builder's notice). The runs already recorded in the last
 * 30 days are counted before a new one, so:
 *
 *   - at the limit, the run is refused: recorded with the status Execution
 *     Exceeded Current Plan, and nothing queued. It used to be refused only
 *     past the limit, so a plan of 500 ran 501;
 *   - the Free plan refuses every run, the first one in 30 days included
 *     (with the old check, 0 runs recorded was not more than its 0, so it
 *     ran one every 30 days), and its log says workflows do not run on it,
 *     and which plan runs them - never "it already ran 0";
 *   - with billing off, as on every self-hosted install, there is no plan
 *     and no limit, and nothing is counted.
 */

import QueueWorkflow from "../../../FeatureSet/Workflow/Services/QueueWorkflow";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowLog from "Common/Models/DatabaseModels/WorkflowLog";
import Queue from "Common/Server/Infrastructure/Queue";
import ProjectService from "Common/Server/Services/ProjectService";
import WorkflowLogService from "Common/Server/Services/WorkflowLogService";
import WorkflowService from "Common/Server/Services/WorkflowService";
import WorkflowVariableService from "Common/Server/Services/WorkflowVariableService";
import logger from "Common/Server/Utils/Logger";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import WorkflowPlan, {
  LOWEST_PLAN_THAT_RUNS_WORKFLOWS,
  doesPlanRunWorkflows,
  getWorkflowPlanRefusalMessage,
} from "Common/Types/Workflow/WorkflowPlan";
import WorkflowStatus from "Common/Types/Workflow/WorkflowStatus";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const WORKFLOW_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);

// "2026-10-12 10:00:01: <line>", as every run log line is stamped.
const STAMPED_LINE: RegExp = /^.+?: (.*)$/;

interface RecordedSpy {
  mock: { calls: Array<Array<unknown>> };
}

interface Spies {
  createLog: RecordedSpy;
  addJob: RecordedSpy;
  countRuns: RecordedSpy;
}

// A workflow that is on, of a project on `plan` with `runs` in 30 days.
const prepare: (plan: PlanType | null, runs: number) => Spies = (
  plan: PlanType | null,
  runs: number,
): Spies => {
  const workflowRow: Workflow = new Workflow();
  workflowRow._id = WORKFLOW_ID.toString();
  workflowRow.isEnabled = true;
  workflowRow.projectId = PROJECT_ID;

  jest
    .spyOn(WorkflowService as never, "findOneById")
    .mockResolvedValue(workflowRow as never);

  const runLog: WorkflowLog = new WorkflowLog();
  runLog._id = "88888888-8888-4888-8888-888888888888";

  const createLog: RecordedSpy = jest
    .spyOn(WorkflowLogService as never, "create")
    .mockResolvedValue(runLog as never) as unknown as RecordedSpy;

  const addJob: RecordedSpy = jest
    .spyOn(Queue as never, "addJob")
    .mockResolvedValue({} as never) as unknown as RecordedSpy;

  jest
    .spyOn(ProjectService as never, "getCurrentPlan")
    .mockResolvedValue({ plan: plan, isSubscriptionUnpaid: false } as never);

  const countRuns: RecordedSpy = jest
    .spyOn(WorkflowLogService as never, "countBy")
    .mockResolvedValue(
      new PositiveNumber(runs) as never,
    ) as unknown as RecordedSpy;

  jest
    .spyOn(WorkflowVariableService as never, "findBy")
    .mockResolvedValue([] as never);

  return { createLog, addJob, countRuns };
};

// The run log row QueueWorkflow wrote first.
const firstLog: (spies: Spies) => WorkflowLog = (spies: Spies): WorkflowLog => {
  expect(spies.createLog.mock.calls.length).toBeGreaterThanOrEqual(1);

  return (spies.createLog.mock.calls[0]![0] as { data: WorkflowLog }).data;
};

const logLines: (log: WorkflowLog) => Array<string> = (
  log: WorkflowLog,
): Array<string> => {
  return String(log.logs || "")
    .split("\n")
    .map((line: string): string => {
      return line.match(STAMPED_LINE)?.[1] ?? line;
    });
};

const run: () => Promise<void> = async (): Promise<void> => {
  await QueueWorkflow.addWorkflowToQueue({
    workflowId: WORKFLOW_ID,
    returnValues: {},
  });
};

beforeEach(() => {
  jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a plan that runs workflows", () => {
  test.each([
    [PlanType.Growth, WorkflowPlan.Growth],
    [PlanType.Scale, WorkflowPlan.Scale],
  ])(
    "%s runs the run that reaches its limit of %i",
    async (plan: PlanType, limit: number) => {
      const spies: Spies = prepare(plan, limit - 1);

      await run();

      expect(spies.addJob.mock.calls).toHaveLength(1);
      expect(firstLog(spies).workflowStatus).not.toBe(
        WorkflowStatus.WorkflowCountExceeded,
      );
    },
  );

  test.each([
    [PlanType.Growth, WorkflowPlan.Growth],
    [PlanType.Scale, WorkflowPlan.Scale],
  ])(
    "%s refuses the next one: %i runs is its limit, not one more",
    async (plan: PlanType, limit: number) => {
      const spies: Spies = prepare(plan, limit);

      await run();

      const log: WorkflowLog = firstLog(spies);

      expect(spies.addJob.mock.calls).toHaveLength(0);
      expect(spies.createLog.mock.calls).toHaveLength(1);
      expect(log.workflowStatus).toBe(WorkflowStatus.WorkflowCountExceeded);
      expect(logLines(log)).toEqual([
        `Workflow cannot run because it already ran ${limit} in the last 30 days. Your current plan limit is ${limit}`,
      ]);
    },
  );

  test("the runs counted are the project's, in the last 30 days", async () => {
    const spies: Spies = prepare(PlanType.Growth, 3);

    await run();

    const query: Record<string, unknown> = (
      spies.countRuns.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;

    expect(String(query["projectId"])).toBe(PROJECT_ID.toString());
    expect(query["createdAt"]).toBeDefined();
  });

  test("Enterprise runs far past any other plan's limit", async () => {
    const spies: Spies = prepare(PlanType.Enterprise, 1_000_000);

    await run();

    expect(spies.addJob.mock.calls).toHaveLength(1);
  });
});

describe("the Free plan, which runs no workflows", () => {
  test("refuses the first run in 30 days, and every one after", async () => {
    for (const runs of [0, 1, 50]) {
      jest.restoreAllMocks();
      jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
      jest.spyOn(logger, "error").mockImplementation((): void => {});

      const spies: Spies = prepare(PlanType.Free, runs);

      await run();

      expect({ runs, queued: spies.addJob.mock.calls.length }).toEqual({
        runs,
        queued: 0,
      });
      expect(firstLog(spies).workflowStatus).toBe(
        WorkflowStatus.WorkflowCountExceeded,
      );
    }
  });

  test("says workflows do not run on its plan, and which plan runs them - not how many it ran", async () => {
    const spies: Spies = prepare(PlanType.Free, 0);

    await run();

    expect(logLines(firstLog(spies))).toEqual([
      "Workflows do not run on the Free plan. Upgrade to the Growth plan or above to run them.",
    ]);
  });

  test("counts nothing: there is no limit to compare with", async () => {
    const spies: Spies = prepare(PlanType.Free, 0);

    await run();

    expect(spies.countRuns.mock.calls).toHaveLength(0);
  });
});

describe("no plan: billing off, as on every self-hosted install", () => {
  test("runs, counting nothing", async () => {
    const spies: Spies = prepare(null, 1_000_000);

    await run();

    expect(spies.addJob.mock.calls).toHaveLength(1);
    expect(spies.countRuns.mock.calls).toHaveLength(0);
  });
});

describe("the rule and its words", () => {
  test("only the Free plan runs no workflows", () => {
    expect(doesPlanRunWorkflows(PlanType.Free)).toBe(false);
    expect(doesPlanRunWorkflows(PlanType.Growth)).toBe(true);
    expect(doesPlanRunWorkflows(PlanType.Scale)).toBe(true);
    expect(doesPlanRunWorkflows(PlanType.Enterprise)).toBe(true);
  });

  test("an unknown plan, or none, runs them: the server has the last word", () => {
    expect(doesPlanRunWorkflows(null)).toBe(true);
    expect(doesPlanRunWorkflows(undefined)).toBe(true);
    expect(doesPlanRunWorkflows("")).toBe(true);
    expect(doesPlanRunWorkflows("Startup")).toBe(true);
  });

  test("a plan named by a number is not mistaken for one of the plans", () => {
    expect(doesPlanRunWorkflows("0")).toBe(true);
    expect(doesPlanRunWorkflows("500")).toBe(true);
  });

  test("the plan a Free project is told to upgrade to is the lowest that runs workflows", () => {
    expect(LOWEST_PLAN_THAT_RUNS_WORKFLOWS).toBe(PlanType.Growth);
    expect(doesPlanRunWorkflows(LOWEST_PLAN_THAT_RUNS_WORKFLOWS)).toBe(true);
  });

  test("a used-up plan's words keep naming its count and limit, as the docs say", () => {
    expect(
      getWorkflowPlanRefusalMessage({
        plan: PlanType.Growth,
        runsInLast30Days: 512,
      }),
    ).toBe(
      "Workflow cannot run because it already ran 512 in the last 30 days. Your current plan limit is 500",
    );
  });
});
