import {
  QueryProbesTool,
  QueryWorkflowsTool,
} from "../../../../Server/Utils/AI/Toolbox/WorkflowProbeTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import MonitorProbeService from "../../../../Server/Services/MonitorProbeService";
import ProbeService from "../../../../Server/Services/ProbeService";
import WorkflowLogService from "../../../../Server/Services/WorkflowLogService";
import WorkflowService from "../../../../Server/Services/WorkflowService";
import Probe from "../../../../Models/DatabaseModels/Probe";
import Workflow from "../../../../Models/DatabaseModels/Workflow";
import WorkflowLog from "../../../../Models/DatabaseModels/WorkflowLog";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import PositiveNumber from "../../../../Types/PositiveNumber";
import Version from "../../../../Types/Version";
import WorkflowStatus from "../../../../Types/Workflow/WorkflowStatus";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * query_workflows and query_probes close the "is my automation running / is
 * my probe alive" gaps. These tests lock in what the model relies on: detail
 * mode surfaces the log TAIL of failed runs (where the error actually is),
 * list mode summarizes recent outcomes per workflow, probe health reuses the
 * exact 3-minute staleness rule the platform's status worker applies, empty
 * results stay honest (rowCount 0, no widget), and every query runs under the
 * requesting user's props.
 */

const ctx: ToolContext = {
  projectId: ObjectID.generate(),
  props: { isRoot: true },
};

const WORKFLOW_ID: ObjectID = ObjectID.generate();
const PROJECT_PROBE_ID: ObjectID = ObjectID.generate();
const GLOBAL_PROBE_ID: ObjectID = ObjectID.generate();

function buildWorkflow(data?: {
  id?: ObjectID;
  name?: string;
  enabled?: boolean;
}): Workflow {
  const workflow: Workflow = new Workflow();
  workflow._id = (data?.id ?? WORKFLOW_ID).toString();
  workflow.name = data?.name ?? "Deploy notifier";
  workflow.description = "Notifies the team on deploys.";
  workflow.isEnabled = data?.enabled ?? true;
  workflow.createdAt = new Date("2026-07-01T00:00:00Z");
  return workflow;
}

function buildRun(data: {
  status: WorkflowStatus;
  logs?: string;
  createdAt?: Date;
  workflowId?: ObjectID;
}): WorkflowLog {
  const run: WorkflowLog = new WorkflowLog();
  run._id = ObjectID.generate().toString();
  run.workflowStatus = data.status;
  run.startedAt = new Date("2026-08-14T10:00:00Z");
  run.completedAt = new Date("2026-08-14T10:00:42Z");
  run.createdAt = data.createdAt ?? new Date("2026-08-14T10:00:00Z");
  if (data.workflowId) {
    run.workflowId = data.workflowId;
  }
  if (data.logs) {
    run.logs = data.logs;
  }
  return run;
}

