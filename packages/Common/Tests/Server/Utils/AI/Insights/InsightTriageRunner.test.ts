import InsightTriageRunner from "../../../../../Server/Utils/AI/SRE/Insights/InsightTriageRunner";
import AIInvestigationEngine, {
  InvestigationRequest,
} from "../../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import AIInvestigationQueue from "../../../../../Server/Utils/AI/SRE/InvestigationQueue";
import InstrumentationTaskTrigger from "../../../../../Server/Utils/AI/SRE/InstrumentationTaskTrigger";
import { ConfidenceSignal } from "../../../../../Server/Utils/AI/SRE/ConfidenceSignal";
import { ObservabilityAssistantResult } from "../../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import AIInsightService from "../../../../../Server/Services/AIInsightService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import TelemetryExceptionService from "../../../../../Server/Services/TelemetryExceptionService";
import IncidentFeedService from "../../../../../Server/Services/IncidentFeedService";
import AlertFeedService from "../../../../../Server/Services/AlertFeedService";
import { AI_INSIGHT_TRIAGE_FEATURE } from "../../../../../Server/Services/AIService";
import InsightFixRouting from "../../../../../Server/Utils/AI/SRE/Insights/FixRouting";
import AIInsight from "../../../../../Models/DatabaseModels/AIInsight";
import Project from "../../../../../Models/DatabaseModels/Project";
import AIInsightType from "../../../../../Types/AI/AIInsightType";
import AIInsightSeverity from "../../../../../Types/AI/AIInsightSeverity";
import AIInsightStatus from "../../../../../Types/AI/AIInsightStatus";
import ExceptionAIClassification from "../../../../../Types/AI/ExceptionAIClassification";
import ObjectID from "../../../../../Types/ObjectID";
import TelemetryAiRules from "../../../../../Server/Utils/AI/TelemetryAi/TelemetryAiRules";
import { decideTelemetryAiWork } from "../../../../../Types/AI/TelemetryAi";
import { NO_EXTERNAL_MCP_SERVER } from "../../../../../Types/AI/ExternalMcpServer/ExternalMcpServerAllowance";
import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * The insight triage runner — the Preventive lane's quiet-inbox executor.
 * The invariants these tests lock in:
 *   (a) a context-build failure (insight gone, db error) hands the CLAIMED
 *       run to the queue's retry policy as NON-permanent, and the engine
 *       never runs;
 *   (b) the engine request carries the dedicated budgeted feature label
 *       (AI_INSIGHT_TRIAGE_FEATURE — G4) and a context that recasts
 *       the run as preventive triage of the detector's finding;
 *   (c) postAnalysis writes triageSummaryMarkdown + triageCompletedAt onto
 *       the insight row and NOTHING else — no feed items, no workspace
 *       notification, no instrumentation-task trigger. Insights never page.
 */

const aiRunId: ObjectID = ObjectID.generate();
const projectId: ObjectID = ObjectID.generate();
const sentinelInsightId: ObjectID = ObjectID.generate();

function makeInsight(overrides: Partial<AIInsight> = {}): AIInsight {
  return {
    id: sentinelInsightId,
    projectId,
    insightType: AIInsightType.ExceptionSpike,
    severity: AIInsightSeverity.High,
    title: "Spike: NullPointerException in checkout",
    detailMarkdown: "Recent hour: 240 occurrences vs a baseline of 4/hour.",
    serviceName: "checkout",
    evidence: {
      exception: {
        exceptionMessage: "NullPointerException",
        recentOccurrenceCount: 240,
        baselineHourlyAverage: 4,
        spikeMultiplier: 60,
      },
    },
    ...overrides,
  } as unknown as AIInsight;
}

/*
 * Harness for the verdict-driven follow-through: the engine is mocked to
 * immediately drive postAnalysis with the given analysis text, exactly the
 * way the real engine hands over its result.
 */
function driveTriageWithAnalysis(analysisMarkdown: string): void {
  jest
    .spyOn(AIInvestigationEngine, "executeRun")
    .mockImplementation(
      async (data: {
        aiRunId: ObjectID;
        projectId: ObjectID;
        attemptCount: number;
        request: InvestigationRequest;
      }): Promise<void> => {
        await data.request.postAnalysis({
          analysisMarkdown,
          confidence: makeConfidence(),
          result: {} as unknown as ObservabilityAssistantResult,
        });
      },
    );
}

function makeConfidence(): ConfidenceSignal {
  return { confident: true, source: "classification" };
}

