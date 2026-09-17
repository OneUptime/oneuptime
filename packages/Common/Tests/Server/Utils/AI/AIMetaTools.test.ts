import {
  GetAIInvestigationTool,
  QueryAIInsightsTool,
  StartInvestigationTool,
} from "../../../../Server/Utils/AI/Toolbox/AIMetaTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import AIRunService from "../../../../Server/Services/AIRunService";
import AIInsightService from "../../../../Server/Services/AIInsightService";
import IncidentService from "../../../../Server/Services/IncidentService";
import AlertService from "../../../../Server/Services/AlertService";
import PostedRootCause from "../../../../Server/Utils/AI/SRE/PostedRootCause";
import AIInvestigationQueue from "../../../../Server/Utils/AI/SRE/InvestigationQueue";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIInsight from "../../../../Models/DatabaseModels/AIInsight";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import AIInsightStatus from "../../../../Types/AI/AIInsightStatus";
import AIInsightSeverity from "../../../../Types/AI/AIInsightSeverity";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * The AI meta tools make the chat aware of the platform's other AI lanes:
 * get_ai_investigation reads the autonomous RCA for one incident/alert,
 * query_ai_insights lists preventive detector findings, start_investigation
 * enqueues a run through the same durable queue the automatic lanes use.
 * These tests lock in what the model (and the queue) rely on: subject
 * visibility runs under the user's RBAC, dedupe never double-enqueues, empty
 * results are honest, and tenancy comes from ctx — never from an argument.
 */

const ctx: ToolContext = {
  projectId: ObjectID.generate(),
  props: { isRoot: true },
};

const INCIDENT_ID: ObjectID = ObjectID.generate();
const ALERT_ID: ObjectID = ObjectID.generate();
const MONITOR_ID: ObjectID = ObjectID.generate();
const RUN_ID: ObjectID = ObjectID.generate();

function buildIncident(): Incident {
  const incident: Incident = new Incident();
  incident._id = INCIDENT_ID.toString();
  incident.incidentNumber = 12;

  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  incident.monitors = [monitor];

  return incident;
}

function buildAlert(): Alert {
  const alert: Alert = new Alert();
  alert._id = ALERT_ID.toString();
  alert.alertNumber = 7;
  alert.monitorId = MONITOR_ID;
  return alert;
}

function buildRun(data?: {
  status?: AIRunStatus;
  analysisTldr?: string;
  errorMessage?: string;
}): AIRun {
  const run: AIRun = new AIRun();
  run._id = RUN_ID.toString();
  run.status = data?.status ?? AIRunStatus.Completed;
  if (data?.analysisTldr) {
    run.analysisTldr = data.analysisTldr;
  }
  if (data?.errorMessage) {
    run.errorMessage = data.errorMessage;
  }
  run.createdAt = new Date("2026-08-14T10:00:00Z");
  run.startedAt = new Date("2026-08-14T10:00:05Z");
  run.completedAt = new Date("2026-08-14T10:02:00Z");
  run.attemptCount = 1;
  return run;
}

