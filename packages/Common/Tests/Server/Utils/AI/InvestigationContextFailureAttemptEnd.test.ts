import AIInvestigationQueue, {
  MAX_ATTEMPT_ERROR_LENGTH,
  MAX_INVESTIGATION_ATTEMPTS,
} from "../../../../Server/Utils/AI/SRE/InvestigationQueue";
import AIIncidentInvestigationRunner from "../../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import AIAlertInvestigationRunner from "../../../../Server/Utils/AI/SRE/AlertInvestigationRunner";
import AIInvestigationEngine from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import RemediationHandoff from "../../../../Server/Utils/AI/SRE/RemediationHandoff";
import IncidentAIContextBuilder from "../../../../Server/Utils/AI/IncidentAIContextBuilder";
import AlertAIContextBuilder from "../../../../Server/Utils/AI/AlertAIContextBuilder";
import AIRunRetryPolicy from "../../../../Server/Utils/AI/AIRunRetryPolicy";
import AIRunEventService from "../../../../Server/Services/AIRunEventService";
import AIRunService from "../../../../Server/Services/AIRunService";
import logger from "../../../../Server/Utils/Logger";
import ReadAudienceReader, {
  ReadAudienceSubject,
} from "../../../../Server/Utils/ReadAudience/ReadAudienceReader";
import ReadAudience from "../../../../Types/BaseDatabase/ReadAudience";
import {
  AIRunAttemptEnd,
  AIRunAttemptOutcome,
  AIRunFailureKind,
} from "../../../../Types/AI/AIRunAttempt";
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
import { AIRunEventResultSummary } from "../../../../Types/AI/AIChatTypes";
import ObjectID from "../../../../Types/ObjectID";
import { readAudienceOf } from "../../../Helpers/ReadAudienceFixtures";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * AN ATTEMPT THAT FAILS BEFORE THE ENGINE RUNS SAYS HOW IT ENDED (#6490).
 *
 * Since #6437 and #6438 each attempt of a durable AI run records how it
 * ended - an AttemptEnded event, or a RunFailed event carrying the
 * attempt's end - and the incident and alert card reads it: why the run did
 * not finish, how many times OneUptime tried, what to do. The engine writes
 * those for its own attempts. But the runners also fail a run before the
 * engine starts, when its starting context cannot be built ("Failed to
 * build incident context: ..."), and they kept the queue's decision to
 * themselves: the activity had no end line for the attempt, and the notice
 * guessed from the run's message, with no count of attempts.
 *
 * Now the queue says it for every such failure (failOrRequeue): on attempt
 * 1 of 2 one AttemptEnded, WillRetry, with when the next attempt starts; on
 * the last one RunFailed, GaveUp. Nothing when the run had moved on.
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
const RUN_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");

interface AppendedEvent {
  projectId: ObjectID;
  aiRunId: ObjectID;
  eventType: AIRunEventType;
  resultSummary?: AIRunEventResultSummary | undefined;
  afterLastEvent?: boolean | undefined;
}

let appendEvent: jest.SpyInstance;
let transition: jest.SpyInstance;

beforeEach(() => {
  appendEvent = jest
    .spyOn(AIRunEventService, "appendEventToRun")
    .mockResolvedValue(undefined);
  transition = jest
    .spyOn(AIRunService, "attemptStatusTransition")
    .mockResolvedValue(1);
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest
    .spyOn(ReadAudienceReader, "forSubject")
    .mockImplementation(
      async (subject: ReadAudienceSubject): Promise<ReadAudience> => {
        return readAudienceOf({ projectId: subject.projectId });
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
  handoff.mockClear();
});

function appended(): Array<AppendedEvent> {
  return appendEvent.mock.calls.map((call: Array<unknown>): AppendedEvent => {
    return call[0] as AppendedEvent;
  });
}

function onlyAttemptEnd(): AIRunAttemptEnd {
  expect(appended()).toHaveLength(1);
  return appended()[0]!.resultSummary!.attemptEnd!;
}

function minutesFromNow(iso: string): number {
  return (new Date(iso).getTime() - Date.now()) / (60 * 1000);
}

describe("AIInvestigationQueue.failOrRequeue writes how the attempt ended", () => {
  const MESSAGE: string = "Failed to build incident context: db unreachable";

  test("a requeued attempt: one AttemptEnded, WillRetry, attempt 1 of 2, and when the next one starts", async () => {
    await expect(
      AIInvestigationQueue.failOrRequeue({
        aiRunId: RUN_ID,
        projectId: PROJECT_ID,
        attemptCount: 1,
        errorMessage: MESSAGE,
        isPermanent: false,
      }),
    ).resolves.toBe("requeued");

    const event: AppendedEvent = appended()[0]!;
    expect(event.projectId).toBe(PROJECT_ID);
    expect(event.aiRunId).toBe(RUN_ID);
    expect(event.eventType).toBe(AIRunEventType.AttemptEnded);
    // After the run's last event: the runner has no sequence of its own.
    expect(event.afterLastEvent).toBe(true);
    expect(event.resultSummary?.errorMessage).toBe(MESSAGE);

    const attemptEnd: AIRunAttemptEnd = onlyAttemptEnd();
    expect(attemptEnd).toEqual(
      expect.objectContaining({
        outcome: AIRunAttemptOutcome.WillRetry,
        failureKind: AIRunFailureKind.Other,
        attempt: 1,
        maxAttempts: AIRunRetryPolicy.OTHER_FAILURE_MAX_ATTEMPTS,
      }),
    );
    // About a minute on, give or take the policy's jitter.
    expect(minutesFromNow(attemptEnd.nextAttemptAt!)).toBeGreaterThan(0.7);
    expect(minutesFromNow(attemptEnd.nextAttemptAt!)).toBeLessThan(1.3);
  });

  test("the last attempt: one RunFailed, GaveUp, attempt 2 of 2", async () => {
    await expect(
      AIInvestigationQueue.failOrRequeue({
        aiRunId: RUN_ID,
        projectId: PROJECT_ID,
        attemptCount: MAX_INVESTIGATION_ATTEMPTS,
        errorMessage: MESSAGE,
        isPermanent: false,
      }),
    ).resolves.toBe("finalized");

    expect(appended()[0]!.eventType).toBe(AIRunEventType.RunFailed);
    expect(onlyAttemptEnd()).toEqual({
      outcome: AIRunAttemptOutcome.GaveUp,
      failureKind: AIRunFailureKind.Other,
      attempt: MAX_INVESTIGATION_ATTEMPTS,
      maxAttempts: MAX_INVESTIGATION_ATTEMPTS,
    });
  });

  test("a failure no repeat can get past fails at once, and says so", async () => {
    await AIInvestigationQueue.failOrRequeue({
      aiRunId: RUN_ID,
      projectId: PROJECT_ID,
      attemptCount: 1,
      errorMessage:
        "Failed to build incident context: No LLM provider configured for this project.",
      isPermanent: false,
    });

    expect(appended()[0]!.eventType).toBe(AIRunEventType.RunFailed);
    expect(onlyAttemptEnd()).toEqual({
      outcome: AIRunAttemptOutcome.GaveUp,
      failureKind: AIRunFailureKind.NotConfigured,
      attempt: 1,
      maxAttempts: 1,
    });
  });

  test("a run that moved on first writes nothing: whoever moved it says how it ends", async () => {
    transition.mockResolvedValue(0);

    await expect(
      AIInvestigationQueue.failOrRequeue({
        aiRunId: RUN_ID,
        projectId: PROJECT_ID,
        attemptCount: 1,
        errorMessage: MESSAGE,
        isPermanent: false,
      }),
    ).resolves.toBe("noop");

    expect(appendEvent).not.toHaveBeenCalled();
  });

  test("keeps no more of a long error than the engine keeps", async () => {
    await AIInvestigationQueue.failOrRequeue({
      aiRunId: RUN_ID,
      projectId: PROJECT_ID,
      attemptCount: 1,
      errorMessage: `Failed to build incident context: ${"x".repeat(5000)}`,
      isPermanent: false,
    });

    expect(appended()[0]!.resultSummary?.errorMessage).toHaveLength(
      MAX_ATTEMPT_ERROR_LENGTH,
    );
  });

  test("an event that cannot be written never stops the queue's decision", async () => {
    appendEvent.mockRejectedValue(new Error("db down"));

    await expect(
      AIInvestigationQueue.failOrRequeue({
        aiRunId: RUN_ID,
        projectId: PROJECT_ID,
        attemptCount: 1,
        errorMessage: MESSAGE,
        isPermanent: false,
      }),
    ).resolves.toBe("requeued");
  });
});

describe("an incident's context that cannot be built ends the attempt with a line (issue #6490)", () => {
  let executeRun: jest.SpyInstance;

  beforeEach(() => {
    executeRun = jest
      .spyOn(AIInvestigationEngine, "executeRun")
      .mockResolvedValue(undefined);
    jest
      .spyOn(IncidentAIContextBuilder, "buildIncidentContext")
      .mockRejectedValue(new Error("Database not connected"));
  });

  async function investigate(attemptCount: number): Promise<void> {
    await AIIncidentInvestigationRunner.executeInvestigation({
      aiRunId: RUN_ID,
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
      attemptCount,
    });
  }

  test("on attempt 1 of 2: one AttemptEnded, WillRetry, with when the next attempt starts", async () => {
    await investigate(1);

    expect(executeRun).not.toHaveBeenCalled();
    expect(appended()[0]!.eventType).toBe(AIRunEventType.AttemptEnded);
    expect(appended()[0]!.resultSummary?.errorMessage).toBe(
      "Failed to build incident context: Database not connected",
    );

    const attemptEnd: AIRunAttemptEnd = onlyAttemptEnd();
    expect(attemptEnd.outcome).toBe(AIRunAttemptOutcome.WillRetry);
    expect(attemptEnd.attempt).toBe(1);
    expect(attemptEnd.maxAttempts).toBe(2);
    expect(attemptEnd.nextAttemptAt).toBeDefined();
    // A requeued run is not settled: remediation waits for the next attempt.
    expect(handoff).not.toHaveBeenCalled();
  });

  test("on the last attempt: one RunFailed, GaveUp, and the incident goes on to remediation", async () => {
    await investigate(MAX_INVESTIGATION_ATTEMPTS);

    expect(appended()[0]!.eventType).toBe(AIRunEventType.RunFailed);
    expect(onlyAttemptEnd()).toEqual({
      outcome: AIRunAttemptOutcome.GaveUp,
      failureKind: AIRunFailureKind.Other,
      attempt: 2,
      maxAttempts: 2,
    });
    expect(handoff).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
    });
  });
});

describe("an alert's context that cannot be built ends the attempt with a line too", () => {
  beforeEach(() => {
    jest
      .spyOn(AIInvestigationEngine, "executeRun")
      .mockResolvedValue(undefined);
    jest
      .spyOn(AlertAIContextBuilder, "buildAlertContext")
      .mockRejectedValue(new Error("Database not connected"));
  });

  test("attempt 1 of 2, then the last", async () => {
    await AIAlertInvestigationRunner.executeInvestigation({
      aiRunId: RUN_ID,
      projectId: PROJECT_ID,
      alertId: ALERT_ID,
      attemptCount: 1,
    });

    expect(appended()[0]!.eventType).toBe(AIRunEventType.AttemptEnded);
    expect(appended()[0]!.resultSummary?.errorMessage).toBe(
      "Failed to build alert context: Database not connected",
    );
    expect(onlyAttemptEnd().outcome).toBe(AIRunAttemptOutcome.WillRetry);

    appendEvent.mockClear();

    await AIAlertInvestigationRunner.executeInvestigation({
      aiRunId: RUN_ID,
      projectId: PROJECT_ID,
      alertId: ALERT_ID,
      attemptCount: MAX_INVESTIGATION_ATTEMPTS,
    });

    expect(appended()[0]!.eventType).toBe(AIRunEventType.RunFailed);
    expect(onlyAttemptEnd()).toEqual(
      expect.objectContaining({
        outcome: AIRunAttemptOutcome.GaveUp,
        attempt: 2,
        maxAttempts: 2,
      }),
    );
  });
});
