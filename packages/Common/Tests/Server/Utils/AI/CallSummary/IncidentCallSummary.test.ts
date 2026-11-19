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
import IncidentCallSummaryFeed from "../../../../../Server/Utils/AI/CallSummary/IncidentCallSummaryFeed";
import IncidentCallTranscriptRemoval from "../../../../../Server/Utils/VideoCall/Transcripts/IncidentCallTranscriptRemoval";
import { CallSummaryPost } from "../../../../../Types/VideoCall/CallSummaryPosts";
import { VideoCallTranscriptSource } from "../../../../../Types/VideoCall/VideoCallTranscript";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import AIIncidentPostmortemRunner from "../../../../../Server/Utils/AI/SRE/IncidentPostmortemRunner";
import logger from "../../../../../Server/Utils/Logger";
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
  {
    offsetInSeconds: 5,
    speaker: "Priya Shah",
    text: "Checkout is timing out.",
  },
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
  findings: [
    { text: "The pool was at 100%.", kind: "confirmed", lines: ["L2"] },
  ],
};

// When the transcript was added: what a reading's post is kept against.
const TRANSCRIPT_ADDED_AT: Date = new Date("2026-10-17T15:00:00.000Z");

// The call as stored: what the reading's own writes leave in it.
let stored: {
  transcript: string | null;
  callSummary: JSONObject | null;
  transcriptAddedAt: Date | null;
  transcriptSource: VideoCallTranscriptSource | null;
  transcriptSignInAccountId: string | null;
};
let writes: Array<JSONObject>;
// Where each reading's post was kept, as keepCallSummaryPost was asked.
let kept: Array<{
  callId: ObjectID;
  transcriptAddedAt: Date;
  post: CallSummaryPost;
}>;

// What a reading's post came to: its feed item and one Slack message.
function aPost(): CallSummaryPost {
  return {
    feedId: "66666666-6666-4666-8666-666666666666",
    postedAt: "2026-10-17T15:05:00.000Z",
    messages: [
      {
        workspaceType: WorkspaceType.Slack,
        channelId: "C0INC42",
        channelName: "inc-42",
        messageId: "1760713500.000100",
      },
    ],
  };
}

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

  if (stored.transcriptAddedAt !== null) {
    call.transcriptAddedAt = stored.transcriptAddedAt;
  }

  if (stored.transcriptSource !== null) {
    call.transcriptSource = stored.transcriptSource;
  }

  if (stored.transcriptSignInAccountId !== null) {
    call.transcriptSignInAccountId = stored.transcriptSignInAccountId;
  }

  return call;
}

function lastWrite(): JSONObject {
  expect(writes.length).toBeGreaterThan(0);
  return writes[writes.length - 1]!;
}

let executeWithLogging: ReturnType<typeof jest.spyOn>;
let feedPost: ReturnType<typeof jest.spyOn>;
let draftWaiting: ReturnType<typeof jest.spyOn>;
let keepPost: ReturnType<typeof jest.spyOn>;
let deletePosts: ReturnType<typeof jest.spyOn>;

function answerWith(content: string | Error): void {
  executeWithLogging.mockImplementation(async (): Promise<AILogResponse> => {
    if (content instanceof Error) {
      throw content;
    }

    return { content, llmLog: new LlmLog() };
  });
}