function buildInsight(data?: {
  title?: string;
  status?: AIInsightStatus;
  severity?: AIInsightSeverity;
}): AIInsight {
  const insight: AIInsight = new AIInsight();
  insight._id = ObjectID.generate().toString();
  insight.title = data?.title ?? "Error log spike in checkout-service";
  insight.status = data?.status ?? AIInsightStatus.ActionRequired;
  insight.severity = data?.severity ?? AIInsightSeverity.High;
  insight.serviceName = "checkout-service";
  insight.occurrenceCount = 3;
  insight.firstSeenAt = new Date("2026-08-13T08:00:00Z");
  insight.lastSeenAt = new Date("2026-08-14T09:00:00Z");
  return insight;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("get_ai_investigation — incident path", () => {
  test("returns the completed run with its posted analysis and a view citation", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(buildIncident() as never);
    const findBySpy: jest.SpyInstance = jest
      .spyOn(AIRunService, "findBy")
      .mockResolvedValue([
        buildRun({ analysisTldr: "Cache stampede after the 09:40 deploy." }),
      ] as never);
    jest
      .spyOn(PostedRootCause, "getForInvestigation")
      .mockResolvedValue(
        "## AI — Automated Root Cause Analysis\nThe cache stampede began after deploy 4711.",
      );

    const result: ToolExecutionResult = await GetAIInvestigationTool.execute(
      { incidentId: INCIDENT_ID.toString() },
      ctx,
    );

    expect(result.rowCount).toBe(1);
    expect(result.dataForLlm).toContain("Cache stampede after the 09:40");
    expect(result.dataForLlm).toContain("The cache stampede began after");
    expect(result.dataForLlm).toContain(AIRunStatus.Completed);
    expect(result.citationLabel).toBe(
      "AI investigation for Incident #12 (1 run)",
    );
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.IncidentView,
      params: { incidentId: INCIDENT_ID.toString() },
    });
    expect(result.widget).toBeDefined();

    /*
     * The run query must be scoped to this incident's investigation lane
     * and run under the requesting user's props.
     */
    const callArgs: JSONObject = findBySpy.mock.calls[0]?.[0] as JSONObject;
    const query: JSONObject = callArgs["query"] as JSONObject;
    expect(query["runType"]).toBe(AIRunType.Investigation);
    expect((query["triggeredByIncidentId"] as ObjectID).toString()).toBe(
      INCIDENT_ID.toString(),
    );
    // Tenancy is pinned from ctx — never from an argument.
    expect(query["projectId"]).toBe(ctx.projectId);
    /*
     * The run read deliberately uses root props: investigation runs carry no
     * userId, so the AIRun privacy pin would hide them from every regular
     * member. Access is authorized by the user-props subject fetch above and
     * the projectId pin asserted here.
     */
    expect(callArgs["props"]).toStrictEqual({ isRoot: true });
  });

  test("a still-running investigation says so and fetches no analysis", async () => {
    jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue(buildAlert() as never);
    jest
      .spyOn(AIRunService, "findBy")
      .mockResolvedValue([buildRun({ status: AIRunStatus.Running })] as never);
    const analysisSpy: jest.SpyInstance = jest.spyOn(
      PostedRootCause,
      "getForInvestigation",
    );

    const result: ToolExecutionResult = await GetAIInvestigationTool.execute(
      { alertId: ALERT_ID.toString() },
      ctx,
    );

    expect(result.dataForLlm).toContain("still RUNNING");
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.AlertView,
      params: { alertId: ALERT_ID.toString() },
    });
    expect(analysisSpy).not.toHaveBeenCalled();
  });

  test("an inconclusive analysis carries the quiet-mode honesty note", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(buildIncident() as never);
    jest.spyOn(AIRunService, "findBy").mockResolvedValue([
      buildRun({
        analysisTldr: "The evidence was inconclusive; telemetry is missing.",
      }),
    ] as never);
    jest.spyOn(PostedRootCause, "getForInvestigation").mockResolvedValue(null);

    const result: ToolExecutionResult = await GetAIInvestigationTool.execute(
      { incidentId: INCIDENT_ID.toString() },
      ctx,
    );

    expect(result.dataForLlm).toContain("INCONCLUSIVE");
    expect(result.dataForLlm).toContain("quiet mode");
  });

  test("a failed run surfaces its error message honestly", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(buildIncident() as never);
    jest.spyOn(AIRunService, "findBy").mockResolvedValue([
      buildRun({
        status: AIRunStatus.Error,
        errorMessage: "No LLM provider configured.",
      }),
    ] as never);

    const result: ToolExecutionResult = await GetAIInvestigationTool.execute(
      { incidentId: INCIDENT_ID.toString() },
      ctx,
    );

    expect(result.dataForLlm).toContain("did NOT produce an analysis");
    expect(result.dataForLlm).toContain("No LLM provider configured.");
  });

  test("no runs is honest: zero rows, no widget, points at start_investigation", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(buildIncident() as never);
    jest.spyOn(AIRunService, "findBy").mockResolvedValue([] as never);

    const result: ToolExecutionResult = await GetAIInvestigationTool.execute(
      { incidentId: INCIDENT_ID.toString() },
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.widget).toBeUndefined();
    expect(result.dataForLlm).toContain("start_investigation");
  });

  test("requires exactly one of incidentId/alertId", async () => {
    const neither: ToolExecutionResult = await GetAIInvestigationTool.execute(
      {},
      ctx,
    );
    expect(neither.rowCount).toBe(0);
    expect(neither.dataForLlm).toContain("Error:");

    const both: ToolExecutionResult = await GetAIInvestigationTool.execute(
      { incidentId: INCIDENT_ID.toString(), alertId: ALERT_ID.toString() },
      ctx,
    );
    expect(both.rowCount).toBe(0);
    expect(both.dataForLlm).toContain("Error:");
  });

  test("an invisible subject is an error envelope, not a leak", async () => {
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(null as never);

    const result: ToolExecutionResult = await GetAIInvestigationTool.execute(
      { incidentId: INCIDENT_ID.toString() },
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toContain("not found");
    expect(result.widget).toBeUndefined();
  });

  test("required permissions derive from the AIRun read ACL", () => {
    expect(GetAIInvestigationTool.requiredPermissions.length).toBeGreaterThan(
      0,
    );
  });
});

