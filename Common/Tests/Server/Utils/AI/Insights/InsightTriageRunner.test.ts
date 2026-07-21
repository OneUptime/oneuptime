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
import { describe, expect, test, afterEach } from "@jest/globals";

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
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a context-build failure hands the claimed run to the retry policy (non-permanent)", async () => {
    jest
      .spyOn(AIInsightService, "findOneById")
      .mockRejectedValue(new Error("db down"));
    const failOrRequeue: jest.SpyInstance = jest
      .spyOn(AIInvestigationQueue, "failOrRequeue")
      .mockResolvedValue(undefined);
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
      .mockResolvedValue(undefined);

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
      .mockResolvedValue(undefined);
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
      .mockResolvedValue(undefined);
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
    // The fix decision happens HERE, post-verdict — and flips the status.
    expect(routeFix).toHaveBeenCalledTimes(1);
    expect(persistInsight).toHaveBeenCalledWith(
      expect.objectContaining({
        id: sentinelInsightId,
        data: expect.objectContaining({
          status: AIInsightStatus.FixOpened,
          fixAiRunId,
        }),
      }),
    );
  });

  test("a user-error verdict NEVER routes a fix", async () => {
    const telemetryExceptionId: ObjectID = ObjectID.generate();
    jest
      .spyOn(AIInsightService, "findOneById")
      .mockResolvedValue(makeInsight({ telemetryExceptionId }));
    jest.spyOn(AIInsightService, "updateOneById").mockResolvedValue(undefined);
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
    jest.spyOn(AIInsightService, "updateOneById").mockResolvedValue(undefined);
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
