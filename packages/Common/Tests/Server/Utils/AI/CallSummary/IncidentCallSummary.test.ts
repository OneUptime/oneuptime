import Incident from "../../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../../../Models/DatabaseModels/IncidentState";
import IncidentVideoCall from "../../../../../Models/DatabaseModels/IncidentVideoCall";
import LlmLog from "../../../../../Models/DatabaseModels/LlmLog";
import AIService, {
  AI_DISABLED_MESSAGE,
  AI_INCIDENT_CALL_SUMMARY_FEATURE,
  AILogRequest,
  AILogResponse,
} from "../../../../../Server/Services/AIService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import IncidentVideoCallService from "../../../../../Server/Services/IncidentVideoCallService";
import IncidentCallSummary, {
  CallSummaryStart,
  MAX_CALL_SUMMARY_STATUS_MESSAGE_LENGTH,
} from "../../../../../Server/Utils/AI/CallSummary/IncidentCallSummary";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  CallSummary,
  CallSummaryRootCauseOutcome,
  CallSummaryStatus,
  RootCauseSuggestionStatus,
  readCallSummary,
} from "../../../../../Types/VideoCall/CallSummary";
import VideoCallProvider from "../../../../../Types/VideoCall/VideoCallProvider";
import TranscriptText from "../../../../../Utils/VideoCall/TranscriptText";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * OneUptime AI reading an incident call's transcript, as the server runs
 * it: not at all when AI is off for the project (Skipped, saying where to
 * turn it on), otherwise Pending at once and the reading in the background,
 * through AIService - metered, limited, logged without its content - and
 * only the newest reading of a call ever writes what it found. A suggested
 * cause waits for a person; "not enough discussion" suggests nothing.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const INCIDENT: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CALL: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const USER: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

const TRANSCRIPT: string = TranscriptText.serialize([
  { offsetInSeconds: 5, speaker: "Priya Shah", text: "Checkout is timing out." },
  { offsetInSeconds: 70, speaker: "Sam Lee", text: "The DB pool is at 100%." },
  {
    offsetInSeconds: 723,
    speaker: "Priya Shah",
    text: "The pool maxes at 50 and the deploy went to 100 workers.",
  },
]);

const SUGGESTED_ANSWER: JSONObject = {
  rootCause: {
    outcome: "suggested",
    summary: "The deploy doubled the workers and exhausted the DB pool.",
    basis: "stated_on_call",
    lines: ["L3"],
  },
  findings: [{ text: "The pool was at 100%.", kind: "confirmed", lines: ["L2"] }],
};

// The call as stored: what the reading's own writes leave in it.
let stored: {
  transcript: string | null;
  callSummary: JSONObject | null;
};
let writes: Array<JSONObject>;

function storedCall(): IncidentVideoCall {
  const call: IncidentVideoCall = new IncidentVideoCall();
  call.id = CALL;
  call.projectId = PROJECT;
  call.incidentId = INCIDENT;
  call.provider = VideoCallProvider.Zoom;

  if (stored.transcript !== null) {
    call.transcript = stored.transcript;
  }

  if (stored.callSummary !== null) {
    call.callSummary = stored.callSummary;
  }

  return call;
}

function lastWrite(): JSONObject {
  expect(writes.length).toBeGreaterThan(0);
  return writes[writes.length - 1]!;
}

let executeWithLogging: ReturnType<typeof jest.spyOn>;

function answerWith(content: string | Error): void {
  executeWithLogging.mockImplementation(async (): Promise<AILogResponse> => {
    if (content instanceof Error) {
      throw content;
    }

    return { content, llmLog: new LlmLog() };
  });
}

