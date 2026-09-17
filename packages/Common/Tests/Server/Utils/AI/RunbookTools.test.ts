import { QueryRunbooksTool } from "../../../../Server/Utils/AI/Toolbox/RunbookTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import RunbookService from "../../../../Server/Services/RunbookService";
import RunbookExecutionService from "../../../../Server/Services/RunbookExecutionService";
import Runbook from "../../../../Models/DatabaseModels/Runbook";
import RunbookExecution from "../../../../Models/DatabaseModels/RunbookExecution";
import User from "../../../../Models/DatabaseModels/User";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import RunbookExecutionStatus from "../../../../Types/Runbook/RunbookExecutionStatus";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * query_runbooks closes the gap where run_runbook said "find the runbook id
 * with query tools first" but no such tool existed, and "what does our runbook
 * say?" was unanswerable. These tests lock in what the model relies on: the
 * detail mode returns the steps IN ORDER with their actual commands plus
 * recent executions, the list mode paginates honestly, empty results are
 * honest (rowCount 0, no widget), and citations deep-link to the runbook.
 */

const ctx: ToolContext = {
  projectId: ObjectID.generate(),
  props: { isRoot: true },
};

const RUNBOOK_ID: ObjectID = ObjectID.generate();

function buildRunbook(data?: {
  id?: ObjectID;
  name?: string;
  isEnabled?: boolean;
  steps?: JSONArray | undefined;
}): Runbook {
  const runbook: Runbook = new Runbook();
  runbook._id = (data?.id ?? RUNBOOK_ID).toString();
  runbook.name = data?.name ?? "Database failover";
  runbook.description = "What to do when the primary database is unreachable.";
  runbook.isEnabled = data?.isEnabled ?? true;
  runbook.createdAt = new Date("2026-07-01T09:00:00Z");

  // Deliberately stored out of order — the tool must sort by `order`.
  const steps: JSONArray | undefined =
    data && "steps" in data
      ? data.steps
      : ([
          {
            id: "step-2",
            order: 2,
            type: "Bash",
            title: "Restart API gateway",
            config: {
              script: "systemctl restart api-gateway",
              agentId: "agent-1",
            },
          },
          {
            id: "step-1",
            order: 1,
            type: "Manual",
            title: "Check dashboards",
            description: "Open the API latency dashboard and confirm impact.",
            config: {},
          },
        ] as JSONArray);

  // exactOptionalPropertyTypes: leave `steps` unset instead of assigning undefined.
  if (steps) {
    runbook.steps = steps;
  }

  return runbook;
}

function buildExecution(data?: {
  status?: RunbookExecutionStatus;
  triggeredByUserName?: string;
}): RunbookExecution {
  const execution: RunbookExecution = new RunbookExecution();
  execution._id = ObjectID.generate().toString();
  execution.status = data?.status ?? RunbookExecutionStatus.Completed;
  execution.createdAt = new Date("2026-08-10T12:00:00Z");
  execution.startedAt = new Date("2026-08-10T12:00:05Z");
  execution.completedAt = new Date("2026-08-10T12:02:00Z");

  if (data?.triggeredByUserName) {
    const user: User = new User();
    user.name = new Name(data.triggeredByUserName);
    execution.triggeredByUser = user;
  }

  return execution;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("query_runbooks — detail mode", () => {
  test("returns the steps in execution order with their commands, plus recent executions", async () => {
    jest
      .spyOn(RunbookService, "findOneById")
      .mockResolvedValue(buildRunbook() as never);

    const executionsSpy: jest.SpyInstance = jest
      .spyOn(RunbookExecutionService, "findBy")
      .mockResolvedValue([
        buildExecution({ triggeredByUserName: "Sam Rivera" }),
        buildExecution({ status: RunbookExecutionStatus.Failed }),
      ] as never);

    const result: ToolExecutionResult = await QueryRunbooksTool.execute(
      { runbookId: RUNBOOK_ID.toString() },
      ctx,
    );

    // Header + 2 steps + 2 executions.
    expect(result.rowCount).toBe(5);

    // Steps come back sorted by `order`, not storage order.
    const manualIndex: number = result.dataForLlm.indexOf("Check dashboards");
    const bashIndex: number = result.dataForLlm.indexOf("Restart API gateway");
    expect(manualIndex).toBeGreaterThan(-1);
    expect(bashIndex).toBeGreaterThan(-1);
    expect(manualIndex).toBeLessThan(bashIndex);

    // The actual command content — the reason this tool exists.
    expect(result.dataForLlm).toContain("systemctl restart api-gateway");

    // Recent executions: status, who triggered, and rule-triggered fallback.
    expect(result.dataForLlm).toContain("Completed");
    expect(result.dataForLlm).toContain("Sam Rivera");
    expect(result.dataForLlm).toContain("Automation");

    expect(result.citationLabel).toBe('Runbook "Database failover" (2 steps)');
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.RunbookView,
      params: { runbookId: RUNBOOK_ID.toString() },
    });
    expect(result.widget).toBeDefined();

    /*
     * The executions query is scoped to THIS runbook AND pinned to the
     * tenant from ctx (runbookId is an untrusted model argument), under the
     * user's props.
     */
    const executionCallArgs: JSONObject = executionsSpy.mock
      .calls[0]?.[0] as JSONObject;
    expect(
      String((executionCallArgs["query"] as JSONObject)["runbookId"]),
    ).toBe(RUNBOOK_ID.toString());
    expect(
      String((executionCallArgs["query"] as JSONObject)["projectId"]),
    ).toBe(ctx.projectId.toString());
    expect(executionCallArgs["props"]).toBe(ctx.props);
  });

  test("a runbook with no steps still returns its header and is honest about the count", async () => {
    jest
      .spyOn(RunbookService, "findOneById")
      .mockResolvedValue(buildRunbook({ steps: undefined }) as never);
    jest
      .spyOn(RunbookExecutionService, "findBy")
      .mockResolvedValue([] as never);

    const result: ToolExecutionResult = await QueryRunbooksTool.execute(
      { runbookId: RUNBOOK_ID.toString() },
      ctx,
    );

    expect(result.rowCount).toBe(1);
    expect(result.dataForLlm).toContain("stepCount=0");
    expect(result.citationLabel).toBe('Runbook "Database failover" (0 steps)');
    expect(result.widget).toBeDefined();
  });

  test("a missing runbook is honest: zero rows, no widget, no executions fetch", async () => {
    jest.spyOn(RunbookService, "findOneById").mockResolvedValue(null as never);
    const executionsSpy: jest.SpyInstance = jest
      .spyOn(RunbookExecutionService, "findBy")
      .mockResolvedValue([] as never);

    const result: ToolExecutionResult = await QueryRunbooksTool.execute(
      { runbookId: RUNBOOK_ID.toString() },
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.widget).toBeUndefined();
    expect(executionsSpy).not.toHaveBeenCalled();
  });

  test("steps survive a denied executions fetch — executions are best-effort", async () => {
    jest
      .spyOn(RunbookService, "findOneById")
      .mockResolvedValue(buildRunbook() as never);
    jest
      .spyOn(RunbookExecutionService, "findBy")
      .mockRejectedValue(new Error("Not authorized") as never);

    const result: ToolExecutionResult = await QueryRunbooksTool.execute(
      { runbookId: RUNBOOK_ID.toString() },
      ctx,
    );

    // Header + 2 steps; the denied executions cost nothing else.
    expect(result.rowCount).toBe(3);
    expect(result.dataForLlm).toContain("systemctl restart api-gateway");
  });
});

