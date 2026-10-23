import SecurityCaseTriageStatus, {
  ANALYSIS_SETTLEMENT_TIMEOUT_MS,
  REPORT_CLOCK_SKEW_MS,
  SecurityCaseTriageSettlement,
  getSecurityCaseTriageSettlement,
} from "../../../../../Server/Utils/AI/Security/SecurityCaseTriageStatus";
import SecurityCaseTriage from "../../../../../Server/Utils/AI/Security/SecurityCaseTriage";
import AIRunEventService from "../../../../../Server/Services/AIRunEventService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import SecurityCaseService from "../../../../../Server/Services/SecurityCaseService";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../../../../Models/DatabaseModels/AIRunEvent";
import Project from "../../../../../Models/DatabaseModels/Project";
import SecurityCase from "../../../../../Models/DatabaseModels/SecurityCase";
import AIRunEventType from "../../../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * What a case's AI card is told. A run finishes before its report is
 * posted - the engine first weighs how confident the report is - so the
 * card keeps saying Triaging until the run settles, never "Not triaged
 * yet" for a beat; a run that settles without a report says it did not
 * finish; and the evidence describes only the report that is on the case.
 */

const projectId: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const securityCaseId: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const runId: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const NOW: Date = new Date("2026-10-14T12:00:00.000Z");

function settlement(data: {
  status: AIRunStatus;
  completedAt?: Date | undefined;
  hasSettledEvent?: boolean | undefined;
  aiTriagedAt?: Date | undefined;
}): SecurityCaseTriageSettlement {
  return getSecurityCaseTriageSettlement({
    run: {
      status: data.status,
      completedAt: data.completedAt,
    } as Pick<AIRun, "status" | "completedAt">,
    hasSettledEvent: data.hasSettledEvent === true,
    aiTriagedAt: data.aiTriagedAt,
    now: NOW,
  });
}

describe("getSecurityCaseTriageSettlement", () => {
  test("no run: nothing on its way", () => {
    expect(
      getSecurityCaseTriageSettlement({
        run: null,
        hasSettledEvent: false,
        now: NOW,
      }),
    ).toEqual({
      isActive: false,
      isReportPending: false,
      finishedWithoutReport: false,
      isReportFromLatestRun: false,
    });
  });

  test("a queued or running run is on its way", () => {
    expect(settlement({ status: AIRunStatus.Queued }).isActive).toBe(true);
    expect(settlement({ status: AIRunStatus.Running }).isActive).toBe(true);
  });

  test("a finished run whose report is not on the case yet is still pending", () => {
    const completedAt: Date = new Date(NOW.getTime() - 20_000);

    expect(settlement({ status: AIRunStatus.Completed, completedAt })).toEqual({
      isActive: false,
      isReportPending: true,
      finishedWithoutReport: false,
      isReportFromLatestRun: false,
    });
  });

  test("its report on the case settles it", () => {
    const completedAt: Date = new Date(NOW.getTime() - 20_000);

    expect(
      settlement({
        status: AIRunStatus.Completed,
        completedAt,
        aiTriagedAt: new Date(completedAt.getTime() + 5_000),
      }),
    ).toEqual({
      isActive: false,
      isReportPending: false,
      finishedWithoutReport: false,
      isReportFromLatestRun: true,
    });
  });

  test("a report written a moment before the run's own finish time is still its", () => {
    const completedAt: Date = new Date(NOW.getTime() - 20_000);

    expect(
      settlement({
        status: AIRunStatus.Completed,
        completedAt,
        aiTriagedAt: new Date(completedAt.getTime() - REPORT_CLOCK_SKEW_MS + 1),
      }).isReportFromLatestRun,
    ).toBe(true);
  });

  test("an older report is the run before's: a settled run without one finished without a report", () => {
    const completedAt: Date = new Date(NOW.getTime() - 20_000);
    const olderReport: Date = new Date(NOW.getTime() - 24 * 3600 * 1000);

    expect(
      settlement({
        status: AIRunStatus.Completed,
        completedAt,
        hasSettledEvent: true,
        aiTriagedAt: olderReport,
      }),
    ).toEqual({
      isActive: false,
      isReportPending: false,
      finishedWithoutReport: true,
      isReportFromLatestRun: false,
    });
  });

  test("a run that never said it settled is taken as settled after the timeout", () => {
    const longAgo: Date = new Date(
      NOW.getTime() - ANALYSIS_SETTLEMENT_TIMEOUT_MS - 1,
    );

    expect(
      settlement({ status: AIRunStatus.Completed, completedAt: longAgo }),
    ).toMatchObject({ isReportPending: false, finishedWithoutReport: true });
  });

  test("a failed run is neither pending nor said to have finished", () => {
    for (const status of [
      AIRunStatus.Error,
      AIRunStatus.Cancelled,
      AIRunStatus.Stale,
    ]) {
      expect(settlement({ status })).toEqual({
        isActive: false,
        isReportPending: false,
        finishedWithoutReport: false,
        isReportFromLatestRun: false,
      });
    }
  });
});

