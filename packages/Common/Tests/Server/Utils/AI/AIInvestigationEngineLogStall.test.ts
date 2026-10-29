import AIInvestigationEngine, {
  InvestigationRequest,
} from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import AIConfidenceSignal, {
  ConfidenceSignal,
} from "../../../../Server/Utils/AI/SRE/ConfidenceSignal";
import InvestigationTldr from "../../../../Server/Utils/AI/SRE/InvestigationTldr";
import ObservabilityAssistant, {
  ObservabilityAssistantResult,
} from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import LlmProviderChoice, {
  RuleLlmProviderChoice,
} from "../../../../Server/Utils/AI/LlmProviderChoice";
import AIRunEventService from "../../../../Server/Services/AIRunEventService";
import AIRunService from "../../../../Server/Services/AIRunService";
import LogAggregationService from "../../../../Server/Services/LogAggregationService";
import logger from "../../../../Server/Utils/Logger";
import AIRunEvent from "../../../../Models/DatabaseModels/AIRunEvent";
import { AIChatCitation } from "../../../../Types/AI/AIChatTypes";
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import {
  InvestigationLogStall,
  InvestigationLogStallReason,
  parseInvestigationLogStall,
} from "../../../../Utils/AI/InvestigationLogStall";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * AN INVESTIGATION THAT COULD NOT TELL THE CAUSE FOR LACK OF LOGS RECORDS
 * IT (AIInvestigationEngine.executeRun, for incident and alert runs): once
 * the run has its verdict, an InvestigationStalled event says why the logs
 * could not tell - none reached OneUptime, or none matched - before the
 * report is posted, so the AI card reads it beside the report from its
 * first look. A run that found the cause, found a log line, or is no
 * incident or alert investigation records nothing of the kind.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
// Half an hour ago: the engine checks up to now, so the start is in the past.
const STARTED_AT: Date = new Date(Date.now() - 30 * 60 * 1000);

const INCONCLUSIVE: ConfidenceSignal = {
  confident: false,
  source: "classification",
  codeFixRecommended: false,
};

const FOUND_THE_CAUSE: ConfidenceSignal = {
  confident: true,
  source: "classification",
  codeFixRecommended: false,
};

function noPick(): RuleLlmProviderChoice {
  return {
    provider: null,
    source: null,
    fallbackReason: null,
    pickedProviderId: "",
    activity: null,
  };
}

function logCitation(rowCount: number): AIChatCitation {
  return {
    id: "C1",
    toolName: "search_logs",
    label: "Logs 2026-10-29T10:30:00.000Z – 2026-10-29T12:00:00.000Z (0 shown)",
    queryArguments: {},
    rowCount,
  };
}