describe("InsightTriageRunner.executeTriage", () => {
  /*
   * New and spiking exceptions are the Exceptions lane's while its switch
   * is on, and AI Insights' while it is off: the runner reads the project
   * to tell. By default here it is off - AI Insights' triage, as these
   * tests were written for; a test that needs the project says so itself.
   */
  beforeEach(() => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: projectId,
      enableAi: true,
      enableAutomaticExceptionRemediation: false,
    } as unknown as Project);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a context-build failure hands the claimed run to the retry policy (non-permanent)", async () => {
    jest
      .spyOn(AIInsightService, "findOneById")
      .mockRejectedValue(new Error("db down"));
    const failOrRequeue: jest.SpyInstance = jest
      .spyOn(AIInvestigationQueue, "failOrRequeue")
      .mockResolvedValue("requeued");
    const executeRun: jest.SpyInstance = jest.spyOn(
      AIInvestigationEngine,
      "executeRun",
    );

    await InsightTriageRunner.executeTriage({
      aiRunId,
      projectId,
      sentinelInsightId,
      attemptCount: 1,
    });

    expect(failOrRequeue).toHaveBeenCalledWith(
      expect.objectContaining({
        aiRunId,
        attemptCount: 1,
        isPermanent: false,
      }),
    );
    expect(executeRun).not.toHaveBeenCalled();
  });

  test("a deleted insight is also a non-permanent context failure", async () => {
    jest.spyOn(AIInsightService, "findOneById").mockResolvedValue(null);
    const failOrRequeue: jest.SpyInstance = jest
      .spyOn(AIInvestigationQueue, "failOrRequeue")
      .mockResolvedValue("requeued");

    await InsightTriageRunner.executeTriage({
      aiRunId,
      projectId,
      sentinelInsightId,
      attemptCount: 1,
    });

    expect(failOrRequeue).toHaveBeenCalledWith(
      expect.objectContaining({ isPermanent: false }),
    );
  });

  test("the engine request carries the triage feature and a preventive-triage context built from the insight", async () => {
    jest
      .spyOn(AIInsightService, "findOneById")
      .mockResolvedValue(makeInsight());
    const executeRun: jest.SpyInstance = jest
      .spyOn(AIInvestigationEngine, "executeRun")
      .mockResolvedValue(undefined);

    await InsightTriageRunner.executeTriage({
      aiRunId,
      projectId,
      sentinelInsightId,
      attemptCount: 1,
    });

    expect(executeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        aiRunId,
        projectId,
        attemptCount: 1,
        request: expect.objectContaining({
          feature: AI_INSIGHT_TRIAGE_FEATURE,
        }),
      }),
    );

    const request: InvestigationRequest = (
      executeRun.mock.calls[0]![0] as {
        request: InvestigationRequest;
      }
    ).request;

    // Recast as preventive triage — no incident exists, a sensor filed this.
    expect(request.contextSummary).toContain("PREVENTIVE TRIAGE");
    expect(request.contextSummary).toContain("ONE next action");
    // The subject description: type, title and the detector's evidence.
    expect(request.contextSummary).toContain(AIInsightType.ExceptionSpike);
    expect(request.contextSummary).toContain(
      "Spike: NullPointerException in checkout",
    );
    expect(request.contextSummary).toContain(
      "Recent hour: 240 occurrences vs a baseline of 4/hour.",
    );
    // The raw evidence numbers rendered compactly.
    expect(request.contextSummary).toContain('"spikeMultiplier":60');
  });

  test("postAnalysis writes the summary onto the insight row — and notifies NOTHING (quiet inbox)", async () => {
    jest
      .spyOn(AIInsightService, "findOneById")
      .mockResolvedValue(makeInsight());
    const persist: jest.SpyInstance = jest
      .spyOn(AIInsightService, "updateOneById")
      .mockResolvedValue(1);
    const incidentFeed: jest.SpyInstance = jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined);
    const alertFeed: jest.SpyInstance = jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockResolvedValue(undefined);
    const instrumentationTrigger: jest.SpyInstance = jest
      .spyOn(InstrumentationTaskTrigger, "enqueueForInconclusiveInvestigation")
      .mockResolvedValue(undefined);

    // Drive the engine's postAnalysis callback the way the real engine does.
    jest
      .spyOn(AIInvestigationEngine, "executeRun")
      .mockImplementation(
        async (data: {
          aiRunId: ObjectID;
          projectId: ObjectID;
          attemptCount: number;
          request: InvestigationRequest;
        }): Promise<void> => {
          await data.request.postAnalysis({
            analysisMarkdown: "## 🧠 AI SRE — branded triage analysis",
            confidence: makeConfidence(),
            result: {} as unknown as ObservabilityAssistantResult,
          });
        },
      );

    await InsightTriageRunner.executeTriage({
      aiRunId,
      projectId,
      sentinelInsightId,
      attemptCount: 1,
    });

    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        id: sentinelInsightId,
        data: expect.objectContaining({
          triageSummaryMarkdown: "## 🧠 AI SRE — branded triage analysis",
          triageCompletedAt: expect.any(Date),
        }),
        props: expect.objectContaining({ isRoot: true }),
      }),
    );

    /*
     * The quiet-inbox rule: insights never page and never enter the
     * notification pipeline — zero feed items, zero workspace pings, zero
     * autonomous follow-up tasks from triage (v1).
     */
    expect(incidentFeed).not.toHaveBeenCalled();
    expect(alertFeed).not.toHaveBeenCalled();
    expect(instrumentationTrigger).not.toHaveBeenCalled();
  });

  test("a code-fault verdict stamps the exception, routes the fix post-triage, and flips the insight to FixOpened", async () => {
    const telemetryExceptionId: ObjectID = ObjectID.generate();
    jest
      .spyOn(AIInsightService, "findOneById")
      .mockResolvedValue(makeInsight({ telemetryExceptionId }));
    const persistInsight: jest.SpyInstance = jest
      .spyOn(AIInsightService, "updateOneById")
      .mockResolvedValue(1);
    const flipStatus: jest.SpyInstance = jest
      .spyOn(AIInsightService, "updateOneBy")
      .mockResolvedValue(undefined as never);
    const stampException: jest.SpyInstance = jest
      .spyOn(TelemetryExceptionService, "updateOneById")
      .mockResolvedValue(undefined as never);
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: projectId,
      enableAi: true,
      enableInsightFixTasks: true,
      autoArchiveNonActionableExceptions: false,
    } as unknown as Project);
    const fixAiRunId: ObjectID = ObjectID.generate();
    const routeFix: jest.SpyInstance = jest
      .spyOn(InsightFixRouting, "routeInsightFix")
      .mockResolvedValue({ fixAiRunId });

    driveTriageWithAnalysis(
      "Root cause: null deref in checkout.\n\nClassification: code-fault",
    );

    await InsightTriageRunner.executeTriage({
      aiRunId,
      projectId,
      sentinelInsightId,
      attemptCount: 1,
    });

    // The verdict lands on the insight row alongside the summary.
    expect(persistInsight).toHaveBeenCalledWith(
      expect.objectContaining({
        id: sentinelInsightId,
        data: expect.objectContaining({
          classification: ExceptionAIClassification.CodeFault,
        }),
      }),
    );
    // ...and on the exception group row.
    expect(stampException).toHaveBeenCalledWith(
      expect.objectContaining({
        id: telemetryExceptionId,
        data: expect.objectContaining({
          aiClassification: ExceptionAIClassification.CodeFault,
        }),
      }),
    );
    /*
     * The fix decision happens HERE, post-verdict — and flips the status
     * CONDITIONALLY: only a still-ActionRequired insight becomes FixOpened.
     */
    expect(routeFix).toHaveBeenCalledTimes(1);
    expect(flipStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          status: AIInsightStatus.ActionRequired,
        }),
        data: expect.objectContaining({
          status: AIInsightStatus.FixOpened,
          fixAiRunId,
        }),
      }),
    );
  });

  test("a human Dismissed/Resolved during triage blocks all automation — no fix, no archive, terminal status untouched", async () => {
    const telemetryExceptionId: ObjectID = ObjectID.generate();

    /*
     * First read (context build) returns the snapshot; the SECOND read is
     * actOnClassification's status re-check — the human dismissed the
     * insight while the triage run executed.
     */
    jest
      .spyOn(AIInsightService, "findOneById")
      .mockResolvedValueOnce(makeInsight({ telemetryExceptionId }))
      .mockResolvedValue(
        makeInsight({
          telemetryExceptionId,
          status: AIInsightStatus.Dismissed,
        }),
      );
    const persistInsight: jest.SpyInstance = jest
      .spyOn(AIInsightService, "updateOneById")
      .mockResolvedValue(1);
    const flipStatus: jest.SpyInstance = jest
      .spyOn(AIInsightService, "updateOneBy")
      .mockResolvedValue(undefined as never);
    const exceptionWrites: jest.SpyInstance = jest
      .spyOn(TelemetryExceptionService, "updateOneById")
      .mockResolvedValue(undefined as never);
    const routeFix: jest.SpyInstance = jest.spyOn(
      InsightFixRouting,
      "routeInsightFix",
    );

    driveTriageWithAnalysis(
      "A clear null deref.\n\nClassification: code-fault",
    );

    await InsightTriageRunner.executeTriage({
      aiRunId,
      projectId,
      sentinelInsightId,
      attemptCount: 1,
    });

    // The verdict still lands (summary + classification are metadata)...
    expect(persistInsight).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          classification: ExceptionAIClassification.CodeFault,
        }),
      }),
    );
    // ...but no automation fires, and the terminal status is never touched.
    expect(routeFix).not.toHaveBeenCalled();
    expect(flipStatus).not.toHaveBeenCalled();
    expect(exceptionWrites).toHaveBeenCalledTimes(1); // classification stamp only
    expect(exceptionWrites).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isArchived: true }),
      }),
    );
  });

  test("a user-error verdict NEVER routes a fix", async () => {
    const telemetryExceptionId: ObjectID = ObjectID.generate();
    jest
      .spyOn(AIInsightService, "findOneById")
      .mockResolvedValue(makeInsight({ telemetryExceptionId }));
    jest.spyOn(AIInsightService, "updateOneById").mockResolvedValue(1);
    const exceptionWrites: jest.SpyInstance = jest
      .spyOn(TelemetryExceptionService, "updateOneById")
      .mockResolvedValue(undefined as never);
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: projectId,
      enableAi: true,
      enableInsightFixTasks: true,
      autoArchiveNonActionableExceptions: false,
    } as unknown as Project);
    const routeFix: jest.SpyInstance = jest.spyOn(
      InsightFixRouting,
      "routeInsightFix",
    );

    driveTriageWithAnalysis(
      "The uuid in the URL was garbage user input.\n\nClassification: user-error",
    );

    await InsightTriageRunner.executeTriage({
      aiRunId,
      projectId,
      sentinelInsightId,
      attemptCount: 1,
    });

    expect(routeFix).not.toHaveBeenCalled();
    // The verdict still lands on the exception; no archive (not a denial).
    expect(exceptionWrites).toHaveBeenCalledTimes(1);
    expect(exceptionWrites).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          aiClassification: ExceptionAIClassification.UserError,
        }),
      }),
    );
  });

  test("an expected-denial verdict auto-archives the exception ONLY when the project opted in", async () => {
    const telemetryExceptionId: ObjectID = ObjectID.generate();
    jest
      .spyOn(AIInsightService, "findOneById")
      .mockResolvedValue(makeInsight({ telemetryExceptionId }));
    jest.spyOn(AIInsightService, "updateOneById").mockResolvedValue(1);
    const exceptionWrites: jest.SpyInstance = jest
      .spyOn(TelemetryExceptionService, "updateOneById")
      .mockResolvedValue(undefined as never);
    const routeFix: jest.SpyInstance = jest.spyOn(
      InsightFixRouting,
      "routeInsightFix",
    );

    // Opted IN: the group gets archived.
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: projectId,
      enableAi: true,
      enableInsightFixTasks: true,
      autoArchiveNonActionableExceptions: true,
    } as unknown as Project);

    driveTriageWithAnalysis(
      "This is the paywall doing its job.\n\nClassification: expected-denial",
    );

    await InsightTriageRunner.executeTriage({
      aiRunId,
      projectId,
      sentinelInsightId,
      attemptCount: 1,
    });

    expect(routeFix).not.toHaveBeenCalled();
    expect(exceptionWrites).toHaveBeenCalledWith(
      expect.objectContaining({
        id: telemetryExceptionId,
        data: expect.objectContaining({
          isArchived: true,
          markedAsArchivedAt: expect.any(Date),
        }),
      }),
    );

    // Opted OUT: verdict stamp only, no archive write.
    exceptionWrites.mockClear();
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: projectId,
      enableAi: true,
      enableInsightFixTasks: true,
      autoArchiveNonActionableExceptions: false,
    } as unknown as Project);

    await InsightTriageRunner.executeTriage({
      aiRunId,
      projectId,
      sentinelInsightId,
      attemptCount: 1,
    });

    expect(exceptionWrites).toHaveBeenCalledTimes(1);
    expect(exceptionWrites).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isArchived: true }),
      }),
    );
  });
});