describe("SecurityCaseTriageStatus.read", () => {
  let findEvents: jest.SpyInstance;
  let reason: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate"] });
    findEvents = jest.spyOn(AIRunEventService, "findBy").mockResolvedValue([]);
    reason = jest
      .spyOn(SecurityCaseTriage, "getNotStartedReason")
      .mockResolvedValue(null);
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      enableAutomaticSecurityCaseTriage: true,
    } as unknown as Project);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("no triage yet: no run, what would stop one, and whether new cases are triaged", async () => {
    jest.spyOn(SecurityCaseTriage, "findLatestRun").mockResolvedValue(null);
    reason.mockResolvedValue("provider_missing");

    const body: JSONObject = await SecurityCaseTriageStatus.read({
      projectId,
      securityCaseId,
    });

    expect(body["run"]).toBeNull();
    expect(body["steps"]).toEqual([]);
    expect(body["evidence"]).toEqual([]);
    expect(body["isReportPending"]).toBe(false);
    expect(body["notStartedReason"]).toEqual({
      code: "provider_missing",
      message:
        "No LLM provider is set up for OneUptime AI. Add one in Project Settings → AI → LLM Providers.",
    });
    expect(body["isAutomaticTriageOn"]).toBe(true);
    // A person's request is what the card offers: the automatic switch aside.
    expect(reason).toHaveBeenCalledWith({ projectId, automatic: false });
    expect(findEvents).not.toHaveBeenCalled();
  });

  test("while it runs: the checks made so far, tool by tool, and no reason", async () => {
    jest.spyOn(SecurityCaseTriage, "findLatestRun").mockResolvedValue({
      id: runId,
      status: AIRunStatus.Running,
      toolCallCount: 2,
    } as unknown as AIRun);
    jest
      .spyOn(SecurityCaseService, "findOneBy")
      .mockResolvedValue({} as SecurityCase);
    findEvents.mockResolvedValue([
      { eventType: AIRunEventType.RunStarted },
      {
        eventType: AIRunEventType.ToolCallStarted,
        toolName: "query_security_cases",
      },
      {
        eventType: AIRunEventType.ToolCallCompleted,
        toolName: "query_security_cases",
        resultSummary: { rowCount: 3 },
      },
      {
        eventType: AIRunEventType.ToolCallFailed,
        toolName: "lookup_threat_intel",
        resultSummary: { errorMessage: "ClickHouse down" },
      },
    ] as unknown as Array<AIRunEvent>);

    const body: JSONObject = await SecurityCaseTriageStatus.read({
      projectId,
      securityCaseId,
    });

    expect(body["steps"]).toEqual([
      { toolName: "query_security_cases", failed: false, rowCount: 3 },
      { toolName: "lookup_threat_intel", failed: true },
    ]);
    expect(body["notStartedReason"]).toBeNull();
    expect(reason).not.toHaveBeenCalled();
    // The tool arguments are not read while it runs.
    expect(
      (findEvents.mock.calls[0]![0] as { select: JSONObject }).select[
        "toolArguments"
      ],
    ).toBeUndefined();
  });

  test("finished, its report on the case: the report's evidence, rebuilt from the run's own calls", async () => {
    const completedAt: Date = new Date(NOW.getTime() - 60_000);

    jest.spyOn(SecurityCaseTriage, "findLatestRun").mockResolvedValue({
      id: runId,
      status: AIRunStatus.Completed,
      completedAt,
      toolCallCount: 1,
      totalTokens: 1234,
    } as unknown as AIRun);
    jest.spyOn(SecurityCaseService, "findOneBy").mockResolvedValue({
      aiTriagedAt: new Date(completedAt.getTime() + 2_000),
      aiTriageReport:
        "## 🧠 AI — Security Case Triage\n\nKnown-bad [C1].\n\n**Evidence checked**\n- **[C1]** Threat intel lookup — 1 row(s)",
    } as unknown as SecurityCase);
    findEvents.mockResolvedValue([
      {
        sequence: 1,
        eventType: AIRunEventType.ToolCallStarted,
        toolName: "lookup_threat_intel",
        toolArguments: { values: ["203.0.113.9"] },
        createdAt: new Date(completedAt.getTime() - 10_000),
      },
      {
        sequence: 2,
        eventType: AIRunEventType.ToolCallCompleted,
        toolName: "lookup_threat_intel",
        citationId: "C1",
        resultSummary: { rowCount: 1, citationLabel: "Threat intel lookup" },
        createdAt: new Date(completedAt.getTime() - 9_000),
      },
      { sequence: 3, eventType: AIRunEventType.RunCompleted },
    ] as unknown as Array<AIRunEvent>);

    const body: JSONObject = await SecurityCaseTriageStatus.read({
      projectId,
      securityCaseId,
    });

    expect(body["isReportPending"]).toBe(false);
    expect(body["finishedWithoutReport"]).toBe(false);
    expect(body["steps"]).toEqual([]);
    expect(body["run"]).toMatchObject({
      _id: runId.toString(),
      status: AIRunStatus.Completed,
      toolCallCount: 1,
      totalTokens: 1234,
      errorMessage: null,
    });

    const evidence: Array<JSONObject> = body["evidence"] as Array<JSONObject>;

    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      citationId: "C1",
      toolName: "lookup_threat_intel",
      label: "Threat intel lookup",
      rowCount: 1,
      queryArguments: { values: ["203.0.113.9"] },
      canLoadRows: true,
    });
    // The arguments are read for a finished run's evidence.
    expect(
      (findEvents.mock.calls[0]![0] as { select: JSONObject }).select[
        "toolArguments"
      ],
    ).toBe(true);
  });

  test("finished, its report still being written: pending, with its checks", async () => {
    jest.spyOn(SecurityCaseTriage, "findLatestRun").mockResolvedValue({
      id: runId,
      status: AIRunStatus.Completed,
      completedAt: new Date(NOW.getTime() - 5_000),
    } as unknown as AIRun);
    jest
      .spyOn(SecurityCaseService, "findOneBy")
      .mockResolvedValue({} as SecurityCase);
    findEvents.mockResolvedValue([
      {
        eventType: AIRunEventType.ToolCallCompleted,
        toolName: "search_security_events",
        resultSummary: { rowCount: 40 },
      },
    ] as unknown as Array<AIRunEvent>);

    const body: JSONObject = await SecurityCaseTriageStatus.read({
      projectId,
      securityCaseId,
    });

    expect(body["isReportPending"]).toBe(true);
    expect(body["evidence"]).toEqual([]);
    expect(body["steps"]).toEqual([
      { toolName: "search_security_events", failed: false, rowCount: 40 },
    ]);
    expect(body["notStartedReason"]).toBeNull();
  });

  test("a run that failed says why", async () => {
    jest.spyOn(SecurityCaseTriage, "findLatestRun").mockResolvedValue({
      id: runId,
      status: AIRunStatus.Error,
      errorMessage: "The model provider refused the request.",
    } as unknown as AIRun);
    jest
      .spyOn(SecurityCaseService, "findOneBy")
      .mockResolvedValue({} as SecurityCase);

    const body: JSONObject = await SecurityCaseTriageStatus.read({
      projectId,
      securityCaseId,
    });

    expect((body["run"] as JSONObject)["errorMessage"]).toBe(
      "The model provider refused the request.",
    );
    expect(body["notStartedReason"]).toBeNull();
    expect(reason).toHaveBeenCalled();
  });

  test("each read is the project's own, as root", async () => {
    const latest: jest.SpyInstance = jest
      .spyOn(SecurityCaseTriage, "findLatestRun")
      .mockResolvedValue({
        id: runId,
        status: AIRunStatus.Running,
      } as unknown as AIRun);
    const findCase: jest.SpyInstance = jest
      .spyOn(SecurityCaseService, "findOneBy")
      .mockResolvedValue({} as SecurityCase);

    await SecurityCaseTriageStatus.read({ projectId, securityCaseId });

    expect(latest).toHaveBeenCalledWith({ projectId, securityCaseId });
    expect(findCase.mock.calls[0]![0]).toMatchObject({
      query: { _id: securityCaseId, projectId },
      props: { isRoot: true },
    });
    expect(findEvents.mock.calls[0]![0]).toMatchObject({
      query: { projectId, aiRunId: runId },
      props: { isRoot: true },
    });
  });
});
