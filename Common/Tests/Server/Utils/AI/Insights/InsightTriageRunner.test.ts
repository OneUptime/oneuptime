import InsightTriageRunner from "../../../../../Server/Utils/AI/SRE/Insights/InsightTriageRunner";
import AIInvestigationEngine, {
  InvestigationRequest,
} from "../../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import AIInvestigationQueue from "../../../../../Server/Utils/AI/SRE/InvestigationQueue";
import InstrumentationTaskTrigger from "../../../../../Server/Utils/AI/SRE/InstrumentationTaskTrigger";
import { ConfidenceSignal } from "../../../../../Server/Utils/AI/SRE/ConfidenceSignal";
import { ObservabilityAssistantResult } from "../../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import AIInsightService from "../../../../../Server/Services/AIInsightService";
import IncidentFeedService from "../../../../../Server/Services/IncidentFeedService";
import AlertFeedService from "../../../../../Server/Services/AlertFeedService";
import { AI_INSIGHT_TRIAGE_FEATURE } from "../../../../../Server/Services/AIService";
import AIInsight from "../../../../../Models/DatabaseModels/AIInsight";
import AIInsightType from "../../../../../Types/AI/AIInsightType";
import AIInsightSeverity from "../../../../../Types/AI/AIInsightSeverity";
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

function makeInsight(): AIInsight {
  return {
    id: sentinelInsightId,
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
  } as unknown as AIInsight;
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
});
