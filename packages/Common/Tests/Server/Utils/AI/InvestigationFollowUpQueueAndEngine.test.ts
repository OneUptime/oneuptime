import AIInvestigationQueue, {
  MAX_INVESTIGATION_ATTEMPTS,
} from "../../../../Server/Utils/AI/SRE/InvestigationQueue";
import AIInvestigationEngine, {
  InvestigationRequest,
} from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import AIIncidentInvestigationRunner from "../../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import RemediationHandoff from "../../../../Server/Utils/AI/SRE/RemediationHandoff";
import AIConfidenceSignal from "../../../../Server/Utils/AI/SRE/ConfidenceSignal";
import ObservabilityAssistant, {
  ObservabilityAssistantResult,
} from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import AIRunService from "../../../../Server/Services/AIRunService";
import AIRunEventService from "../../../../Server/Services/AIRunEventService";
import AIService from "../../../../Server/Services/AIService";
import ProjectService from "../../../../Server/Services/ProjectService";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../../../Models/DatabaseModels/AIRunEvent";
import Project from "../../../../Models/DatabaseModels/Project";
import { AIRunEventResultSummary } from "../../../../Types/AI/AIChatTypes";
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * THE FOLLOW-UP CHECK THROUGH THE QUEUE, AND WHAT THE ENGINE RECORDS
 * (issues #4786, #4787).
 *
 * A follow-up check is an ordinary Investigation run with
 * followUpForAlertId set: the queue creates it only when its guard admits it
 * inside the subject lock, carries the alert to the incident runner, and -
 * because the first investigation already released the incident's
 * remediation - never hands it to remediation when it expires or goes
 * stale. The engine records what the starting context read as the run's
 * first activity lines, puts the runner's lead under the report's heading,
 * and reads every tool's data as the run's own project.
 */

jest.mock("../../../../Server/Utils/AI/SRE/RemediationHandoff", () => {
  return {
    __esModule: true,
    default: {
      runForSettledInvestigation: jest.fn(),
    },
  };
});

const handoff: jest.Mock =
  RemediationHandoff.runForSettledInvestigation as unknown as jest.Mock;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const ALERT_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

describe("the queue and a follow-up check", () => {
  beforeEach(() => {
    jest.spyOn(AIService, "getAutonomousDailyBudgetStatus").mockResolvedValue({
      exhausted: false,
      limitInTokens: null,
      usedTokensToday: 0,
    });
    jest
      .spyOn(AIService, "getReachedProjectDailyLimit")
      .mockResolvedValue(null as never);
    jest.spyOn(Semaphore, "lock").mockResolvedValue({} as never);
    jest.spyOn(Semaphore, "release").mockResolvedValue();
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue({ id: PROJECT_ID } as unknown as Project);
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    handoff.mockClear();
  });

  test("enqueue records the alert on the run and carries it to the inline kick", async () => {
    const createdId: ObjectID = ObjectID.generate();
    const create: jest.SpyInstance = jest
      .spyOn(AIRunService, "create")
      .mockResolvedValue({ id: createdId } as unknown as AIRun);
    const processRun: jest.SpyInstance = jest
      .spyOn(AIInvestigationQueue, "processRun")
      .mockResolvedValue(undefined);

    const runId: ObjectID | null = await AIInvestigationQueue.enqueue({
      projectId: PROJECT_ID,
      subjectIncidentId: INCIDENT_ID,
      followUpForAlertId: ALERT_ID,
      admitInsideSubjectLock: async (): Promise<boolean> => {
        return true;
      },
    });

    expect(runId).toBe(createdId);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: AIRunStatus.Queued,
          runType: AIRunType.Investigation,
          triggeredByIncidentId: INCIDENT_ID,
          followUpForAlertId: ALERT_ID,
        }),
      }),
    );
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 0);
    });
    expect(processRun).toHaveBeenCalledWith(
      expect.objectContaining({
        id: createdId,
        triggeredByIncidentId: INCIDENT_ID,
        followUpForAlertId: ALERT_ID,
      }),
    );
  });

  test("the guard is asked inside the subject lock; when it says no, nothing is created, kicked or recorded", async () => {
    const order: Array<string> = [];
    (Semaphore.lock as unknown as jest.Mock).mockImplementation(
      async (): Promise<unknown> => {
        order.push("lock");
        return {};
      },
    );
    (Semaphore.release as unknown as jest.Mock).mockImplementation(
      async (): Promise<void> => {
        order.push("release");
      },
    );
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");
    const processRun: jest.SpyInstance = jest
      .spyOn(AIInvestigationQueue, "processRun")
      .mockResolvedValue(undefined);
    const onNotEnqueued: jest.Mock = jest.fn();

    const runId: ObjectID | null = await AIInvestigationQueue.enqueue({
      projectId: PROJECT_ID,
      subjectIncidentId: INCIDENT_ID,
      followUpForAlertId: ALERT_ID,
      onNotEnqueued: onNotEnqueued as never,
      admitInsideSubjectLock: async (): Promise<boolean> => {
        order.push("admit");
        return false;
      },
    });

    expect(runId).toBeNull();
    expect(order).toEqual(["lock", "admit", "release"]);
    expect(create).not.toHaveBeenCalled();
    expect(processRun).not.toHaveBeenCalled();
    expect(onNotEnqueued).not.toHaveBeenCalled();
  });

  test("an enqueue without a guard is created as it always was", async () => {
    const create: jest.SpyInstance = jest
      .spyOn(AIRunService, "create")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as AIRun);
    jest.spyOn(AIInvestigationQueue, "processRun").mockResolvedValue(undefined);

    await AIInvestigationQueue.enqueue({
      projectId: PROJECT_ID,
      subjectIncidentId: INCIDENT_ID,
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(
      (create.mock.calls[0]![0] as { data: AIRun }).data.followUpForAlertId,
    ).toBeUndefined();
  });

  test("the poller carries the alert to the incident runner", async () => {
    const runId: ObjectID = ObjectID.generate();
    jest
      .spyOn(AIRunService, "findBy")
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: runId,
          projectId: PROJECT_ID,
          attemptCount: 0,
          runType: AIRunType.Investigation,
          triggeredByIncidentId: INCIDENT_ID,
          followUpForAlertId: ALERT_ID,
        } as unknown as AIRun,
      ]);
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);
    const execute: jest.SpyInstance = jest
      .spyOn(AIIncidentInvestigationRunner, "executeInvestigation")
      .mockResolvedValue(undefined);

    await AIInvestigationQueue.processQueuedRuns();
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 0);
    });

    expect(execute).toHaveBeenCalledWith({
      aiRunId: runId,
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
      attemptCount: 1,
      followUpForAlertId: ALERT_ID,
    });
    // The poller read the marker with the run.
    expect(
      (
        (AIRunService.findBy as unknown as jest.Mock).mock.calls[1]![0] as {
          select: Record<string, boolean>;
        }
      ).select["followUpForAlertId"],
    ).toBe(true);
  });

  test("a first investigation reaches the runner without a follow-up alert", async () => {
    const runId: ObjectID = ObjectID.generate();
    jest
      .spyOn(AIRunService, "findBy")
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: runId,
          projectId: PROJECT_ID,
          attemptCount: 0,
          runType: AIRunType.Investigation,
          triggeredByIncidentId: INCIDENT_ID,
        } as unknown as AIRun,
      ]);
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);
    const execute: jest.SpyInstance = jest
      .spyOn(AIIncidentInvestigationRunner, "executeInvestigation")
      .mockResolvedValue(undefined);

    await AIInvestigationQueue.processQueuedRuns();
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 0);
    });

    expect(execute).toHaveBeenCalledWith({
      aiRunId: runId,
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
      attemptCount: 1,
    });
  });

  test("an expired follow-up check is cancelled and never releases remediation a second time", async () => {
    jest
      .spyOn(AIRunService, "findBy")
      .mockResolvedValueOnce([
        {
          id: ObjectID.generate(),
          projectId: PROJECT_ID,
          runType: AIRunType.Investigation,
          triggeredByIncidentId: INCIDENT_ID,
          followUpForAlertId: ALERT_ID,
        } as unknown as AIRun,
      ])
      .mockResolvedValueOnce([]);
    const transition: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);

    await AIInvestigationQueue.processQueuedRuns();

    expect(transition).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({ status: AIRunStatus.Cancelled }),
      }),
    );
    expect(handoff).not.toHaveBeenCalled();
  });

  test("a follow-up check that goes stale for good never releases remediation either", async () => {
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);

    const outcome: "requeued" | "stale" | "noop" =
      await AIInvestigationQueue.requeueOrMarkStale({
        id: ObjectID.generate(),
        attemptCount: MAX_INVESTIGATION_ATTEMPTS,
        runType: AIRunType.Investigation,
        projectId: PROJECT_ID,
        triggeredByIncidentId: INCIDENT_ID,
        followUpForAlertId: ALERT_ID,
      });

    expect(outcome).toBe("stale");
    expect(handoff).not.toHaveBeenCalled();

    // The first investigation, staled the same way, still releases it.
    await AIInvestigationQueue.requeueOrMarkStale({
      id: ObjectID.generate(),
      attemptCount: MAX_INVESTIGATION_ATTEMPTS,
      runType: AIRunType.Investigation,
      projectId: PROJECT_ID,
      triggeredByIncidentId: INCIDENT_ID,
    });

    expect(handoff).toHaveBeenCalledTimes(1);
  });
});