function buildProbe(data: {
  id?: ObjectID;
  name: string;
  lastAlive?: Date;
  version?: string;
}): Probe {
  const probe: Probe = new Probe();
  probe._id = (data.id ?? ObjectID.generate()).toString();
  probe.name = data.name;
  probe.description = "Runs checks from one region.";
  if (data.lastAlive) {
    probe.lastAlive = data.lastAlive;
  }
  probe.probeVersion = new Version(data.version ?? "1.0.2");
  return probe;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("query_workflows — detail mode", () => {
  test("returns the workflow, its recent runs and the log tail of failed runs", async () => {
    jest
      .spyOn(WorkflowService, "findOneById")
      .mockResolvedValue(buildWorkflow() as never);

    /*
     * The failed run's log is longer than the serializer's 500-char field cap
     * and the error line is at the END — the tool must slice the tail so the
     * error survives serialization.
     */
    const failedRunLogs: string =
      "A".repeat(600) + "FATAL: webhook returned 500";

    const logsSpy: jest.SpyInstance = jest
      .spyOn(WorkflowLogService, "findBy")
      .mockResolvedValue([
        buildRun({ status: WorkflowStatus.Error, logs: failedRunLogs }),
        buildRun({ status: WorkflowStatus.Success, logs: "all steps ok" }),
      ] as never);

    const result: ToolExecutionResult = await QueryWorkflowsTool.execute(
      { workflowId: WORKFLOW_ID.toString() },
      ctx,
    );

    // 1 workflow row + 2 run rows.
    expect(result.rowCount).toBe(3);
    expect(result.dataForLlm).toContain("Deploy notifier");
    expect(result.dataForLlm).toContain("FATAL: webhook returned 500");
    // Successful runs carry no log text.
    expect(result.dataForLlm).not.toContain("all steps ok");
    expect(result.dataForLlm).toContain("durationSeconds=42");
    expect(result.citationLabel).toBe(
      'Workflow "Deploy notifier" (2 recent runs)',
    );
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.WorkflowView,
      params: { workflowId: WORKFLOW_ID.toString() },
    });
    expect(result.widget).toBeDefined();

    /*
     * The run query must be scoped to this workflow AND pinned to the tenant
     * (workflowId is an untrusted model argument), under the user's props.
     */
    const callArgs: JSONObject = logsSpy.mock.calls[0]?.[0] as JSONObject;
    expect(String((callArgs["query"] as JSONObject)["workflowId"])).toBe(
      WORKFLOW_ID.toString(),
    );
    expect(String((callArgs["query"] as JSONObject)["projectId"])).toBe(
      ctx.projectId.toString(),
    );
    expect(callArgs["props"]).toBe(ctx.props);
  });

  test("clamps runsLimit to 20", async () => {
    jest
      .spyOn(WorkflowService, "findOneById")
      .mockResolvedValue(buildWorkflow() as never);
    const logsSpy: jest.SpyInstance = jest
      .spyOn(WorkflowLogService, "findBy")
      .mockResolvedValue([] as never);

    await QueryWorkflowsTool.execute(
      { workflowId: WORKFLOW_ID.toString(), runsLimit: 999 },
      ctx,
    );

    const callArgs: JSONObject = logsSpy.mock.calls[0]?.[0] as JSONObject;
    expect(callArgs["limit"]).toBe(20);
  });

  test("a missing workflow is honest: zero rows, no widget", async () => {
    jest.spyOn(WorkflowService, "findOneById").mockResolvedValue(null as never);
    const logsSpy: jest.SpyInstance = jest.spyOn(WorkflowLogService, "findBy");

    const result: ToolExecutionResult = await QueryWorkflowsTool.execute(
      { workflowId: WORKFLOW_ID.toString() },
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.widget).toBeUndefined();
    expect(logsSpy).not.toHaveBeenCalled();
  });
});

