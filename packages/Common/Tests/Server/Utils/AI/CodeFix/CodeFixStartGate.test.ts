import CodeFixRunRepository from "../../../../../Server/Utils/AI/CodeFix/CodeFixRunRepository";
import CodeFixStartGate, {
  CodeFixStart,
} from "../../../../../Server/Utils/AI/CodeFix/CodeFixStartGate";
import CodeTaskGate from "../../../../../Server/Utils/AI/CodeTask/CodeTaskGate";
import ProjectService from "../../../../../Server/Services/ProjectService";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import CodeFixTaskContext from "../../../../../Types/AI/CodeFixTaskContext";
import CodeFixTaskType from "../../../../../Types/AI/CodeFixTaskType";
import {
  CodeTaskBlocker,
  CodeTaskBlockerType,
} from "../../../../../Types/AI/CodeTask";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../../../Types/Billing/SubscriptionPlan";
import ObjectID from "../../../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * WHETHER A CODE-FIX RUN A PERSON ASKS FOR OUTSIDE CODE COULD DO ITS WORK.
 *
 * A trace's Fix performance with AI, an incident's or alert's Open fix pull
 * request and a service's Improve logging or tracing ask what Code's own
 * request box asks (CodeTaskGate), about the repository the run will be
 * queued on - decided from the run's own facts, as the run decides it
 * (CodeFixRunRepository), among the repositories the caller allows - with
 * the project's plan read for the project. The person's own permission to
 * use the repository is the caller's to weigh, before it asks: the
 * allowance (CodeFixPersonRepository, #11075, #11209). The gate itself asks
 * as OneUptime.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6c2d3e4f-1111-4222-8333-944455556666",
);
const REPOSITORY_ID: ObjectID = new ObjectID(
  "6c2d3e4f-2222-4222-8333-944455556666",
);

const PERFORMANCE_CONTEXT: CodeFixTaskContext = {
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  serviceName: "checkout",
  performanceFindings: [],
  codeLocations: [{ filePath: "src/cart.ts", lineNumber: 12 }],
};

const NO_CREDITS: CodeTaskBlocker = {
  type: CodeTaskBlockerType.NoAiCredits,
  message: "This project's AI credits are used up.",
};

interface GateCall {
  props: DatabaseCommonInteractionProps;
  projectId: ObjectID;
  repository: CodeRepository | null;
  canAsk: boolean;
  billingEnabled?: boolean | undefined;
}