/*
 * ERROR-CLASS PRECEDENCE: declared > manual > ai > default.
 *
 * The triage runner writes TWO fields through TWO different service methods,
 * and the difference is the whole point:
 *
 *   aiClassification  -> updateOneById, UNCONDITIONAL. The audit record of
 *                        what the model said, readable even when it lost.
 *   errorClass        -> updateOneBy,   GUARDED on errorClassSource='default'.
 *                        The acted-on field: it scopes the Issues list.
 *
 * A test that spies only one of them sees half the behaviour and passes
 * vacuously, which is why both are asserted together here.
 */
describe("InsightTriageRunner error-class precedence", () => {
  /*
   * Own lifecycle: the sibling describe's afterEach does not reach here, and
   * jest.spyOn on the same static returns the SAME spy — so without this,
   * mock.calls accumulate across tests and a "was never called" assertion sees
   * the previous test's writes.
   */
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function stubTriage(telemetryExceptionId: ObjectID): void {
    jest
      .spyOn(AIInsightService, "findOneById")
      .mockResolvedValue(makeInsight({ telemetryExceptionId }));
    jest.spyOn(AIInsightService, "updateOneById").mockResolvedValue(1);
    jest
      .spyOn(AIInsightService, "updateOneBy")
      .mockResolvedValue(undefined as never);
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: projectId,
      enableAi: true,
      enableInsightFixTasks: false,
      autoArchiveNonActionableExceptions: false,
    } as unknown as Project);
  }

  test("promotes errorClass when nobody else has classified the group", async () => {
    const telemetryExceptionId: ObjectID = ObjectID.generate();
    stubTriage(telemetryExceptionId);

    const auditWrite: jest.SpyInstance = jest
      .spyOn(TelemetryExceptionService, "updateOneById")
      .mockResolvedValue(undefined as never);
    // 1 matched row: the group's source was still 'default'.
    const promotion: jest.SpyInstance = jest
      .spyOn(TelemetryExceptionService, "updateOneBy")
      .mockResolvedValue(1 as never);

    driveTriageWithAnalysis(
      "The caller sent a malformed id.\n\nClassification: user-error",
    );

    await InsightTriageRunner.executeTriage({
      aiRunId,
      projectId,
      sentinelInsightId,
      attemptCount: 1,
    });

    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          aiClassification: ExceptionAIClassification.UserError,
        }),
      }),
    );

    /*
     * The source predicate in the WHERE clause is the regression this guards,
     * and it is invisible to any test whose fixture already has source
     * 'default' — dropping it would let a stale LLM verdict overwrite a class
     * the throwing code declared for itself.
     */
    expect(promotion).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          _id: telemetryExceptionId.toString(),
          errorClassSource: "default",
        }),
        data: expect.objectContaining({
          errorClass: ExceptionAIClassification.UserError,
          errorClassSource: "ai",
        }),
        props: expect.objectContaining({ isRoot: true }),
      }),
    );
  });

  /*
   * A stronger source already owns the field: the conditional UPDATE matches
   * no row. The AUDIT write must still happen — asserting only "errorClass
   * unchanged" would pass even if the audit write were wrongly removed.
   */
  test("a declared or manual class outranks the AI verdict, but the audit record still lands", async () => {
    const telemetryExceptionId: ObjectID = ObjectID.generate();
    stubTriage(telemetryExceptionId);

    const auditWrite: jest.SpyInstance = jest
      .spyOn(TelemetryExceptionService, "updateOneById")
      .mockResolvedValue(undefined as never);
    // 0 matched rows: source was 'declared' or 'manual'.
    jest
      .spyOn(TelemetryExceptionService, "updateOneBy")
      .mockResolvedValue(0 as never);

    driveTriageWithAnalysis(
      "Looks like a real defect.\n\nClassification: code-fault",
    );

    await InsightTriageRunner.executeTriage({
      aiRunId,
      projectId,
      sentinelInsightId,
      attemptCount: 1,
    });

    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          aiClassification: ExceptionAIClassification.CodeFault,
        }),
      }),
    );
  });

  /*
   * The promotion is a secondary, self-healing write — live traffic re-stamps
   * errorClass on the group's next occurrence. The auto-archive below it is
   * user-visible and comparatively irreversible, so a failure here must not
   * cost us that. Without the guard the two are coupled only by statement
   * order.
   */
  test("a failed promotion does not abort the rest of triage", async () => {
    const telemetryExceptionId: ObjectID = ObjectID.generate();
    stubTriage(telemetryExceptionId);
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: projectId,
      enableAi: true,
      enableInsightFixTasks: false,
      autoArchiveNonActionableExceptions: true,
    } as unknown as Project);

    const exceptionWrites: jest.SpyInstance = jest
      .spyOn(TelemetryExceptionService, "updateOneById")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(TelemetryExceptionService, "updateOneBy")
      .mockRejectedValue(new Error("postgres said no") as never);

    driveTriageWithAnalysis(
      "The paywall doing its job.\n\nClassification: expected-denial",
    );

    await expect(
      InsightTriageRunner.executeTriage({
        aiRunId,
        projectId,
        sentinelInsightId,
        attemptCount: 1,
      }),
    ).resolves.not.toThrow();

    expect(exceptionWrites).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isArchived: true }),
      }),
    );
  });

  test("no telemetryExceptionId means neither write is attempted", async () => {
    jest
      .spyOn(AIInsightService, "findOneById")
      // makeInsight sets no telemetryExceptionId unless one is passed in.
      .mockResolvedValue(makeInsight());
    jest.spyOn(AIInsightService, "updateOneById").mockResolvedValue(1);
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: projectId,
      enableAi: true,
      enableInsightFixTasks: false,
      autoArchiveNonActionableExceptions: false,
    } as unknown as Project);

    const auditWrite: jest.SpyInstance = jest
      .spyOn(TelemetryExceptionService, "updateOneById")
      .mockResolvedValue(undefined as never);
    const promotion: jest.SpyInstance = jest
      .spyOn(TelemetryExceptionService, "updateOneBy")
      .mockResolvedValue(1 as never);

    driveTriageWithAnalysis("Nothing to attach to.\n\nClassification: unknown");

    await InsightTriageRunner.executeTriage({
      aiRunId,
      projectId,
      sentinelInsightId,
      attemptCount: 1,
    });

    expect(auditWrite).not.toHaveBeenCalled();
    expect(promotion).not.toHaveBeenCalled();
  });
});