describe("query_workflows — list mode", () => {
  test("lists workflows with recent run outcomes", async () => {
    const otherWorkflowId: ObjectID = ObjectID.generate();

    const findBySpy: jest.SpyInstance = jest
      .spyOn(WorkflowService, "findBy")
      .mockResolvedValue([
        buildWorkflow(),
        buildWorkflow({
          id: otherWorkflowId,
          name: "Cleanup job",
          enabled: false,
        }),
      ] as never);
    jest
      .spyOn(WorkflowService, "countBy")
      .mockResolvedValue(new PositiveNumber(2) as never);

    // Most-recent-first, matching the sort the tool requests.
    jest.spyOn(WorkflowLogService, "findBy").mockResolvedValue([
      buildRun({
        status: WorkflowStatus.Error,
        workflowId: WORKFLOW_ID,
        createdAt: new Date("2026-08-14T09:00:00Z"),
      }),
      buildRun({
        status: WorkflowStatus.Success,
        workflowId: WORKFLOW_ID,
        createdAt: new Date("2026-08-14T08:00:00Z"),
      }),
    ] as never);

    const result: ToolExecutionResult = await QueryWorkflowsTool.execute(
      {},
      ctx,
    );

    expect(result.rowCount).toBe(2);
    expect(result.dataForLlm).toContain("Deploy notifier");
    expect(result.dataForLlm).toContain("Cleanup job");
    // The latest run (Error) wins the lastRunStatus slot; one recent failure.
    expect(result.dataForLlm).toContain("lastRunStatus=Error");
    expect(result.dataForLlm).toContain("recentFailures=1");
    expect(result.citationLabel).toBe("Workflows (2 found)");
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.Workflows,
    });
    expect(result.widget).toBeDefined();

    const callArgs: JSONObject = findBySpy.mock.calls[0]?.[0] as JSONObject;
    expect(callArgs["props"]).toBe(ctx.props);
    expect(callArgs["limit"]).toBe(10);
    expect(callArgs["skip"]).toBe(0);
  });

  test("clamps limit/skip and reports the total when paging", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(WorkflowService, "findBy")
      .mockResolvedValue([buildWorkflow()] as never);
    jest
      .spyOn(WorkflowService, "countBy")
      .mockResolvedValue(new PositiveNumber(100) as never);
    jest.spyOn(WorkflowLogService, "findBy").mockResolvedValue([] as never);

    const result: ToolExecutionResult = await QueryWorkflowsTool.execute(
      { limit: 999, skip: -10 },
      ctx,
    );

    const callArgs: JSONObject = findBySpy.mock.calls[0]?.[0] as JSONObject;
    expect(callArgs["limit"]).toBe(25);
    expect(callArgs["skip"]).toBe(0);

    expect(result.dataForLlm).toContain(
      "Showing rows 1–1 of 100 total. Pass skip to page further.",
    );
    expect(result.citationLabel).toBe("Workflows (showing 1 of 100)");
  });

  test("an empty project is honest: zero rows, no widget, no run lookup", async () => {
    jest.spyOn(WorkflowService, "findBy").mockResolvedValue([] as never);
    jest
      .spyOn(WorkflowService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);
    const logsSpy: jest.SpyInstance = jest.spyOn(WorkflowLogService, "findBy");

    const result: ToolExecutionResult = await QueryWorkflowsTool.execute(
      {},
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.widget).toBeUndefined();
    expect(logsSpy).not.toHaveBeenCalled();
  });
});