beforeEach(() => {
  stored = { transcript: TRANSCRIPT, callSummary: null };
  writes = [];

  jest
    .spyOn(IncidentVideoCallService, "findOneById")
    .mockImplementation(async () => {
      return storedCall();
    });

  jest
    .spyOn(IncidentVideoCallService, "updateOneById")
    .mockImplementation(async (data: { data: unknown }) => {
      const written: JSONObject = data.data as JSONObject;
      writes.push(written);

      if (Object.prototype.hasOwnProperty.call(written, "callSummary")) {
        stored.callSummary = (written["callSummary"] as JSONObject | null) || null;
      }

      if (Object.prototype.hasOwnProperty.call(written, "transcript")) {
        stored.transcript = (written["transcript"] as string | null) || null;
      }
    });

  jest.spyOn(IncidentService, "findOneById").mockImplementation(async () => {
    const incident: Incident = new Incident();
    incident.id = INCIDENT;
    incident.title = "Checkout API is down";
    incident.description = "p95 above 2s.";
    incident.incidentNumberWithPrefix = "INC-42";
    incident.declaredAt = new Date("2026-10-17T14:07:00.000Z");

    const severity: IncidentSeverity = new IncidentSeverity();
    severity.name = "SEV-1";
    incident.incidentSeverity = severity;

    const state: IncidentState = new IncidentState();
    state.name = "Investigating";
    incident.currentIncidentState = state;

    return incident;
  });

  jest.spyOn(AIService, "isProjectAIEnabled").mockResolvedValue(true);
  executeWithLogging = jest.spyOn(AIService, "executeWithLogging");
  answerWith(JSON.stringify(SUGGESTED_ANSWER));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("IncidentCallSummary.start", () => {
  test("AI off for the project: Skipped, saying where to turn it on - and nothing sent", async () => {
    jest.spyOn(AIService, "isProjectAIEnabled").mockResolvedValue(false);
    const run: ReturnType<typeof jest.spyOn> = jest.spyOn(IncidentCallSummary, "run");

    const started: CallSummaryStart = await IncidentCallSummary.start({
      callId: CALL,
      userId: USER,
    });

    expect(started).toEqual({
      status: CallSummaryStatus.Skipped,
      message: AI_DISABLED_MESSAGE,
    });
    expect(lastWrite()).toEqual({
      callSummary: null,
      callSummaryStatus: CallSummaryStatus.Skipped,
      callSummaryStatusMessage: AI_DISABLED_MESSAGE,
      callSummaryUpdatedAt: expect.any(Date),
      rootCauseSuggestionStatus: null,
      rootCauseSuggestionReviewedAt: null,
      rootCauseSuggestionReviewedByUserId: null,
    });
    expect(run).not.toHaveBeenCalled();
    expect(executeWithLogging).not.toHaveBeenCalled();
  });

  test("a call with no transcript has nothing to read", async () => {
    stored.transcript = null;

    let thrown: unknown = null;

    try {
      await IncidentCallSummary.start({ callId: CALL });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(BadDataException);
    expect(writes).toHaveLength(0);
  });

  test("AI on: Pending at once with the reading's id, and the reading started in the background", async () => {
    const run: ReturnType<typeof jest.spyOn> = jest
      .spyOn(IncidentCallSummary, "run")
      .mockResolvedValue(undefined);

    const started: CallSummaryStart = await IncidentCallSummary.start({
      callId: CALL,
      userId: USER,
    });

    expect(started.status).toBe(CallSummaryStatus.Pending);
    expect(ObjectID.isValidUUID(started.runId || "")).toBe(true);
    expect(lastWrite()).toEqual({
      callSummary: { runId: started.runId },
      callSummaryStatus: CallSummaryStatus.Pending,
      callSummaryStatusMessage: null,
      callSummaryUpdatedAt: expect.any(Date),
      rootCauseSuggestionStatus: null,
      rootCauseSuggestionReviewedAt: null,
      rootCauseSuggestionReviewedByUserId: null,
    });
    expect(run).toHaveBeenCalledWith({
      callId: CALL,
      runId: started.runId,
      userId: USER,
      complete: undefined,
    });
  });

  test("every reading gets its own id", async () => {
    jest.spyOn(IncidentCallSummary, "run").mockResolvedValue(undefined);

    const first: CallSummaryStart = await IncidentCallSummary.start({ callId: CALL });
    const second: CallSummaryStart = await IncidentCallSummary.start({ callId: CALL });

    expect(first.runId).not.toBe(second.runId);
  });
});

describe("IncidentCallSummary.run", () => {
  const RUN: string = "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e";

  beforeEach(() => {
    stored.callSummary = { runId: RUN };
  });

  test("asks AIService - this feature, the incident, the person - with the cited transcript and no stored previews", async () => {
    await IncidentCallSummary.run({ callId: CALL, runId: RUN, userId: USER });

    expect(executeWithLogging).toHaveBeenCalledTimes(1);

    const request: AILogRequest = executeWithLogging.mock.calls[0]![0] as AILogRequest;

    expect(request).toEqual(
      expect.objectContaining({
        projectId: PROJECT,
        userId: USER,
        feature: AI_INCIDENT_CALL_SUMMARY_FEATURE,
        incidentId: INCIDENT,
        temperature: 0.1,
        maxTokens: 4096,
        storeContentPreviews: false,
      }),
    );
    expect(AI_INCIDENT_CALL_SUMMARY_FEATURE).toBe("Incident Call Summary");
    expect(request.messages[1]!.content).toContain("Incident INC-42: Checkout API is down");
    expect(request.messages[1]!.content).toContain("Call: Zoom meeting.");
    expect(request.messages[1]!.content).toContain(
      "L3 [00:12:03] Priya Shah: The pool maxes at 50 and the deploy went to 100 workers.",
    );
  });

  test("a suggested cause is stored Ready, cited, and waits for a person", async () => {
    await IncidentCallSummary.run({ callId: CALL, runId: RUN, userId: USER });

    const written: JSONObject = lastWrite();

    expect(written["callSummaryStatus"]).toBe(CallSummaryStatus.Ready);
    expect(written["callSummaryStatusMessage"]).toBeNull();
    expect(written["rootCauseSuggestionStatus"]).toBe(RootCauseSuggestionStatus.Suggested);
    expect(written["rootCauseSuggestionReviewedAt"]).toBeNull();

    const summary: CallSummary | null = readCallSummary(written["callSummary"]);

    expect(summary).not.toBeNull();
    expect(summary!.runId).toBe(RUN);
    expect(Number.isNaN(Date.parse(summary!.generatedAt))).toBe(false);
    expect(summary!.linesRead).toBe(3);
    expect(summary!.rootCause.outcome).toBe(CallSummaryRootCauseOutcome.Suggested);
    expect(summary!.rootCause.citations).toEqual([
      {
        line: 3,
        time: "00:12:03",
        speaker: "Priya Shah",
        text: "The pool maxes at 50 and the deploy went to 100 workers.",
      },
    ]);
  });

  test("not enough discussion suggests nothing to review", async () => {
    answerWith(JSON.stringify({ rootCause: { outcome: "not_enough_discussion" } }));

    await IncidentCallSummary.run({ callId: CALL, runId: RUN });

    expect(lastWrite()["callSummaryStatus"]).toBe(CallSummaryStatus.Ready);
    expect(lastWrite()["rootCauseSuggestionStatus"]).toBeNull();
  });

  test("a reading replaced before it started does nothing", async () => {
    stored.callSummary = { runId: "a-newer-reading" };

    await IncidentCallSummary.run({ callId: CALL, runId: RUN });

    expect(executeWithLogging).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  test("a reading replaced while it ran writes nothing when it ends", async () => {
    executeWithLogging.mockImplementation(async (): Promise<AILogResponse> => {
      // Someone added another transcript meanwhile.
      stored.callSummary = { runId: "a-newer-reading" };
      return { content: JSON.stringify(SUGGESTED_ANSWER), llmLog: new LlmLog() };
    });

    await IncidentCallSummary.run({ callId: CALL, runId: RUN });

    expect(writes).toHaveLength(0);
  });

  test("a refusal - a daily limit, no provider - is stored Failed with its reason", async () => {
    answerWith(
      new BadDataException(
        "This project has used its daily AI token limit. OneUptime AI starts again at midnight UTC.",
      ),
    );

    await IncidentCallSummary.run({ callId: CALL, runId: RUN });

    expect(lastWrite()).toEqual({
      callSummary: { runId: RUN },
      callSummaryStatus: CallSummaryStatus.Failed,
      callSummaryStatusMessage:
        "This project has used its daily AI token limit. OneUptime AI starts again at midnight UTC.",
      callSummaryUpdatedAt: expect.any(Date),
      rootCauseSuggestionStatus: null,
      rootCauseSuggestionReviewedAt: null,
      rootCauseSuggestionReviewedByUserId: null,
    });
  });

  test("an answer that cannot be read is a failure, never a summary", async () => {
    answerWith("Sorry, I cannot help with that.");

    await IncidentCallSummary.run({ callId: CALL, runId: RUN });

    expect(lastWrite()["callSummaryStatus"]).toBe(CallSummaryStatus.Failed);
    expect(lastWrite()["callSummaryStatusMessage"]).toMatch(/could not be read/);
  });

  test("a failure replaced by a newer reading is not stored", async () => {
    executeWithLogging.mockImplementation(async (): Promise<AILogResponse> => {
      stored.callSummary = { runId: "a-newer-reading" };
      throw new Error("provider down");
    });

    await IncidentCallSummary.run({ callId: CALL, runId: RUN });

    expect(writes).toHaveLength(0);
  });
});

describe("IncidentCallSummary.getErrorMessage", () => {
  test("held to what the column keeps", () => {
    const message: string = IncidentCallSummary.getErrorMessage(
      new Error("x".repeat(2_000)),
    );

    expect(message.length).toBe(MAX_CALL_SUMMARY_STATUS_MESSAGE_LENGTH);
    expect(message.endsWith("…")).toBe(true);
    expect(MAX_CALL_SUMMARY_STATUS_MESSAGE_LENGTH).toBeLessThan(500);
  });

  test("a credential in a provider's error is redacted", () => {
    const message: string = IncidentCallSummary.getErrorMessage(
      new Error(
        "401 from provider: Authorization: Bearer sk-live-abcdefghijklmnopqrstuvwxyz0123456789",
      ),
    );

    expect(message).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
  });

  test("something that is not an error still says what happened", () => {
    expect(IncidentCallSummary.getErrorMessage("nope")).toBe(
      "OneUptime AI could not read the transcript.",
    );
  });
});