/*
 * Slow code a service's profiles show (a telemetry lane's problem,
 * Types/AI/TelemetryAi) is triaged as performance - why the function costs
 * that much, and the one change most likely to win it back - with what its
 * lane's AI rules allow it to read: their code repositories, and the tools
 * that read of their MCP servers. Its fix is the lane's own (a pull request,
 * TelemetryAiRouting): a code-fault verdict routes nothing here.
 */
describe("InsightTriageRunner.executeTriage - slow code", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const REPO: string = "5092ffff-0000-4000-8000-0000000000a1";

  function slowCode(): AIInsight {
    return makeInsight({
      insightType: AIInsightType.ProfileHotspot,
      title: "OrderParser.parse takes 18% of the CPU time in checkout",
      detailMarkdown: "**Slow code in checkout**",
      evidence: {
        profile: {
          serviceId: "5092ffff-0000-4000-8000-000000000002",
          functionName: "OrderParser.parse",
          fileName: "src/orders/parser.ts",
          lineNumber: 42,
          profileType: "cpu",
          category: "cpu",
          reason: "Hot",
          ownShare: 18,
          functionSampleCount: 900,
          windowSampleCount: 5000,
          windowStartTime: "2026-10-24T08:00:04.000Z",
          windowEndTime: "2026-10-24T09:00:04.000Z",
          callers: [],
          callees: [],
        },
      },
    });
  }

  function laneProject(): Project {
    return {
      id: projectId,
      enableAi: true,
      enableAutomaticProfileRemediation: true,
    } as unknown as Project;
  }

  test("is framed as performance triage, with the profile evidence, and reads what its rules allow", async () => {
    jest.spyOn(AIInsightService, "findOneById").mockResolvedValue(slowCode());
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(laneProject());
    jest.spyOn(TelemetryAiRules, "decideForInsight").mockResolvedValue({
      ...decideTelemetryAiWork({
        isAiEnabled: true,
        isLaneOn: true,
        rules: { rulesSetUp: false, matchingRules: [] },
      }),
      investigationRepositories: {
        isEveryRepository: false,
        repositoryIds: [REPO],
      },
      mcpServers: NO_EXTERNAL_MCP_SERVER,
    });
    const executeRun: jest.SpyInstance = jest
      .spyOn(AIInvestigationEngine, "executeRun")
      .mockResolvedValue(undefined);

    await InsightTriageRunner.executeTriage({
      aiRunId,
      projectId,
      sentinelInsightId,
      attemptCount: 1,
    });

    const request: InvestigationRequest = (
      executeRun.mock.calls[0]![0] as { request: InvestigationRequest }
    ).request;

    expect(request.contextSummary).toContain("PERFORMANCE TRIAGE");
    expect(request.contextSummary).not.toContain("PREVENTIVE TRIAGE");
    expect(request.contextSummary).toContain("ONE change");
    expect(request.contextSummary).toContain(
      '"functionName":"OrderParser.parse"',
    );
    expect(request.codeRepositoryAllowance).toEqual({
      isEveryRepository: false,
      repositoryIds: [REPO],
    });
    // No MCP server allowed: no tools beyond OneUptime's own.
    expect(request.extraTools).toBeUndefined();
  });

  test("rules that leave it out (or cannot be read) let it read no repository", async () => {
    jest.spyOn(AIInsightService, "findOneById").mockResolvedValue(slowCode());
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(laneProject());
    jest.spyOn(TelemetryAiRules, "decideForInsight").mockResolvedValue(
      decideTelemetryAiWork({
        isAiEnabled: true,
        isLaneOn: true,
        rules: null,
      }),
    );
    const executeRun: jest.SpyInstance = jest
      .spyOn(AIInvestigationEngine, "executeRun")
      .mockResolvedValue(undefined);

    await InsightTriageRunner.executeTriage({
      aiRunId,
      projectId,
      sentinelInsightId,
      attemptCount: 1,
    });

    const request: InvestigationRequest = (
      executeRun.mock.calls[0]![0] as { request: InvestigationRequest }
    ).request;

    expect(request.codeRepositoryAllowance).toEqual({
      isEveryRepository: false,
      repositoryIds: [],
    });
  });

  test("a code-fault verdict writes the verdict and routes no fix: the lane opens its own pull request", async () => {
    jest
      .spyOn(AIInsightService, "findOneById")
      .mockImplementation(async (): Promise<AIInsight> => {
        const insight: AIInsight = slowCode();
        insight.status = AIInsightStatus.ActionRequired;
        return insight;
      });
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(laneProject());
    jest.spyOn(TelemetryAiRules, "decideForInsight").mockResolvedValue(null);
    const persist: jest.SpyInstance = jest
      .spyOn(AIInsightService, "updateOneById")
      .mockResolvedValue(1);
    const routeFix: jest.SpyInstance = jest
      .spyOn(InsightFixRouting, "routeInsightFix")
      .mockResolvedValue({ fixAiRunId: ObjectID.generate() });
    driveTriageWithAnalysis(
      "OrderParser.parse re-parses the payload per item.\n\nClassification: code-fault",
    );

    await InsightTriageRunner.executeTriage({
      aiRunId,
      projectId,
      sentinelInsightId,
      attemptCount: 1,
    });

    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          classification: ExceptionAIClassification.CodeFault,
        }),
      }),
    );
    expect(routeFix).not.toHaveBeenCalled();
  });
});