describe("AIInvestigationEngine.executeRun: an investigation the logs could not help", () => {
  const aiRunId: ObjectID = ObjectID.generate();
  let events: Array<AIRunEvent>;
  let eventsWhenPosted: Array<AIRunEventType | undefined>;
  let citations: Array<AIChatCitation>;
  let hasLogs: SpyInstance<typeof LogAggregationService.hasLogsInWindow>;

  function result(): ObservabilityAssistantResult {
    return {
      contentInMarkdown:
        "**Summary** — Checkout returned 500s.\n\n**Most likely root cause** — Could not determine: no evidence in the telemetry.",
      citations,
      totalTokens: 100,
      llmCallCount: 2,
      toolCallCount: citations.length,
    };
  }

  function request(
    overrides: Partial<InvestigationRequest> = {},
  ): InvestigationRequest {
    return {
      feature: "AI Incident Investigation",
      incidentId: INCIDENT_ID,
      contextSummary: "# Incident\nTitle: Checkout is failing",
      persistAnalysisTldr: true,
      logStallSubject: { subjectType: "incident", startedAt: STARTED_AT },
      postAnalysis: async (): Promise<void> => {
        eventsWhenPosted = events.map((event: AIRunEvent) => {
          return event.eventType;
        });
      },
      ...overrides,
    };
  }

  async function run(
    confidence: ConfidenceSignal,
    overrides: Partial<InvestigationRequest> = {},
  ): Promise<void> {
    jest
      .spyOn(AIConfidenceSignal, "computeConfidenceSignal")
      .mockResolvedValue(confidence);

    await AIInvestigationEngine.executeRun({
      aiRunId,
      projectId: PROJECT_ID,
      attemptCount: 1,
      request: request(overrides),
    });
  }

  function stalls(): Array<AIRunEvent> {
    return events.filter((event: AIRunEvent): boolean => {
      return event.eventType === AIRunEventType.InvestigationStalled;
    });
  }

  beforeEach(() => {
    events = [];
    eventsWhenPosted = [];
    citations = [];
    jest
      .spyOn(AIRunEventService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(AIRunEventService, "create")
      .mockImplementation(async (data: unknown) => {
        const event: AIRunEvent = (data as { data: AIRunEvent }).data;
        events.push(event);
        return event;
      });
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);
    jest.spyOn(AIRunService, "updateOneBy").mockResolvedValue(1);
    jest.spyOn(InvestigationTldr, "generateTldr").mockResolvedValue(null);
    jest
      .spyOn(ObservabilityAssistant, "answerQuestion")
      .mockImplementation(async () => {
        return result();
      });
    jest.spyOn(LlmProviderChoice, "decideForRun").mockResolvedValue(noPick());
    hasLogs = jest
      .spyOn(LogAggregationService, "hasLogsInWindow")
      .mockResolvedValue(false);
    jest.spyOn(logger, "debug").mockImplementation((): void => {});
    jest.spyOn(logger, "warn").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("no log reached OneUptime: the run records it, before the report is posted", async () => {
    await run(INCONCLUSIVE);

    expect(stalls()).toHaveLength(1);

    const event: AIRunEvent = stalls()[0]!;
    const stall: InvestigationLogStall | null = parseInvestigationLogStall(
      event.resultSummary?.logStall,
    );

    expect(stall).toEqual({
      reason: InvestigationLogStallReason.NoLogs,
      logSearchCount: 0,
      windowStart: new Date(STARTED_AT.getTime() - 60 * 60 * 1000).toISOString(),
      windowEnd: expect.any(String),
    });
    expect(event.resultSummary?.message).toBe(
      "No logs reached OneUptime from the hour before this incident started, so OneUptime AI had none to read.",
    );

    // Before the report: the card reads it with the report's first look.
    expect(eventsWhenPosted).toContain(AIRunEventType.InvestigationStalled);
    expect(eventsWhenPosted).not.toContain(AIRunEventType.RunCompleted);

    // And the run then settles as ever.
    expect(events[events.length - 1]!.eventType).toBe(
      AIRunEventType.RunCompleted,
    );
  });

  test("logs reached OneUptime, and its searches found nothing: NoMatchingLogs, with the count", async () => {
    hasLogs.mockResolvedValue(true);
    citations = [logCitation(0), logCitation(0), logCitation(0)];

    await run(INCONCLUSIVE);

    const stall: InvestigationLogStall | null = parseInvestigationLogStall(
      stalls()[0]?.resultSummary?.logStall,
    );

    expect(stall?.reason).toBe(InvestigationLogStallReason.NoMatchingLogs);
    expect(stall?.logSearchCount).toBe(3);
    expect(stalls()[0]?.resultSummary?.message).toBe(
      "OneUptime AI searched the logs 3 times and found nothing about this incident.",
    );
  });

  test("an alert's run says it of the alert", async () => {
    await run(INCONCLUSIVE, {
      feature: "AI Alert Investigation",
      incidentId: undefined,
      alertId: ObjectID.generate(),
      logStallSubject: { subjectType: "alert", startedAt: STARTED_AT },
    });

    expect(stalls()[0]?.resultSummary?.message).toBe(
      "No logs reached OneUptime from the hour before this alert started, so OneUptime AI had none to read.",
    );
  });

  test("a run that found the cause records nothing, and reads no logs", async () => {
    await run(FOUND_THE_CAUSE);

    expect(stalls()).toEqual([]);
    expect(hasLogs).not.toHaveBeenCalled();
  });

  test("a run whose searches found a log line records nothing", async () => {
    citations = [logCitation(0), logCitation(7)];

    await run(INCONCLUSIVE);

    expect(stalls()).toEqual([]);
    expect(hasLogs).not.toHaveBeenCalled();
  });

  test("a run that is no incident or alert investigation never checks", async () => {
    await run(INCONCLUSIVE, { logStallSubject: undefined });

    expect(stalls()).toEqual([]);
    expect(hasLogs).not.toHaveBeenCalled();
  });

  test("a check whose read fails records what the searches say, and the report still posts", async () => {
    hasLogs.mockRejectedValue(new Error("ClickHouse is restarting"));

    await run(INCONCLUSIVE);

    // Never searched, and the logs could not be read: nothing to say.
    expect(stalls()).toEqual([]);
    expect(eventsWhenPosted.length).toBeGreaterThan(0);
    expect(events[events.length - 1]!.eventType).toBe(
      AIRunEventType.RunCompleted,
    );
  });
});
