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

/*
 * Runbook variables gave SSH and Kubernetes steps a script: an SSH step signs
 * in to user@host and runs a bash script there, and the Kubernetes step is a
 * kubectl script. What OneUptime AI reads of a step is what it runs - never
 * an empty "Runs over SSH:" for a step the data migration rewrote - and a
 * step still written with a credential (through the API) reads as it did.
 */
describe("query_runbooks — SSH and kubectl steps", () => {
  test("an SSH step reads as the machine it signs in to and its script, a kubectl step as its commands", async () => {
    jest.spyOn(RunbookService, "findOneById").mockResolvedValue(
      buildRunbook({
        steps: [
          {
            id: "step-ssh",
            order: 1,
            type: "SSH",
            title: "Restart the database proxy",
            config: {
              host: "{{global.variables.DB_HOST}}",
              username: "deploy",
              signIn: "{{global.variables.PROD_DB_SSH_KEY}}",
              script: "sudo systemctl restart pgbouncer",
              agentId: "agent-1",
            },
          },
          {
            id: "step-kubectl",
            order: 2,
            type: "Kubernetes",
            title: "Restart checkout",
            config: {
              kubeconfig: "{{global.variables.PROD_KUBECONFIG}}",
              script: "kubectl rollout restart deployment/checkout-api",
              agentId: "agent-1",
            },
          },
        ] as JSONArray,
      }) as never,
    );
    jest
      .spyOn(RunbookExecutionService, "findBy")
      .mockResolvedValue([] as never);

    const result: ToolExecutionResult = await QueryRunbooksTool.execute(
      { runbookId: RUNBOOK_ID.toString() },
      ctx,
    );

    expect(result.dataForLlm).toContain(
      "Runs a bash script over SSH on deploy@{{global.variables.DB_HOST}}: sudo systemctl restart pgbouncer",
    );
    expect(result.dataForLlm).toContain(
      "Runs kubectl commands on a runner: kubectl rollout restart deployment/checkout-api",
    );
    // Not the shapes of steps written before variables, with nothing in them.
    expect(result.dataForLlm).not.toContain("Runs over SSH:");
    expect(result.dataForLlm).not.toContain("Kubernetes  on");
    // A sign-in or a kubeconfig names a secret variable: never read out.
    expect(result.dataForLlm).not.toContain("PROD_DB_SSH_KEY");
    expect(result.dataForLlm).not.toContain("PROD_KUBECONFIG");
  });

  test("an SSH step with no user reads as its host alone", async () => {
    jest.spyOn(RunbookService, "findOneById").mockResolvedValue(
      buildRunbook({
        steps: [
          {
            id: "step-ssh",
            order: 1,
            type: "SSH",
            title: "Check the machine",
            config: { host: "db-1.internal", script: "uptime" },
          },
        ] as JSONArray,
      }) as never,
    );
    jest
      .spyOn(RunbookExecutionService, "findBy")
      .mockResolvedValue([] as never);

    const result: ToolExecutionResult = await QueryRunbooksTool.execute(
      { runbookId: RUNBOOK_ID.toString() },
      ctx,
    );

    expect(result.dataForLlm).toContain(
      "Runs a bash script over SSH on db-1.internal: uptime",
    );
  });

  test("steps written with a credential through the API read as they run", async () => {
    jest.spyOn(RunbookService, "findOneById").mockResolvedValue(
      buildRunbook({
        steps: [
          {
            id: "step-ssh-legacy",
            order: 1,
            type: "SSH",
            title: "Clear the cache",
            config: {
              credentialId: "90000000-0000-4000-8000-000000000c01",
              command: "redis-cli FLUSHALL",
            },
          },
          {
            id: "step-kubernetes-legacy",
            order: 2,
            type: "Kubernetes",
            title: "Scale workers",
            config: {
              credentialId: "90000000-0000-4000-8000-000000000c01",
              action: "ScaleWorkload",
              workloadKind: "Deployment",
              namespace: "jobs",
              workloadName: "workers",
              replicas: 4,
            },
          },
        ] as JSONArray,
      }) as never,
    );
    jest
      .spyOn(RunbookExecutionService, "findBy")
      .mockResolvedValue([] as never);

    const result: ToolExecutionResult = await QueryRunbooksTool.execute(
      { runbookId: RUNBOOK_ID.toString() },
      ctx,
    );

    expect(result.dataForLlm).toContain("Runs over SSH: redis-cli FLUSHALL");
    expect(result.dataForLlm).toContain(
      "Kubernetes ScaleWorkload on Deployment jobs/workers (replicas: 4)",
    );
  });
});