function world(data: {
  resolvesTo: ObjectID | null;
  plan?: PlanType | null;
  isSubscriptionUnpaid?: boolean;
  blocker?: CodeTaskBlocker | null;
}): {
  resolve: jest.Mock;
  gate: jest.Mock;
} {
  const resolve: jest.Mock = jest
    .spyOn(CodeFixRunRepository, "resolveForNewRun")
    .mockResolvedValue(data.resolvesTo) as unknown as jest.Mock;

  jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: data.plan === undefined ? PlanType.Growth : data.plan,
    isSubscriptionUnpaid: Boolean(data.isSubscriptionUnpaid),
  } as never);

  const gate: jest.Mock = jest
    .spyOn(CodeTaskGate, "getBlocker")
    .mockResolvedValue(data.blocker || null) as unknown as jest.Mock;

  return { resolve, gate };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("CodeFixStartGate.check", () => {
  test("decides the run's repository from its own facts, as the run would", async () => {
    const { resolve } = world({ resolvesTo: REPOSITORY_ID });

    await CodeFixStartGate.check({
      projectId: PROJECT_ID,
      taskType: CodeFixTaskType.FixPerformance,
      taskContext: PERFORMANCE_CONTEXT,
    });

    expect(resolve).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      taskType: CodeFixTaskType.FixPerformance,
      taskContext: PERFORMANCE_CONTEXT,
    });
  });

  test("an incident's fix is resolved by the incident, as the run resolves it - and an alert's by the alert", async () => {
    const { resolve } = world({ resolvesTo: REPOSITORY_ID });
    const incidentId: ObjectID = ObjectID.generate();
    const alertId: ObjectID = ObjectID.generate();
    const context: CodeFixTaskContext = {
      sourceInvestigationRunId: ObjectID.generate().toString(),
    };

    await CodeFixStartGate.check({
      projectId: PROJECT_ID,
      taskType: CodeFixTaskType.FixFromIncident,
      taskContext: context,
      incidentId,
    });
    await CodeFixStartGate.check({
      projectId: PROJECT_ID,
      taskType: CodeFixTaskType.FixFromIncident,
      taskContext: context,
      alertId,
    });

    expect(resolve.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      taskType: CodeFixTaskType.FixFromIncident,
      taskContext: context,
      incidentId,
    });
    expect(resolve.mock.calls[1]![0]).toEqual({
      projectId: PROJECT_ID,
      taskType: CodeFixTaskType.FixFromIncident,
      taskContext: context,
      alertId,
    });
  });

  test("a record names one subject: an incident beside an alert is the incident's", async () => {
    const { resolve } = world({ resolvesTo: REPOSITORY_ID });
    const incidentId: ObjectID = ObjectID.generate();

    await CodeFixStartGate.check({
      projectId: PROJECT_ID,
      taskType: CodeFixTaskType.FixFromIncident,
      taskContext: {},
      incidentId,
      alertId: ObjectID.generate(),
    });

    expect(resolve.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      taskType: CodeFixTaskType.FixFromIncident,
      taskContext: {},
      incidentId,
    });
  });

  test("resolved among the repositories the caller allows: a person's own", async () => {
    const { resolve } = world({ resolvesTo: REPOSITORY_ID });

    await CodeFixStartGate.check({
      projectId: PROJECT_ID,
      taskType: CodeFixTaskType.ImproveTracing,
      taskContext: { serviceName: "checkout" },
      allowance: {
        isEveryRepository: false,
        repositoryIds: [REPOSITORY_ID.toString()],
      },
    });

    expect(resolve.mock.calls[0]![0]).toMatchObject({
      allowance: {
        isEveryRepository: false,
        repositoryIds: [REPOSITORY_ID.toString()],
      },
    });
  });

  test("asks Code's gate about that repository, as OneUptime, never about the person's permission", async () => {
    const { gate } = world({ resolvesTo: REPOSITORY_ID });

    await CodeFixStartGate.check({
      projectId: PROJECT_ID,
      taskType: CodeFixTaskType.ImproveLogging,
      taskContext: { serviceName: "checkout" },
    });

    const asked: GateCall = gate.mock.calls[0]![0] as GateCall;
    expect(asked.projectId).toBe(PROJECT_ID);
    expect(asked.repository?.id?.toString()).toBe(REPOSITORY_ID.toString());
    expect(asked.canAsk).toBe(true);
    expect(asked.props.isRoot).toBe(true);
  });

  test("the plan and the bill are the project's, read for it", async () => {
    const { gate } = world({
      resolvesTo: REPOSITORY_ID,
      plan: PlanType.Free,
      isSubscriptionUnpaid: true,
    });

    await CodeFixStartGate.check({
      projectId: PROJECT_ID,
      taskType: CodeFixTaskType.FixPerformance,
      taskContext: PERFORMANCE_CONTEXT,
    });

    expect(ProjectService.getCurrentPlan).toHaveBeenCalledWith(PROJECT_ID);
    const asked: GateCall = gate.mock.calls[0]![0] as GateCall;
    expect(asked.props.currentPlan).toBe(PlanType.Free);
    expect(asked.props.isSubscriptionUnpaid).toBe(true);
  });

  test("a project with no plan (billing off) carries none: the gate's plan question does not apply", async () => {
    const { gate } = world({ resolvesTo: REPOSITORY_ID, plan: null });

    await CodeFixStartGate.check({
      projectId: PROJECT_ID,
      taskType: CodeFixTaskType.FixPerformance,
      taskContext: PERFORMANCE_CONTEXT,
    });

    const asked: GateCall = gate.mock.calls[0]![0] as GateCall;
    expect(asked.props).not.toHaveProperty("currentPlan");
    expect(asked.props.isSubscriptionUnpaid).toBe(false);
  });

  test("no repository resolves: the gate is asked about everything that does not depend on one", async () => {
    const { gate } = world({ resolvesTo: null });

    const start: CodeFixStart = await CodeFixStartGate.check({
      projectId: PROJECT_ID,
      taskType: CodeFixTaskType.ImproveTracing,
      taskContext: { serviceName: "checkout" },
    });

    expect((gate.mock.calls[0]![0] as GateCall).repository).toBeNull();
    expect(start.codeRepositoryId).toBeNull();
  });

  test("answers with the repository and what the gate says, for the page and the create route alike", async () => {
    world({ resolvesTo: REPOSITORY_ID, blocker: NO_CREDITS });

    expect(
      await CodeFixStartGate.check({
        projectId: PROJECT_ID,
        taskType: CodeFixTaskType.FixPerformance,
        taskContext: PERFORMANCE_CONTEXT,
      }),
    ).toEqual({ codeRepositoryId: REPOSITORY_ID, blocker: NO_CREDITS });
  });

  test("nothing in the way: the repository and no blocker", async () => {
    world({ resolvesTo: REPOSITORY_ID });

    expect(
      await CodeFixStartGate.check({
        projectId: PROJECT_ID,
        taskType: CodeFixTaskType.FixPerformance,
        taskContext: PERFORMANCE_CONTEXT,
      }),
    ).toEqual({ codeRepositoryId: REPOSITORY_ID, blocker: null });
  });

  test("the billing flag is passed through to Code's gate, for tests of either mode", async () => {
    const { gate } = world({ resolvesTo: REPOSITORY_ID });

    await CodeFixStartGate.check({
      projectId: PROJECT_ID,
      taskType: CodeFixTaskType.FixPerformance,
      taskContext: PERFORMANCE_CONTEXT,
      billingEnabled: false,
    });

    expect((gate.mock.calls[0]![0] as GateCall).billingEnabled).toBe(false);
  });
});