/*
 * Traces' findings (Utils/Traces/TraceInsight) are each triaged for what
 * there is to establish: why a slow operation repeats costly work, why a
 * failing one fails - whose verdict decides whether its pull request opens
 * on its own (Types/AI/TelemetryAi) - and what a trace lacks to say why.
 * The trace evidence reaches the prompt with the rest of the evidence, and
 * a code-fault verdict routes nothing here: the lane opens its own pull
 * request.
 */
describe("InsightTriageRunner.executeTriage - Traces' findings", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function traceFinding(insightType: AIInsightType): AIInsight {
    return makeInsight({
      insightType,
      title: "POST /checkout in checkout fails 12% of the time",
      detailMarkdown: "**Failing operation in checkout**",
      evidence: {
        trace: {
          serviceId: "5229ffff-0000-4000-8000-000000000002",
          kind: "Failing",
          operationName: "POST /checkout",
          windowStartTime: "2026-10-24T08:00:04.000Z",
          windowEndTime: "2026-10-24T09:00:04.000Z",
          spanCount: 2800,
          failedSpanCount: 340,
        },
      },
    });
  }

  async function contextSummaryFor(
    insightType: AIInsightType,
  ): Promise<string> {
    jest
      .spyOn(AIInsightService, "findOneById")
      .mockResolvedValue(traceFinding(insightType));
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: projectId,
      enableAi: true,
      enableAutomaticTraceRemediation: true,
    } as unknown as Project);
    jest.spyOn(TelemetryAiRules, "decideForInsight").mockResolvedValue(
      decideTelemetryAiWork({
        isAiEnabled: true,
        isLaneOn: true,
        rules: { rulesSetUp: false, matchingRules: [] },
      }),
    );
    const executeRun: jest.SpyInstance = jest
      .spyOn(AIInvestigationEngine, "executeRun")
      .mockResolvedValue(undefined);

    await InsightTriageRunner.executeTriage({
      aiRunId,
      projectId,
      sentinelInsightId,
      attemptCount: 1,
    });

    return (executeRun.mock.calls[0]![0] as { request: InvestigationRequest })
      .request.contextSummary;
  }

  test("a slow operation is performance triage", async () => {
    const summary: string = await contextSummaryFor(
      AIInsightType.TraceSlowOperation,
    );

    expect(summary).toContain("PERFORMANCE TRIAGE");
    expect(summary).toContain("read this service's traces");
    expect(summary).not.toContain("PREVENTIVE TRIAGE,");
  });

  test("a failing operation is failure triage, whose verdict gates its pull request", async () => {
    const summary: string = await contextSummaryFor(
      AIInsightType.TraceFailingOperation,
    );

    expect(summary).toContain("PREVENTIVE TRIAGE of a failing operation");
    expect(summary).toContain(
      "ONLY code-fault findings may get an automatic fix pull request",
    );
    expect(summary).toContain("expected-denial");
  });

  test("missing tracing is observability triage", async () => {
    const summary: string = await contextSummaryFor(
      AIInsightType.TraceMissingTracing,
    );

    expect(summary).toContain("OBSERVABILITY TRIAGE");
    expect(summary).toContain("ONE instrumentation change");
  });

  test("the trace evidence is in the prompt", async () => {
    const summary: string = await contextSummaryFor(
      AIInsightType.TraceFailingOperation,
    );

    expect(summary).toContain('- trace: {"serviceId"');
    expect(summary).toContain('"failedSpanCount":340');
  });

  test("a code-fault verdict on a failing operation routes nothing here", async () => {
    jest
      .spyOn(AIInsightService, "findOneById")
      .mockImplementation(async (): Promise<AIInsight> => {
        const insight: AIInsight = traceFinding(
          AIInsightType.TraceFailingOperation,
        );
        insight.status = AIInsightStatus.ActionRequired;
        return insight;
      });
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: projectId,
      enableAi: true,
      enableAutomaticTraceRemediation: true,
    } as unknown as Project);
    jest.spyOn(TelemetryAiRules, "decideForInsight").mockResolvedValue(null);
    jest.spyOn(AIInsightService, "updateOneById").mockResolvedValue(1);
    const routeFix: jest.SpyInstance = jest
      .spyOn(InsightFixRouting, "routeInsightFix")
      .mockResolvedValue({ fixAiRunId: ObjectID.generate() });
    driveTriageWithAnalysis(
      "The payment client never retries.\n\nClassification: code-fault",
    );

    await InsightTriageRunner.executeTriage({
      aiRunId,
      projectId,
      sentinelInsightId,
      attemptCount: 1,
    });

    expect(routeFix).not.toHaveBeenCalled();
  });
});