/*
 * Where the run stops for someone to approve: OneUptime AI reads it on the
 * step it holds back (requireApprovalBeforeRunning), the way the run takes
 * it - a runbook a client still saves with the old "approval after this
 * step" reads as an approval before the next step, or a Manual step at the
 * end after the last one.
 */
describe("query_runbooks — approvals", () => {
  // The serialized line of the step titled `title`.
  function lineOf(result: ToolExecutionResult, title: string): string {
    const line: string | undefined = result.dataForLlm
      .split("\n")
      .find((candidate: string) => {
        return candidate.includes(`title=${title}`);
      });

    expect({ title, found: Boolean(line) }).toEqual({ title, found: true });

    return line!;
  }

  test("a step that asks for approval before it runs says so; the others do not", async () => {
    jest.spyOn(RunbookService, "findOneById").mockResolvedValue(
      buildRunbook({
        steps: [
          {
            id: "step-1",
            order: 1,
            type: "Bash",
            title: "Capture state",
            config: { script: "uptime", agentId: "agent-1" },
            requireApprovalBeforeRunning: false,
          },
          {
            id: "step-2",
            order: 2,
            type: "Kubernetes",
            title: "Restart checkout",
            config: {
              script: "kubectl rollout restart deployment/checkout",
              agentId: "agent-1",
            },
            requireApprovalBeforeRunning: true,
          },
        ] as JSONArray,
      }) as never,
    );
    jest
      .spyOn(RunbookExecutionService, "findBy")
      .mockResolvedValue([] as never);

    const result: ToolExecutionResult = await QueryRunbooksTool.execute(
      { runbookId: RUNBOOK_ID.toString() },
      ctx,
    );

    expect(lineOf(result, "Restart checkout")).toContain(
      "requireApprovalBeforeRunning=true",
    );
    expect(lineOf(result, "Capture state")).not.toContain(
      "requireApprovalBeforeRunning",
    );
    // The old name is never what the model reads.
    expect(result.dataForLlm).not.toContain("requireApproval=");
  });

  test("a runbook still saved the old way reads as it runs: the approval on the next step, and one after the last step as a Manual step at the end", async () => {
    jest.spyOn(RunbookService, "findOneById").mockResolvedValue(
      buildRunbook({
        steps: [
          {
            id: "step-1",
            order: 1,
            type: "AI",
            title: "Analyze diagnostics",
            config: { prompt: "Is it safe to fail over?" },
            requireApproval: true,
          },
          {
            id: "step-2",
            order: 2,
            type: "HttpRequest",
            title: "Fail over",
            config: { method: "POST", url: "https://failover.example.com" },
            requireApproval: true,
          },
        ] as JSONArray,
      }) as never,
    );
    jest
      .spyOn(RunbookExecutionService, "findBy")
      .mockResolvedValue([] as never);

    const result: ToolExecutionResult = await QueryRunbooksTool.execute(
      { runbookId: RUNBOOK_ID.toString() },
      ctx,
    );

    expect(lineOf(result, "Analyze diagnostics")).not.toContain(
      "requireApprovalBeforeRunning",
    );
    expect(lineOf(result, "Fail over")).toContain(
      "requireApprovalBeforeRunning=true",
    );
    expect(lineOf(result, "Approve the result")).toContain("type=Manual");
    expect(lineOf(result, "Approve the result")).toContain("stepNumber=3");
    expect(result.citationLabel).toBe('Runbook "Database failover" (3 steps)');
  });

  test("the tool tells the model it reads where the run stops for approval", () => {
    expect(QueryRunbooksTool.description).toContain(
      "whether the run stops for someone to approve it before it runs (requireApprovalBeforeRunning)",
    );
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