describe("query_probes", () => {
  function mockMonitorCounts(): jest.SpyInstance {
    const countBySpy: jest.SpyInstance = jest.spyOn(
      MonitorProbeService,
      "countBy",
    );
    countBySpy.mockImplementation((data: unknown): Promise<PositiveNumber> => {
      const query: JSONObject = (data as JSONObject)["query"] as JSONObject;
      const probeId: string = String(query["probeId"]);
      return Promise.resolve(
        new PositiveNumber(probeId === PROJECT_PROBE_ID.toString() ? 3 : 0),
      );
    });
    return countBySpy;
  }

  test("reports health, version and monitor counts for custom and global probes", async () => {
    const probesSpy: jest.SpyInstance = jest
      .spyOn(ProbeService, "findBy")
      .mockResolvedValueOnce([
        buildProbe({
          id: PROJECT_PROBE_ID,
          name: "EU probe",
          lastAlive: OneUptimeDate.getCurrentDate(),
          version: "3.0.1",
        }),
      ] as never)
      .mockResolvedValueOnce([
        buildProbe({
          id: GLOBAL_PROBE_ID,
          name: "Global US",
          lastAlive: OneUptimeDate.getSomeMinutesAgo(10),
        }),
      ] as never);
    const countBySpy: jest.SpyInstance = mockMonitorCounts();

    const result: ToolExecutionResult = await QueryProbesTool.execute({}, ctx);

    expect(result.rowCount).toBe(2);
    expect(result.dataForLlm).toContain("EU probe");
    expect(result.dataForLlm).toContain("status=connected");
    expect(result.dataForLlm).toContain("probeVersion=3.0.1");
    expect(result.dataForLlm).toContain("monitorsServed=3");
    // The stale global probe is judged with the same 3-minute rule.
    expect(result.dataForLlm).toContain("Global US");
    expect(result.dataForLlm).toContain("status=disconnected");
    expect(result.dataForLlm).toContain("isGlobalProbe=true");
    expect(result.citationLabel).toBe("Probes (2 found, 1 disconnected)");
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.Probes,
    });
    expect(result.widget).toBeDefined();

    // Custom probes: the user's own props. Global probes: pinned root query.
    const firstCall: JSONObject = probesSpy.mock.calls[0]?.[0] as JSONObject;
    expect(firstCall["props"]).toBe(ctx.props);
    const secondCall: JSONObject = probesSpy.mock.calls[1]?.[0] as JSONObject;
    expect(secondCall["query"]).toEqual({ isGlobalProbe: true });
    expect((secondCall["props"] as JSONObject)["isRoot"]).toBe(true);

    /*
     * Monitor counts are tenant-scoped: the user's props AND an explicit
     * projectId pin, because global probes serve every project.
     */
    const countCall: JSONObject = countBySpy.mock.calls[0]?.[0] as JSONObject;
    expect(countCall["props"]).toBe(ctx.props);
    expect(String((countCall["query"] as JSONObject)["projectId"])).toBe(
      ctx.projectId.toString(),
    );
  });

  test("a probe at or past the 3-minute cutoff — or with no heartbeat — is disconnected", async () => {
    jest.spyOn(ProbeService, "findBy").mockResolvedValueOnce([
      buildProbe({
        name: "Stale probe",
        lastAlive: OneUptimeDate.getSomeMinutesAgo(3),
      }),
      buildProbe({ name: "Never-seen probe" }),
    ] as never);
    mockMonitorCounts();

    const result: ToolExecutionResult = await QueryProbesTool.execute(
      { includeGlobalProbes: false },
      ctx,
    );

    expect(result.rowCount).toBe(2);
    expect(result.dataForLlm).not.toContain("status=connected");
    expect(result.citationLabel).toBe("Probes (2 found, 2 disconnected)");
  });

  test("includeGlobalProbes=false skips the global fetch", async () => {
    const probesSpy: jest.SpyInstance = jest
      .spyOn(ProbeService, "findBy")
      .mockResolvedValueOnce([
        buildProbe({
          id: PROJECT_PROBE_ID,
          name: "EU probe",
          lastAlive: OneUptimeDate.getCurrentDate(),
        }),
      ] as never);
    mockMonitorCounts();

    const result: ToolExecutionResult = await QueryProbesTool.execute(
      { includeGlobalProbes: false },
      ctx,
    );

    expect(result.rowCount).toBe(1);
    expect(probesSpy).toHaveBeenCalledTimes(1);
  });

  test("clamps the limit argument on both fetches", async () => {
    const probesSpy: jest.SpyInstance = jest
      .spyOn(ProbeService, "findBy")
      .mockResolvedValue([] as never);
    mockMonitorCounts();

    await QueryProbesTool.execute({ limit: 999 }, ctx);

    const firstCall: JSONObject = probesSpy.mock.calls[0]?.[0] as JSONObject;
    expect(firstCall["limit"]).toBe(25);
    const secondCall: JSONObject = probesSpy.mock.calls[1]?.[0] as JSONObject;
    expect(secondCall["limit"]).toBe(25);
  });

  test("no probes at all is honest: zero rows, no widget, no monitor counts", async () => {
    jest.spyOn(ProbeService, "findBy").mockResolvedValue([] as never);
    const countBySpy: jest.SpyInstance = mockMonitorCounts();

    const result: ToolExecutionResult = await QueryProbesTool.execute({}, ctx);

    expect(result.rowCount).toBe(0);
    expect(result.widget).toBeUndefined();
    expect(countBySpy).not.toHaveBeenCalled();
  });
});

describe("query_workflows / query_probes — permissions", () => {
  test("required permissions derive from the model read ACLs", () => {
    expect(QueryWorkflowsTool.requiredPermissions.length).toBeGreaterThan(0);
    expect(QueryProbesTool.requiredPermissions.length).toBeGreaterThan(0);
  });
});