describe("what the engine records", () => {
  const aiRunId: ObjectID = ObjectID.generate();
  let events: Array<AIRunEvent>;
  let answer: jest.SpyInstance;
  let posted: Array<string>;

  const CONTEXT_NOTES: Array<AIRunEventResultSummary> = [
    {
      message:
        'Checking again: alert #12 opened on Host "web-1" after the first analysis',
      severity: "Info",
      followUpCheck: {
        alertNumber: 12,
        resourceKind: "Host",
        resourceName: "web-1",
        minutesAfterIncident: 2,
      },
    },
    {
      message: "Read 2 open or recent alerts on Host web-1",
      severity: "Info",
      linkedInfrastructure: {
        resources: [{ kind: "Host", name: "web-1" }],
        alertCount: 2,
        openAlertCount: 1,
        hasMoreAlerts: false,
        lookbackMinutes: 30,
      },
    },
  ];

  function result(): ObservabilityAssistantResult {
    return {
      contentInMarkdown:
        "**Summary** — shop-api saturated the CPU of web-1.\n\n**Most likely root cause** — a CPU-bound container.",
      citations: [],
      totalTokens: 100,
      llmCallCount: 2,
      toolCallCount: 3,
    };
  }

  function request(
    overrides: Partial<InvestigationRequest> = {},
  ): InvestigationRequest {
    return {
      feature: "AI Incident Investigation",
      incidentId: INCIDENT_ID,
      contextSummary: "# Incident\nTitle: Shop is down",
      postAnalysis: async (data: {
        analysisMarkdown: string;
      }): Promise<void> => {
        posted.push(data.analysisMarkdown);
      },
      ...overrides,
    };
  }

  beforeEach(() => {
    events = [];
    posted = [];
    jest
      .spyOn(AIRunEventService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(AIRunEventService, "create")
      .mockImplementation(async (data: { data: AIRunEvent }) => {
        events.push(data.data);
        return data.data;
      });
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);
    jest
      .spyOn(AIConfidenceSignal, "computeConfidenceSignal")
      .mockResolvedValue({
        confident: true,
        codeFixRecommended: false,
        source: "classification",
      });
    answer = jest
      .spyOn(ObservabilityAssistant, "answerQuestion")
      .mockResolvedValue(result());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("what the starting context read is the run's first activity, in order, before the model starts", async () => {
    await AIInvestigationEngine.executeRun({
      aiRunId,
      projectId: PROJECT_ID,
      attemptCount: 1,
      request: request({ contextNotes: CONTEXT_NOTES }),
    });

    expect(events[0]!.eventType).toBe(AIRunEventType.RunStarted);
    expect(events[1]!.eventType).toBe(AIRunEventType.ProgressLog);
    expect(events[1]!.resultSummary).toEqual(CONTEXT_NOTES[0]);
    expect(events[2]!.eventType).toBe(AIRunEventType.ProgressLog);
    expect(events[2]!.resultSummary).toEqual(CONTEXT_NOTES[1]);
    expect(
      events.map((event: AIRunEvent): number | undefined => {
        return event.sequence;
      }),
    ).toEqual(
      events.map((_event: AIRunEvent, index: number): number => {
        return index;
      }),
    );
  });

  test("without notes, the run records what it always did", async () => {
    await AIInvestigationEngine.executeRun({
      aiRunId,
      projectId: PROJECT_ID,
      attemptCount: 1,
      request: request(),
    });

    expect(
      events.filter((event: AIRunEvent): boolean => {
        return event.eventType === AIRunEventType.ProgressLog;
      }),
    ).toEqual([]);
  });

  test("the runner's lead goes under the report's heading; without one the report is as it was", async () => {
    await AIInvestigationEngine.executeRun({
      aiRunId,
      projectId: PROJECT_ID,
      attemptCount: 1,
      request: request({
        reportLead: mdText`**Checked again** after alert #12 opened on Host web-1, 2 minutes after this incident was declared.`,
      }),
    });
    await AIInvestigationEngine.executeRun({
      aiRunId,
      projectId: PROJECT_ID,
      attemptCount: 1,
      request: request(),
    });

    expect(
      posted[0]!.startsWith(
        "## 🧠 AI — Automated Root Cause Analysis\n\n**Checked again** after alert #12 opened on Host web-1, 2 minutes after this incident was declared.\n\n**Summary** — shop-api saturated the CPU of web-1.",
      ),
    ).toBe(true);
    expect(
      posted[1]!.startsWith(
        "## 🧠 AI — Automated Root Cause Analysis\n\n**Summary** — shop-api saturated the CPU of web-1.",
      ),
    ).toBe(true);
  });

  test("every tool reads as the run's own project: the run's props carry it as the tenant", async () => {
    await AIInvestigationEngine.executeRun({
      aiRunId,
      projectId: PROJECT_ID,
      attemptCount: 1,
      request: request(),
    });

    expect(answer).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        props: { isRoot: true, tenantId: PROJECT_ID },
      }),
    );
  });

  test("the persona starts from the linked infrastructure and its alerts", async () => {
    await AIInvestigationEngine.executeRun({
      aiRunId,
      projectId: PROJECT_ID,
      attemptCount: 1,
      request: request(),
    });

    expect(
      (answer.mock.calls[0]![0] as { systemInstructions: string })
        .systemInstructions,
    ).toContain(
      "and from the infrastructure the context lists them linked to (hosts, Docker hosts, clusters) — read the alerts on it first.",
    );
  });
});