describe("query_runbooks — list mode", () => {
  test("lists runbooks with step count and enabled flag", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(RunbookService, "findBy")
      .mockResolvedValue([
        buildRunbook(),
        buildRunbook({
          id: ObjectID.generate(),
          name: "Cache flush",
          isEnabled: false,
          steps: undefined,
        }),
      ] as never);
    jest
      .spyOn(RunbookService, "countBy")
      .mockResolvedValue(new PositiveNumber(2) as never);

    const result: ToolExecutionResult = await QueryRunbooksTool.execute(
      {},
      ctx,
    );

    expect(result.rowCount).toBe(2);
    expect(result.dataForLlm).toContain("Database failover");
    expect(result.dataForLlm).toContain("Cache flush");
    expect(result.dataForLlm).toContain("stepCount=2");
    expect(result.dataForLlm).toContain("enabled=false");
    // Full result set — no pagination hint.
    expect(result.dataForLlm).not.toContain("Pass skip to page further");
    expect(result.citationLabel).toBe("Runbooks (2 found)");
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.Runbooks,
    });
    expect(result.widget).toBeDefined();

    // The query must run under the requesting user's props, never as root+.
    const callArgs: JSONObject = findBySpy.mock.calls[0]?.[0] as JSONObject;
    expect(callArgs["props"]).toBe(ctx.props);
    expect(callArgs["limit"]).toBe(10);
    expect(callArgs["skip"]).toBe(0);
  });

  test("pages honestly when more runbooks exist than were returned", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(RunbookService, "findBy")
      .mockResolvedValue(
        Array.from({ length: 10 }, (_unused: unknown, index: number) => {
          return buildRunbook({
            id: ObjectID.generate(),
            name: `Runbook ${index + 1}`,
          });
        }) as never,
      );
    jest
      .spyOn(RunbookService, "countBy")
      .mockResolvedValue(new PositiveNumber(40) as never);

    const result: ToolExecutionResult = await QueryRunbooksTool.execute(
      { skip: 5 },
      ctx,
    );

    expect(result.dataForLlm).toContain(
      "Showing rows 6–15 of 40 total. Pass skip to page further.",
    );
    expect(result.citationLabel).toBe("Runbooks (10 of 40)");

    const callArgs: JSONObject = findBySpy.mock.calls[0]?.[0] as JSONObject;
    expect(callArgs["skip"]).toBe(5);
  });

  test("clamps limit and skip arguments", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(RunbookService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(RunbookService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);

    await QueryRunbooksTool.execute({ limit: 999, skip: -50 }, ctx);

    const callArgs: JSONObject = findBySpy.mock.calls[0]?.[0] as JSONObject;
    expect(callArgs["limit"]).toBe(25);
    expect(callArgs["skip"]).toBe(0);
  });

  test("an empty project is honest: zero rows and no widget", async () => {
    jest.spyOn(RunbookService, "findBy").mockResolvedValue([] as never);
    jest
      .spyOn(RunbookService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);

    const result: ToolExecutionResult = await QueryRunbooksTool.execute(
      {},
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.widget).toBeUndefined();
    expect(result.citationLabel).toBe("Runbooks (0 found)");
  });
});

describe("query_runbooks — permissions", () => {
  test("required permissions derive from the Runbook read ACL", () => {
    expect(QueryRunbooksTool.requiredPermissions.length).toBeGreaterThan(0);
  });
});