/*
 * Exceptions' AI section shares new and rising exceptions with AI Insights
 * (Types/AI/TelemetryAi): while its switch is on, their triage reads what
 * the exception AI rules allow, and a code-fault verdict routes no fix here
 * - the lane opens its own pull request - though the verdict still lands on
 * the exception; while it is off they are AI Insights' as they always were.
 * A service's missing stack traces are the lane's only, triaged as
 * observability triage.
 */
describe("InsightTriageRunner.executeTriage - Exceptions' AI section", () => {
  const REPO: string = "5240ffff-0000-4000-8000-0000000000a1";

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function exceptionsProject(isLaneOn: boolean): Project {
    return {
      id: projectId,
      enableAi: true,
      enableInsightFixTasks: true,
      autoArchiveNonActionableExceptions: true,
      enableAutomaticExceptionRemediation: isLaneOn,
    } as unknown as Project;
  }

  function laneWork(): ReturnType<typeof decideTelemetryAiWork> {
    return {
      ...decideTelemetryAiWork({
        isAiEnabled: true,
        isLaneOn: true,
        rules: { rulesSetUp: false, matchingRules: [] },
      }),
      investigationRepositories: {
        isEveryRepository: false,
        repositoryIds: [REPO],
      },
      mcpServers: NO_EXTERNAL_MCP_SERVER,
    };
  }

  async function requestFor(data: {
    insight: AIInsight;
    isLaneOn: boolean;
  }): Promise<{
    request: InvestigationRequest;
    decide: jest.SpyInstance;
  }> {
    jest.spyOn(AIInsightService, "findOneById").mockResolvedValue(data.insight);
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(exceptionsProject(data.isLaneOn));
    const decide: jest.SpyInstance = jest
      .spyOn(TelemetryAiRules, "decideForInsight")
      .mockResolvedValue(laneWork());
    const executeRun: jest.SpyInstance = jest
      .spyOn(AIInvestigationEngine, "executeRun")
      .mockResolvedValue(undefined);

    await InsightTriageRunner.executeTriage({
      aiRunId,
      projectId,
      sentinelInsightId,
      attemptCount: 1,
    });

    return {
      request: (
        executeRun.mock.calls[0]![0] as { request: InvestigationRequest }
      ).request,
      decide,
    };
  }

  test("its switch on: a new exception reads what the exception AI rules allow, framed as the exception's own triage", async () => {
    const { request, decide } = await requestFor({
      insight: makeInsight({ insightType: AIInsightType.NewException }),
      isLaneOn: true,
    });

    expect(decide).toHaveBeenCalledTimes(1);
    expect(request.codeRepositoryAllowance).toEqual({
      isEveryRepository: false,
      repositoryIds: [REPO],
    });
    expect(request.contextSummary).toContain("PREVENTIVE TRIAGE");
  });

  test("its switch off: AI Insights' triage, as it always was - no rules read, no scope", async () => {
    const { request, decide } = await requestFor({
      insight: makeInsight({ insightType: AIInsightType.ExceptionSpike }),
      isLaneOn: false,
    });

    expect(decide).not.toHaveBeenCalled();
    expect(request.codeRepositoryAllowance).toBeUndefined();
    expect(request.extraTools).toBeUndefined();
  });

  test("missing stack traces are observability triage, with the evidence", async () => {
    const { request } = await requestFor({
      insight: makeInsight({
        insightType: AIInsightType.ExceptionMissingStackTrace,
        title: "Exceptions in checkout have no stack trace",
        evidence: {
          exceptionStackTrace: {
            serviceId: "5240ffff-0000-4000-8000-000000000002",
            windowStartTime: "2026-10-23T09:00:04.000Z",
            windowEndTime: "2026-10-24T09:00:04.000Z",
            exceptions: [],
            exceptionCount: 3,
            occurrenceCount: 140,
            withStackTraceCount: 0,
          },
        },
      }),
      isLaneOn: true,
    });

    expect(request.contextSummary).toContain("OBSERVABILITY TRIAGE");
    expect(request.contextSummary).toContain("without a stack trace");
    expect(request.contextSummary).toContain(
      "user-error and expected-denial do not apply to this finding",
    );
    expect(request.contextSummary).not.toContain("PREVENTIVE TRIAGE,");
    expect(request.contextSummary).toContain(
      '- exceptionStackTrace: {"serviceId"',
    );
    expect(request.contextSummary).toContain('"withStackTraceCount":0');
  });

  test("its switch on: a code-fault verdict lands on the exception, and routes no fix here", async () => {
    const telemetryExceptionId: ObjectID = ObjectID.generate();
    jest.spyOn(AIInsightService, "findOneById").mockResolvedValue(
      makeInsight({
        insightType: AIInsightType.NewException,
        telemetryExceptionId,
        status: AIInsightStatus.ActionRequired,
      }),
    );
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(exceptionsProject(true));
    jest
      .spyOn(TelemetryAiRules, "decideForInsight")
      .mockResolvedValue(laneWork());
    jest.spyOn(AIInsightService, "updateOneById").mockResolvedValue(1);
    jest
      .spyOn(TelemetryExceptionService, "updateOneBy")
      .mockResolvedValue(1 as never);
    const stampException: jest.SpyInstance = jest
      .spyOn(TelemetryExceptionService, "updateOneById")
      .mockResolvedValue(undefined as never);
    const routeFix: jest.SpyInstance = jest
      .spyOn(InsightFixRouting, "routeInsightFix")
      .mockResolvedValue({ fixAiRunId: ObjectID.generate() });
    driveTriageWithAnalysis(
      "getOrder reads an order that may be missing.\n\nClassification: code-fault",
    );

    await InsightTriageRunner.executeTriage({
      aiRunId,
      projectId,
      sentinelInsightId,
      attemptCount: 1,
    });

    expect(stampException).toHaveBeenCalledWith(
      expect.objectContaining({
        id: telemetryExceptionId,
        data: expect.objectContaining({
          aiClassification: ExceptionAIClassification.CodeFault,
        }),
      }),
    );
    expect(routeFix).not.toHaveBeenCalled();
  });

  test("its switch on or off: an expected denial is archived where the project opted in", async () => {
    for (const isLaneOn of [true, false]) {
      jest.restoreAllMocks();
      const telemetryExceptionId: ObjectID = ObjectID.generate();
      jest.spyOn(AIInsightService, "findOneById").mockResolvedValue(
        makeInsight({
          insightType: AIInsightType.NewException,
          telemetryExceptionId,
          status: AIInsightStatus.ActionRequired,
        }),
      );
      jest
        .spyOn(ProjectService, "findOneById")
        .mockResolvedValue(exceptionsProject(isLaneOn));
      jest
        .spyOn(TelemetryAiRules, "decideForInsight")
        .mockResolvedValue(laneWork());
      jest.spyOn(AIInsightService, "updateOneById").mockResolvedValue(1);
      jest
        .spyOn(TelemetryExceptionService, "updateOneBy")
        .mockResolvedValue(1 as never);
      const exceptionWrites: jest.SpyInstance = jest
        .spyOn(TelemetryExceptionService, "updateOneById")
        .mockResolvedValue(undefined as never);
      driveTriageWithAnalysis(
        "The paywall doing its job.\n\nClassification: expected-denial",
      );

      await InsightTriageRunner.executeTriage({
        aiRunId,
        projectId,
        sentinelInsightId,
        attemptCount: 1,
      });

      expect(exceptionWrites).toHaveBeenCalledWith(
        expect.objectContaining({
          id: telemetryExceptionId,
          data: expect.objectContaining({ isArchived: true }),
        }),
      );
    }
  });
});
/*
 * Metrics' findings (Utils/Metrics/MetricInsight) are each triaged for what
 * there is to establish: where the code records the value with too many
 * values, why a histogram's buckets do not fit, and how a service that
 * sends no metrics should start. The metric evidence reaches the prompt
 * with the rest, and a code-fault verdict routes nothing here: the lane
 * opens its own pull request.
 */