describe("query_ai_insights", () => {
  test("lists recent insights with filters reaching the service query", async () => {
    const serviceId: ObjectID = ObjectID.generate();
    jest
      .spyOn(AIInsightService, "countBy")
      .mockResolvedValue(new PositiveNumber(2) as never);
    const findBySpy: jest.SpyInstance = jest
      .spyOn(AIInsightService, "findBy")
      .mockResolvedValue([
        buildInsight(),
        buildInsight({
          title: "p99 latency regression on /checkout",
          severity: AIInsightSeverity.Medium,
        }),
      ] as never);

    const result: ToolExecutionResult = await QueryAIInsightsTool.execute(
      {
        serviceId: serviceId.toString(),
        // Case-insensitive status matching — the model rarely gets casing right.
        status: "actionrequired",
      },
      ctx,
    );

    expect(result.rowCount).toBe(2);
    expect(result.dataForLlm).toContain("Error log spike in checkout-service");
    expect(result.dataForLlm).toContain("p99 latency regression");
    expect(result.citationLabel).toBe("AI insights, last 7d (2 found)");
    expect(result.citationTarget).toBeUndefined();
    expect(result.widget).toBeDefined();

    const callArgs: JSONObject = findBySpy.mock.calls[0]?.[0] as JSONObject;
    const query: JSONObject = callArgs["query"] as JSONObject;
    expect((query["telemetryServiceId"] as ObjectID).toString()).toBe(
      serviceId.toString(),
    );
    expect(query["status"]).toBe(AIInsightStatus.ActionRequired);
    expect(query["lastSeenAt"]).toBeDefined();
    expect(query["projectId"]).toBe(ctx.projectId);
    expect(callArgs["props"]).toBe(ctx.props);
    expect(callArgs["limit"]).toBe(10);
  });

  test("clamps lookbackDays and limit", async () => {
    jest
      .spyOn(AIInsightService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);
    const findBySpy: jest.SpyInstance = jest
      .spyOn(AIInsightService, "findBy")
      .mockResolvedValue([] as never);

    const result: ToolExecutionResult = await QueryAIInsightsTool.execute(
      { lookbackDays: 10000, limit: 999 },
      ctx,
    );

    expect(result.citationLabel).toBe("AI insights, last 90d (0 found)");

    const callArgs: JSONObject = findBySpy.mock.calls[0]?.[0] as JSONObject;
    expect(callArgs["limit"]).toBe(25);
  });

  test("paginates: skip reaches the query and the total is disclosed", async () => {
    jest
      .spyOn(AIInsightService, "countBy")
      .mockResolvedValue(new PositiveNumber(30) as never);
    const findBySpy: jest.SpyInstance = jest
      .spyOn(AIInsightService, "findBy")
      .mockResolvedValue([buildInsight(), buildInsight()] as never);

    const result: ToolExecutionResult = await QueryAIInsightsTool.execute(
      { skip: 5, limit: 2 },
      ctx,
    );

    expect(result.dataForLlm).toContain(
      "Showing rows 6–7 of 30 total. Pass skip to page further.",
    );
    expect(result.citationLabel).toBe("AI insights, last 7d (30 found)");

    const callArgs: JSONObject = findBySpy.mock.calls[0]?.[0] as JSONObject;
    expect(callArgs["skip"]).toBe(5);
  });

  test("an invalid status filter is an error envelope listing valid values", async () => {
    const findBySpy: jest.SpyInstance = jest.spyOn(AIInsightService, "findBy");

    const result: ToolExecutionResult = await QueryAIInsightsTool.execute(
      { status: "Exploded" },
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toContain("Error:");
    expect(result.dataForLlm).toContain(AIInsightStatus.ActionRequired);
    expect(findBySpy).not.toHaveBeenCalled();
  });

  test("an empty window is honest: zero rows and no widget", async () => {
    jest
      .spyOn(AIInsightService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);
    jest.spyOn(AIInsightService, "findBy").mockResolvedValue([] as never);

    const result: ToolExecutionResult = await QueryAIInsightsTool.execute(
      {},
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.widget).toBeUndefined();
  });

  test("required permissions derive from the AIInsight read ACL", () => {
    expect(QueryAIInsightsTool.requiredPermissions.length).toBeGreaterThan(0);
  });
});

describe("start_investigation", () => {
  test("enqueues through the durable queue with ctx tenancy and the monitor dedupe key", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(buildIncident() as never);
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);
    const enqueueSpy: jest.SpyInstance = jest
      .spyOn(AIInvestigationQueue, "enqueue")
      .mockResolvedValue(RUN_ID as never);

    const result: ToolExecutionResult = await StartInvestigationTool.execute(
      // A hostile projectId argument must be ignored — tenancy is ctx-only.
      { incidentId: INCIDENT_ID.toString(), projectId: "attacker-project" },
      ctx,
    );

    expect(result.rowCount).toBe(1);
    expect(result.dataForLlm).toContain("Queued AI investigation run");
    expect(result.dataForLlm).toContain("get_ai_investigation");
    expect(result.citationLabel).toBe(
      "AI investigation queued for Incident #12",
    );
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.IncidentView,
      params: { incidentId: INCIDENT_ID.toString() },
    });
    expect(result.widget).toBeDefined();

    const enqueueArgs: JSONObject = enqueueSpy.mock.calls[0]?.[0] as JSONObject;
    expect(enqueueArgs["projectId"]).toBe(ctx.projectId);
    expect((enqueueArgs["subjectIncidentId"] as ObjectID).toString()).toBe(
      INCIDENT_ID.toString(),
    );
    expect((enqueueArgs["subjectMonitorId"] as ObjectID).toString()).toBe(
      MONITOR_ID.toString(),
    );
    expect(enqueueArgs["subjectAlertId"]).toBeUndefined();
  });

  test("alert path passes the alert's monitor as the dedupe key", async () => {
    jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue(buildAlert() as never);
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);
    const enqueueSpy: jest.SpyInstance = jest
      .spyOn(AIInvestigationQueue, "enqueue")
      .mockResolvedValue(RUN_ID as never);

    const result: ToolExecutionResult = await StartInvestigationTool.execute(
      { alertId: ALERT_ID.toString() },
      ctx,
    );

    expect(result.rowCount).toBe(1);
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.AlertView,
      params: { alertId: ALERT_ID.toString() },
    });

    const enqueueArgs: JSONObject = enqueueSpy.mock.calls[0]?.[0] as JSONObject;
    expect((enqueueArgs["subjectAlertId"] as ObjectID).toString()).toBe(
      ALERT_ID.toString(),
    );
    expect((enqueueArgs["subjectMonitorId"] as ObjectID).toString()).toBe(
      MONITOR_ID.toString(),
    );
    expect(enqueueArgs["subjectIncidentId"]).toBeUndefined();
  });

  test("a live run means no duplicate: clear message, no enqueue", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(buildIncident() as never);
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValueOnce(new PositiveNumber(1) as never);
    const enqueueSpy: jest.SpyInstance = jest.spyOn(
      AIInvestigationQueue,
      "enqueue",
    );

    const result: ToolExecutionResult = await StartInvestigationTool.execute(
      { incidentId: INCIDENT_ID.toString() },
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toContain("already queued or running");
    expect(result.widget).toBeUndefined();
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  test("a run inside the 30-minute cooldown means no duplicate either", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(buildIncident() as never);
    jest
      .spyOn(AIRunService, "countBy")
      // First count: live runs (none). Second count: runs in the cooldown window (one).
      .mockResolvedValueOnce(new PositiveNumber(0) as never)
      .mockResolvedValueOnce(new PositiveNumber(1) as never);
    const enqueueSpy: jest.SpyInstance = jest.spyOn(
      AIInvestigationQueue,
      "enqueue",
    );

    const result: ToolExecutionResult = await StartInvestigationTool.execute(
      { incidentId: INCIDENT_ID.toString() },
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toContain("recent AI investigation");
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  test("a budget quiet-skip (enqueue returns null) is reported honestly", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(buildIncident() as never);
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);
    jest.spyOn(AIInvestigationQueue, "enqueue").mockResolvedValue(null);

    const result: ToolExecutionResult = await StartInvestigationTool.execute(
      { incidentId: INCIDENT_ID.toString() },
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toContain("could not be enqueued");
    expect(result.widget).toBeUndefined();
  });

  test("rejects missing/ambiguous subject arguments", async () => {
    await expect(StartInvestigationTool.execute({}, ctx)).rejects.toThrow(
      BadDataException,
    );
    await expect(
      StartInvestigationTool.execute(
        { incidentId: INCIDENT_ID.toString(), alertId: ALERT_ID.toString() },
        ctx,
      ),
    ).rejects.toThrow(BadDataException);
  });

  test("rejects a subject the user cannot see", async () => {
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(null as never);

    await expect(
      StartInvestigationTool.execute(
        { incidentId: INCIDENT_ID.toString() },
        ctx,
      ),
    ).rejects.toThrow("Incident not found");
  });

  test("buildActionTitle names the subject from validated args", () => {
    expect(
      StartInvestigationTool.buildActionTitle?.({
        incidentId: INCIDENT_ID.toString(),
      }),
    ).toBe(`Start AI investigation for incident ${INCIDENT_ID.toString()}`);
    expect(
      StartInvestigationTool.buildActionTitle?.({
        alertId: ALERT_ID.toString(),
      }),
    ).toBe(`Start AI investigation for alert ${ALERT_ID.toString()}`);
  });

  test("is a mutation gated by the subject models' update ACLs", () => {
    expect(StartInvestigationTool.isMutation).toBe(true);
    expect(StartInvestigationTool.requiredPermissions.length).toBeGreaterThan(
      0,
    );
  });
});