beforeEach(() => {
  stored = {
    transcript: TRANSCRIPT,
    callSummary: null,
    transcriptAddedAt: TRANSCRIPT_ADDED_AT,
    transcriptSource: VideoCallTranscriptSource.Provider,
    transcriptSignInAccountId: null,
  };
  writes = [];
  kept = [];

  jest
    .spyOn(IncidentVideoCallService, "findOneById")
    .mockImplementation(async () => {
      return storedCall();
    });

  jest
    .spyOn(IncidentVideoCallService, "updateOneById")
    .mockImplementation(async (data: { data: unknown }): Promise<number> => {
      const written: JSONObject = data.data as JSONObject;
      writes.push(written);

      if (Object.prototype.hasOwnProperty.call(written, "callSummary")) {
        stored.callSummary =
          (written["callSummary"] as JSONObject | null) || null;
      }

      if (Object.prototype.hasOwnProperty.call(written, "transcript")) {
        stored.transcript = (written["transcript"] as string | null) || null;
      }

      return 1;
    });

  // One UPDATE that writes only while the reading is still the call's.
  jest
    .spyOn(IncidentVideoCallService, "writeReadingIfCurrent")
    .mockImplementation(
      async (data: {
        callId: ObjectID;
        runId: string;
        columns: unknown;
      }): Promise<boolean> => {
        if (stored.callSummary?.["runId"] !== data.runId) {
          return false;
        }

        const written: JSONObject = data.columns as JSONObject;
        writes.push(written);
        stored.callSummary =
          (written["callSummary"] as JSONObject | null) || null;
        return true;
      },
    );

  // Kept only while the transcript the reading read is still the call's.
  keepPost = jest
    .spyOn(IncidentVideoCallService, "keepCallSummaryPost")
    .mockImplementation(
      async (data: {
        callId: ObjectID;
        transcriptAddedAt: Date;
        post: CallSummaryPost;
      }): Promise<boolean> => {
        kept.push(data);
        return (
          stored.transcriptAddedAt !== null &&
          stored.transcriptAddedAt.getTime() ===
            data.transcriptAddedAt.getTime()
        );
      },
    );

  deletePosts = jest
    .spyOn(IncidentCallTranscriptRemoval, "deletePosts")
    .mockResolvedValue({ deleted: [], notDeleted: [] });

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

  feedPost = jest
    .spyOn(IncidentCallSummaryFeed, "post")
    .mockImplementation(async (): Promise<CallSummaryPost> => {
      return aPost();
    });
  draftWaiting = jest
    .spyOn(AIIncidentPostmortemRunner, "draftWaitingPostmortem")
    .mockResolvedValue();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("IncidentCallSummary.start", () => {
  test("AI off for the project: Skipped, saying where to turn it on - and nothing sent", async () => {
    jest.spyOn(AIService, "isProjectAIEnabled").mockResolvedValue(false);
    const run: ReturnType<typeof jest.spyOn> = jest.spyOn(
      IncidentCallSummary,
      "run",
    );

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

    const first: CallSummaryStart = await IncidentCallSummary.start({
      callId: CALL,
    });
    const second: CallSummaryStart = await IncidentCallSummary.start({
      callId: CALL,
    });

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

    const request: AILogRequest = executeWithLogging.mock
      .calls[0]![0] as AILogRequest;

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
    expect(request.messages[1]!.content).toContain(
      "Incident INC-42: Checkout API is down",
    );
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
    expect(written["rootCauseSuggestionStatus"]).toBe(
      RootCauseSuggestionStatus.Suggested,
    );
    expect(written["rootCauseSuggestionReviewedAt"]).toBeNull();

    const summary: CallSummary | null = readCallSummary(written["callSummary"]);

    expect(summary).not.toBeNull();
    expect(summary!.runId).toBe(RUN);
    expect(Number.isNaN(Date.parse(summary!.generatedAt))).toBe(false);
    expect(summary!.linesRead).toBe(3);
    expect(summary!.rootCause.outcome).toBe(
      CallSummaryRootCauseOutcome.Suggested,
    );
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
    answerWith(
      JSON.stringify({ rootCause: { outcome: "not_enough_discussion" } }),
    );

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
      return {
        content: JSON.stringify(SUGGESTED_ANSWER),
        llmLog: new LlmLog(),
      };
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
    expect(lastWrite()["callSummaryStatusMessage"]).toMatch(
      /could not be read/,
    );
  });

  test("a failure replaced by a newer reading is not stored", async () => {
    executeWithLogging.mockImplementation(async (): Promise<AILogResponse> => {
      stored.callSummary = { runId: "a-newer-reading" };
      throw new Error("provider down");
    });

    await IncidentCallSummary.run({ callId: CALL, runId: RUN });

    expect(writes).toHaveLength(0);
  });

  describe("what a reading that ends tells the incident", () => {
    test("a reading that ends Ready posts what it read to the incident's feed, once it is stored", async () => {
      let writesWhenPosted: number = -1;

      feedPost.mockImplementation(async (): Promise<CallSummaryPost> => {
        writesWhenPosted = writes.length;
        return aPost();
      });

      await IncidentCallSummary.run({ callId: CALL, runId: RUN, userId: USER });

      expect(feedPost).toHaveBeenCalledTimes(1);
      expect(writesWhenPosted).toBe(writes.length);

      const posted: {
        call: IncidentVideoCall;
        callLabel: string;
        summary: CallSummary;
      } = feedPost.mock.calls[0]![0] as {
        call: IncidentVideoCall;
        callLabel: string;
        summary: CallSummary;
      };

      expect(posted.call.projectId).toEqual(PROJECT);
      expect(posted.call.incidentId).toEqual(INCIDENT);
      expect(posted.callLabel).toBe("Zoom meeting");
      expect(posted.summary).toEqual(
        readCallSummary(lastWrite()["callSummary"]),
      );
    });

    test("not enough discussion is posted too: what the call settled is news either way", async () => {
      answerWith(
        JSON.stringify({ rootCause: { outcome: "not_enough_discussion" } }),
      );

      await IncidentCallSummary.run({ callId: CALL, runId: RUN });

      expect(feedPost).toHaveBeenCalledTimes(1);
      expect(
        (feedPost.mock.calls[0]![0] as { summary: CallSummary }).summary
          .rootCause.outcome,
      ).toBe(CallSummaryRootCauseOutcome.NotEnoughDiscussion);
    });

    test("a finished reading lets a postmortem draft that waited for it go on, after posting", async () => {
      const order: Array<string> = [];

      feedPost.mockImplementation(async (): Promise<CallSummaryPost> => {
        order.push("feed");
        return aPost();
      });
      draftWaiting.mockImplementation(async (): Promise<void> => {
        order.push("postmortem");
      });

      await IncidentCallSummary.run({ callId: CALL, runId: RUN });

      expect(draftWaiting).toHaveBeenCalledWith({ incidentId: INCIDENT });
      expect(order).toEqual(["feed", "postmortem"]);
    });

    test("a failed reading posts nothing, and still lets a waiting draft go on - it reads the transcript itself", async () => {
      answerWith(new BadDataException("No LLM provider."));

      await IncidentCallSummary.run({ callId: CALL, runId: RUN });

      expect(lastWrite()["callSummaryStatus"]).toBe(CallSummaryStatus.Failed);
      expect(feedPost).not.toHaveBeenCalled();
      expect(draftWaiting).toHaveBeenCalledWith({ incidentId: INCIDENT });
    });

    test("a reading replaced while it ran tells the incident nothing: the newer one will", async () => {
      executeWithLogging.mockImplementation(
        async (): Promise<AILogResponse> => {
          stored.callSummary = { runId: "a-newer-reading" };
          return {
            content: JSON.stringify(SUGGESTED_ANSWER),
            llmLog: new LlmLog(),
          };
        },
      );

      await IncidentCallSummary.run({ callId: CALL, runId: RUN });

      expect(feedPost).not.toHaveBeenCalled();
      expect(draftWaiting).not.toHaveBeenCalled();
    });

    test("keeps where it posted on the call, while the transcript it read is still the call's", async () => {
      await IncidentCallSummary.run({ callId: CALL, runId: RUN });

      expect(kept).toEqual([
        {
          callId: CALL,
          transcriptAddedAt: TRANSCRIPT_ADDED_AT,
          post: aPost(),
        },
      ]);
      expect(deletePosts).not.toHaveBeenCalled();
    });

    test("a post made while the transcript was removed is deleted again at once (#9290)", async () => {
      feedPost.mockImplementation(async (): Promise<CallSummaryPost> => {
        // Someone removed the transcript while the post went out.
        stored.transcriptAddedAt = null;
        stored.transcript = null;
        return aPost();
      });

      await IncidentCallSummary.run({ callId: CALL, runId: RUN });

      expect(keepPost).toHaveBeenCalledTimes(1);
      expect(deletePosts).toHaveBeenCalledWith({
        projectId: PROJECT,
        incidentId: INCIDENT,
        posts: [aPost()],
      });
    });

    test("a post made while the transcript was replaced is deleted too: it read a transcript the call no longer has", async () => {
      feedPost.mockImplementation(async (): Promise<CallSummaryPost> => {
        stored.transcriptAddedAt = new Date("2026-10-17T15:06:00.000Z");
        return aPost();
      });

      await IncidentCallSummary.run({ callId: CALL, runId: RUN });

      expect(deletePosts).toHaveBeenCalledTimes(1);
    });

    test("a post that cannot be kept, because keeping it failed, is deleted rather than left behind", async () => {
      keepPost.mockRejectedValue(new Error("connection reset"));
      jest.spyOn(logger, "error").mockImplementation((): void => {
        return undefined;
      });

      await IncidentCallSummary.run({ callId: CALL, runId: RUN });

      expect(deletePosts).toHaveBeenCalledWith({
        projectId: PROJECT,
        incidentId: INCIDENT,
        posts: [aPost()],
      });
    });

    test("a transcript read through someone's sign-in names the account on its post (#9289)", async () => {
      stored.transcriptSignInAccountId = "KdYKjnimT4KPd8FFgQt9FQ";

      await IncidentCallSummary.run({ callId: CALL, runId: RUN });

      expect(
        (feedPost.mock.calls[0]![0] as { signInAccountId?: string })
          .signInAccountId,
      ).toBe("KdYKjnimT4KPd8FFgQt9FQ");
    });

    test("a transcript a person added names no account, even on a call an earlier one was read through", async () => {
      stored.transcriptSource = VideoCallTranscriptSource.Upload;
      stored.transcriptSignInAccountId = "KdYKjnimT4KPd8FFgQt9FQ";

      await IncidentCallSummary.run({ callId: CALL, runId: RUN });

      expect(
        (feedPost.mock.calls[0]![0] as { signInAccountId?: string })
          .signInAccountId,
      ).toBeUndefined();
    });

    test("a reading replaced between its last look and its write posts nothing: the write itself checks", async () => {
      jest
        .spyOn(IncidentVideoCallService, "writeReadingIfCurrent")
        .mockResolvedValue(false);

      await IncidentCallSummary.run({ callId: CALL, runId: RUN });

      expect(feedPost).not.toHaveBeenCalled();
      expect(keepPost).not.toHaveBeenCalled();
      expect(draftWaiting).not.toHaveBeenCalled();
    });

    test("a draft that cannot go on is logged; the reading stays stored", async () => {
      draftWaiting.mockRejectedValue(new Error("model unavailable"));
      const errorLog: ReturnType<typeof jest.spyOn> = jest
        .spyOn(logger, "error")
        .mockImplementation((): void => {
          return undefined;
        });

      await expect(
        IncidentCallSummary.run({ callId: CALL, runId: RUN }),
      ).resolves.toBeUndefined();

      expect(lastWrite()["callSummaryStatus"]).toBe(CallSummaryStatus.Ready);
      expect(errorLog).toHaveBeenCalledWith(
        expect.stringContaining("Could not draft a postmortem"),
        expect.objectContaining({ incidentId: INCIDENT.toString() }),
      );
    });
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