describe("InsightTriageRunner.executeTriage - Metrics' findings", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function metricFinding(insightType: AIInsightType): AIInsight {
    return makeInsight({
      insightType,
      title:
        "http.server.request.count in checkout records 12,000 different user.id values an hour",
      detailMarkdown: "**High-cardinality metric in checkout**",
      evidence: {
        metric: {
          serviceId: "5231ffff-0000-4000-8000-000000000002",
          kind: "HighCardinality",
          shape: "Attribute",
          windowStartTime: "2026-10-24T08:00:00.000Z",
          windowEndTime: "2026-10-24T09:00:00.000Z",
          metricName: "http.server.request.count",
          attributeKey: "user.id",
          attributeValueCount: 12000,
          valueShape: "Uuid",
        },
      },
    });
  }

  async function contextSummaryFor(
    insightType: AIInsightType,
  ): Promise<string> {
    jest
      .spyOn(AIInsightService, "findOneById")
      .mockResolvedValue(metricFinding(insightType));
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: projectId,
      enableAi: true,
      enableAutomaticMetricRemediation: true,
    } as unknown as Project);
    jest.spyOn(TelemetryAiRules, "decideForInsight").mockResolvedValue(
      decideTelemetryAiWork({
        isAiEnabled: true,
        isLaneOn: true,
        rules: { rulesSetUp: false, matchingRules: [] },
      }),
    );
    const executeRun: jest.SpyInstance = jest
      .spyOn(AIInvestigationEngine, "executeRun")
      .mockResolvedValue(undefined);

    await InsightTriageRunner.executeTriage({
      aiRunId,
      projectId,
      sentinelInsightId,
      attemptCount: 1,
    });

    return (executeRun.mock.calls[0]![0] as { request: InvestigationRequest })
      .request.contextSummary;
  }

  test("a high-cardinality metric is metrics triage: where the value is recorded, and what could take its place", async () => {
    const summary: string = await contextSummaryFor(
      AIInsightType.MetricHighCardinality,
    );

    expect(summary).toContain("this is METRICS TRIAGE");
    expect(summary).toContain(
      "Find where the code records this metric and sets that attribute",
    );
    expect(summary).toContain("what bounded value could take its place");
    expect(summary).not.toContain("PREVENTIVE TRIAGE,");
  });

  test("histogram buckets are metrics triage: why they do not fit, the unit or the bounds", async () => {
    const summary: string = await contextSummaryFor(
      AIInsightType.MetricHistogramBuckets,
    );

    expect(summary).toContain("this is METRICS TRIAGE");
    expect(summary).toContain("so its percentiles cannot be told apart");
    expect(summary).toContain(
      "Recommend exactly ONE change - the bucket boundaries, or the unit",
    );
  });

  test("missing metrics is observability triage: which metrics first, and where", async () => {
    const summary: string = await contextSummaryFor(
      AIInsightType.MetricMissingMetrics,
    );

    expect(summary).toContain("this is OBSERVABILITY TRIAGE");
    expect(summary).toContain("has never sent a single metric");
    expect(summary).toContain(
      "Say which metrics it should record first (request count, error count, request duration)",
    );
  });

  test("each says the verdicts a person or a policy cannot be", async () => {
    for (const insightType of [
      AIInsightType.MetricHighCardinality,
      AIInsightType.MetricHistogramBuckets,
      AIInsightType.MetricMissingMetrics,
    ]) {
      jest.restoreAllMocks();

      const summary: string = await contextSummaryFor(insightType);

      expect(summary).toContain("Classification: <verdict>");
      expect(summary).toMatch(
        /user-error and expected-denial do not apply to (metrics|observability) findings/,
      );
    }
  });

  test("the metric evidence is in the prompt", async () => {
    const summary: string = await contextSummaryFor(
      AIInsightType.MetricHighCardinality,
    );

    expect(summary).toContain('- metric: {"serviceId"');
    expect(summary).toContain('"attributeValueCount":12000');
  });

  test("a code-fault verdict on a metric finding routes nothing here", async () => {
    jest
      .spyOn(AIInsightService, "findOneById")
      .mockImplementation(async (): Promise<AIInsight> => {
        const insight: AIInsight = metricFinding(
          AIInsightType.MetricHighCardinality,
        );
        insight.status = AIInsightStatus.ActionRequired;
        return insight;
      });
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: projectId,
      enableAi: true,
      enableAutomaticMetricRemediation: true,
    } as unknown as Project);
    jest.spyOn(TelemetryAiRules, "decideForInsight").mockResolvedValue(null);
    jest.spyOn(AIInsightService, "updateOneById").mockResolvedValue(1);
    const routeFix: jest.SpyInstance = jest
      .spyOn(InsightFixRouting, "routeInsightFix")
      .mockResolvedValue({ fixAiRunId: ObjectID.generate() });
    driveTriageWithAnalysis(
      "The request counter records user.id.\n\nClassification: code-fault",
    );

    await InsightTriageRunner.executeTriage({
      aiRunId,
      projectId,
      sentinelInsightId,
      attemptCount: 1,
    });

    expect(routeFix).not.toHaveBeenCalled();
  });
});

