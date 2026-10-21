import IncidentVideoCall from "../../../../../Models/DatabaseModels/IncidentVideoCall";
import IncidentVideoCallService from "../../../../../Server/Services/IncidentVideoCallService";
import AIIncidentPostmortemRunner from "../../../../../Server/Utils/AI/SRE/IncidentPostmortemRunner";
import logger from "../../../../../Server/Utils/Logger";
import IncidentCallRecordingSetting from "../../../../../Server/Utils/VideoCall/Transcripts/IncidentCallRecordingSetting";
import IncidentCallTranscriptFetch, {
  CALL_TRANSCRIPT_CLAIM_HOLD_IN_MS,
  CallTranscriptFetchOutcome,
  CallTranscriptFetchRunSummary,
  MAX_CALL_TRANSCRIPT_FETCHES_PER_RUN,
} from "../../../../../Server/Utils/VideoCall/Transcripts/IncidentCallTranscriptFetch";
import IncidentCallTranscriptSave from "../../../../../Server/Utils/VideoCall/Transcripts/IncidentCallTranscriptSave";
import {
  VideoCallTranscriptRead,
  transcriptFound,
  transcriptUnavailable,
} from "../../../../../Server/Utils/VideoCall/Transcripts/VideoCallTranscriptRead";
import VideoCallTranscriptReader from "../../../../../Server/Utils/VideoCall/Transcripts/VideoCallTranscriptReader";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import APIException from "../../../../../Types/Exception/ApiException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { CallSummaryStatus } from "../../../../../Types/VideoCall/CallSummary";
import {
  CALL_TRANSCRIPT_FETCH_WINDOW_MS,
  CallTranscriptFetchStatus,
} from "../../../../../Types/VideoCall/CallTranscriptAutoFetch";
import VideoCallProvider from "../../../../../Types/VideoCall/VideoCallProvider";
import {
  VideoCallTranscriptSource,
  VideoCallTranscriptUnavailableReason,
} from "../../../../../Types/VideoCall/VideoCallTranscript";
import { TranscriptSourceFormat } from "../../../../../Utils/VideoCall/TranscriptText";
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
 * Getting an incident call's transcript by itself, once the call is over
 * (Record and transcribe incident calls): which calls the job asks about,
 * that it takes each one before asking so two runs never ask about one call
 * at once, what it does with each answer the provider gives, and when it
 * stops - with the transcript stored and read once, never twice.
 */

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const INCIDENT: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CALL: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const CONNECTION: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const STARTED: Date = new Date("2026-10-19T10:00:00.000Z");

function at(offsetInMs: number): Date {
  return new Date(STARTED.getTime() + offsetInMs);
}

const LINES: VideoCallTranscriptRead = transcriptFound({
  lines: [
    { offsetInSeconds: 5, speaker: "Priya Shah", text: "Checkout is down." },
    {
      offsetInSeconds: 70,
      speaker: "Sam Lee",
      text: "The pool maxes at 50 and the deploy went to 100 workers.",
    },
  ],
  format: TranscriptSourceFormat.WebVTT,
});

function unavailable(
  reason: VideoCallTranscriptUnavailableReason,
): VideoCallTranscriptRead {
  return transcriptUnavailable(reason, `Provider says ${reason}.`);
}

// A Zoom call the job is due to ask about.
function dueCall(
  overrides: Partial<IncidentVideoCall> = {},
): IncidentVideoCall {
  const call: IncidentVideoCall = new IncidentVideoCall();
  call.id = CALL;
  call.projectId = PROJECT;
  call.incidentId = INCIDENT;
  call.provider = VideoCallProvider.Zoom;
  call.videoCallConnectionId = CONNECTION;
  call.externalMeetingId = "85746065432";
  call.createdAt = STARTED;
  call.transcriptFetchStatus = CallTranscriptFetchStatus.Waiting;
  call.transcriptFetchNextAttemptAt = at(10 * MINUTE);
  Object.assign(call, overrides);
  return call;
}

let writes: Array<JSONObject>;
let claim: SpyInstance<typeof IncidentVideoCallService.claimTranscriptFetch>;
let takeForSaving: SpyInstance<
  typeof IncidentVideoCallService.takeTranscriptFetchForSaving
>;
let recordingOn: SpyInstance<typeof IncidentCallRecordingSetting.isOn>;
let read: SpyInstance<typeof VideoCallTranscriptReader.read>;
let save: SpyInstance<typeof IncidentCallTranscriptSave.save>;
let draftWaiting: SpyInstance<
  typeof AIIncidentPostmortemRunner.draftWaitingPostmortem
>;
let warn: SpyInstance<typeof logger.warn>;
let errorLog: SpyInstance<typeof logger.error>;

beforeEach(() => {
  writes = [];

  jest
    .spyOn(IncidentVideoCallService, "updateOneById")
    .mockImplementation(async (data: { data: unknown }): Promise<number> => {
      writes.push(data.data as JSONObject);
      return 1;
    });
  claim = jest
    .spyOn(IncidentVideoCallService, "claimTranscriptFetch")
    .mockResolvedValue(1);
  takeForSaving = jest
    .spyOn(IncidentVideoCallService, "takeTranscriptFetchForSaving")
    .mockResolvedValue(1);
  recordingOn = jest
    .spyOn(IncidentCallRecordingSetting, "isOn")
    .mockResolvedValue(true);
  read = jest
    .spyOn(VideoCallTranscriptReader, "read")
    .mockResolvedValue(
      unavailable(VideoCallTranscriptUnavailableReason.NotReady),
    );
  save = jest.spyOn(IncidentCallTranscriptSave, "save").mockResolvedValue({
    status: CallSummaryStatus.Pending,
    runId: "run-1",
  });
  draftWaiting = jest
    .spyOn(AIIncidentPostmortemRunner, "draftWaitingPostmortem")
    .mockResolvedValue();
  warn = jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
  errorLog = jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function ask(
  call: IncidentVideoCall,
  now: Date,
): Promise<CallTranscriptFetchOutcome> {
  return await IncidentCallTranscriptFetch.fetchOne({ call, now });
}

describe("watching a new call", () => {
  test.each([
    [VideoCallProvider.Zoom, "85746065432"],
    [VideoCallProvider.GoogleMeet, "spaces/jQCFfuBOdN5z"],
  ])(
    "a %s meeting OneUptime created waits, first asked about ten minutes after it started",
    async (provider: VideoCallProvider, meetingId: string) => {
      await IncidentCallTranscriptFetch.watchNewCall({
        id: CALL,
        projectId: PROJECT,
        incidentId: INCIDENT,
        provider,
        videoCallConnectionId: CONNECTION,
        externalMeetingId: meetingId,
        createdAt: STARTED,
      });

      expect(writes).toEqual([
        {
          transcriptFetchStatus: CallTranscriptFetchStatus.Waiting,
          transcriptFetchReason: null,
          transcriptFetchNextAttemptAt: at(10 * MINUTE),
        },
      ]);
    },
  );

  test("a Microsoft Teams meeting OneUptime put on its organizer's calendar waits too", async () => {
    await IncidentCallTranscriptFetch.watchNewCall({
      id: CALL,
      projectId: PROJECT,
      incidentId: INCIDENT,
      provider: VideoCallProvider.MicrosoftTeams,
      videoCallConnectionId: CONNECTION,
      externalMeetingId: "MSpkYzE3Njc0Yy04MWQ5",
      externalCalendarEventId: "AAMkAGI2TG93AAA=",
      createdAt: STARTED,
    });

    expect(writes).toEqual([
      {
        transcriptFetchStatus: CallTranscriptFetchStatus.Waiting,
        transcriptFetchReason: null,
        transcriptFetchNextAttemptAt: at(10 * MINUTE),
      },
    ]);
  });

  test.each([
    [
      "a Microsoft Teams meeting not on a calendar",
      VideoCallProvider.MicrosoftTeams,
      true,
      true,
    ],
    ["a Slack huddle", VideoCallProvider.SlackHuddle, false, true],
    ["a meeting link", VideoCallProvider.CustomLink, false, false],
    ["a Zoom meeting with no connection", VideoCallProvider.Zoom, false, true],
    ["a Zoom meeting with no meeting id", VideoCallProvider.Zoom, true, false],
  ])(
    "%s is not watched: nobody can ask its provider",
    async (
      _name: string,
      provider: VideoCallProvider,
      hasConnection: boolean,
      hasMeetingId: boolean,
    ) => {
      const call: IncidentVideoCall = new IncidentVideoCall();
      call.id = CALL;
      call.projectId = PROJECT;
      call.incidentId = INCIDENT;
      call.provider = provider;
      call.createdAt = STARTED;

      if (hasConnection) {
        call.videoCallConnectionId = CONNECTION;
      }

      if (hasMeetingId) {
        call.externalMeetingId = "m-1";
      }

      await IncidentCallTranscriptFetch.watchNewCall(call);

      expect(writes).toEqual([]);
    },
  );

  test("never throws: the call exists either way", async () => {
    jest
      .spyOn(IncidentVideoCallService, "updateOneById")
      .mockRejectedValue(new Error("database unavailable"));

    await expect(
      IncidentCallTranscriptFetch.watchNewCall({
        id: CALL,
        projectId: PROJECT,
        incidentId: INCIDENT,
        provider: VideoCallProvider.Zoom,
        videoCallConnectionId: CONNECTION,
        externalMeetingId: "1",
        createdAt: STARTED,
      }),
    ).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining("Could not start waiting"),
      expect.objectContaining({ incidentId: INCIDENT.toString() }),
    );
  });
});

describe("a call the provider could not be set up to record", () => {
  test("stops from the start, with why, for its card to say: never asked about", async () => {
    const now: Date = at(MINUTE);

    await IncidentCallTranscriptFetch.markNotRecorded({
      call: { id: CALL, projectId: PROJECT, incidentId: INCIDENT },
      reason: VideoCallTranscriptUnavailableReason.PermissionMissing,
      now,
    });

    expect(writes).toEqual([
      {
        transcriptFetchStatus: CallTranscriptFetchStatus.Stopped,
        transcriptFetchReason:
          VideoCallTranscriptUnavailableReason.PermissionMissing,
        transcriptFetchCheckedAt: now,
        transcriptFetchNextAttemptAt: null,
      },
    ]);
  });

  test("is checked now when no time is given", async () => {
    const before: number = Date.now();

    await IncidentCallTranscriptFetch.markNotRecorded({
      call: { id: CALL, projectId: PROJECT, incidentId: INCIDENT },
      reason: VideoCallTranscriptUnavailableReason.NotSupported,
    });

    const checkedAt: Date = writes[0]![
      "transcriptFetchCheckedAt"
    ] as unknown as Date;
    expect(checkedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(checkedAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  test("a call with no id writes nothing", async () => {
    await IncidentCallTranscriptFetch.markNotRecorded({
      call: { id: null, projectId: PROJECT, incidentId: INCIDENT },
      reason: VideoCallTranscriptUnavailableReason.NotSupported,
    });

    expect(writes).toEqual([]);
  });

  test("never throws: the call exists either way", async () => {
    jest
      .spyOn(IncidentVideoCallService, "updateOneById")
      .mockRejectedValue(new Error("database unavailable"));

    await expect(
      IncidentCallTranscriptFetch.markNotRecorded({
        call: { id: CALL, projectId: PROJECT, incidentId: INCIDENT },
        reason: VideoCallTranscriptUnavailableReason.PermissionMissing,
      }),
    ).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining(
        "Could not record why an incident call is not recorded",
      ),
      expect.objectContaining({
        projectId: PROJECT.toString(),
        incidentId: INCIDENT.toString(),
      }),
    );
  });
});

describe("the calls a run asks about", () => {
  test("only Waiting calls that are due, the longest-due first, as root, at most a run's worth", async () => {
    const find: SpyInstance<typeof IncidentVideoCallService.findBy> = jest
      .spyOn(IncidentVideoCallService, "findBy")
      .mockResolvedValue([]);
    const now: Date = at(HOUR);

    await IncidentCallTranscriptFetch.fetchDue({ now });

    expect(find).toHaveBeenCalledTimes(1);

    const findBy: JSONObject = find.mock.calls[0]![0] as unknown as JSONObject;
    const query: JSONObject = findBy["query"] as JSONObject;

    expect(query["transcriptFetchStatus"]).toBe(
      CallTranscriptFetchStatus.Waiting,
    );
    // A "less than or equal to now" condition on the next attempt.
    expect(JSON.stringify(query["transcriptFetchNextAttemptAt"])).toContain(
      now.toISOString(),
    );
    expect(findBy["sort"]).toEqual({
      transcriptFetchNextAttemptAt: SortOrder.Ascending,
    });
    expect(findBy["limit"]).toBe(MAX_CALL_TRANSCRIPT_FETCHES_PER_RUN);
    expect(findBy["props"]).toEqual({ isRoot: true });
    expect(findBy["select"]).toEqual(
      expect.objectContaining({
        _id: true,
        projectId: true,
        incidentId: true,
        provider: true,
        videoCallConnectionId: true,
        externalMeetingId: true,
        // A Teams call is read only with the calendar event its meeting belongs to.
        externalCalendarEventId: true,
        createdAt: true,
        transcriptAddedAt: true,
        transcriptFetchNextAttemptAt: true,
      }),
    );
  });

  test("asks about each call and counts what came of it; one that fails does not stop the others", async () => {
    const first: IncidentVideoCall = dueCall();
    const second: IncidentVideoCall = dueCall({
      id: new ObjectID("55555555-5555-4555-8555-555555555555"),
    });
    const third: IncidentVideoCall = dueCall({
      id: new ObjectID("66666666-6666-4666-8666-666666666666"),
    });

    jest
      .spyOn(IncidentVideoCallService, "findBy")
      .mockResolvedValue([first, second, third]);
    // The second call's answer cannot even be written down.
    const fetchOne: SpyInstance<typeof IncidentCallTranscriptFetch.fetchOne> =
      jest.spyOn(IncidentCallTranscriptFetch, "fetchOne");
    fetchOne
      .mockResolvedValueOnce(CallTranscriptFetchOutcome.Found)
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce(CallTranscriptFetchOutcome.Waiting);

    const summary: CallTranscriptFetchRunSummary =
      await IncidentCallTranscriptFetch.fetchDue({ now: at(HOUR) });

    expect(fetchOne).toHaveBeenCalledTimes(3);
    expect(
      fetchOne.mock.calls.map((call: Array<unknown>) => {
        return (call[0] as { call: IncidentVideoCall }).call.id;
      }),
    ).toEqual([first.id, second.id, third.id]);
    expect(summary).toEqual({
      asked: 2,
      outcomes: {
        [CallTranscriptFetchOutcome.Found]: 1,
        [CallTranscriptFetchOutcome.Waiting]: 1,
      },
    });
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining("Could not get an incident call's transcript"),
      expect.objectContaining({ incidentId: INCIDENT.toString() }),
    );
  });
});

describe("taking a call before asking", () => {
  test("moves its next attempt on, from the attempt it was due for", async () => {
    const now: Date = at(25 * MINUTE);
    const call: IncidentVideoCall = dueCall({
      transcriptFetchNextAttemptAt: at(20 * MINUTE),
    });

    await ask(call, now);

    expect(claim).toHaveBeenCalledWith({
      callId: CALL,
      dueAt: at(20 * MINUTE),
      nextAttemptAt: new Date(now.getTime() + CALL_TRANSCRIPT_CLAIM_HOLD_IN_MS),
    });
  });

  test("a call another run took is left to it: not asked about, nothing written", async () => {
    claim.mockResolvedValue(0);

    expect(await ask(dueCall(), at(HOUR))).toBe(
      CallTranscriptFetchOutcome.Skipped,
    );
    expect(read).not.toHaveBeenCalled();
    expect(recordingOn).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  test("a call with nothing to be due for is skipped without being taken", async () => {
    const call: IncidentVideoCall = dueCall();
    delete call.transcriptFetchNextAttemptAt;

    expect(await ask(call, at(HOUR))).toBe(CallTranscriptFetchOutcome.Skipped);
    expect(claim).not.toHaveBeenCalled();
  });
});

describe("before asking the provider", () => {
  test("a call that got its transcript some other way stops waiting, without asking", async () => {
    expect(
      await ask(dueCall({ transcriptAddedAt: at(40 * MINUTE) }), at(HOUR)),
    ).toBe(CallTranscriptFetchOutcome.Skipped);
    expect(read).not.toHaveBeenCalled();
    expect(writes).toEqual([
      {
        transcriptFetchStatus: null,
        transcriptFetchReason: null,
        transcriptFetchNextAttemptAt: null,
      },
    ]);
  });

  test("a project that turned Record and transcribe incident calls off stops waiting, without asking", async () => {
    recordingOn.mockResolvedValue(false);

    expect(await ask(dueCall(), at(HOUR))).toBe(
      CallTranscriptFetchOutcome.TurnedOff,
    );
    expect(recordingOn).toHaveBeenCalledWith(PROJECT);
    expect(read).not.toHaveBeenCalled();
    expect(writes).toEqual([
      {
        transcriptFetchStatus: null,
        transcriptFetchReason: null,
        transcriptFetchNextAttemptAt: null,
      },
    ]);
  });

  test("asks with the call's own connection and meeting, for its project, saying when the call started", async () => {
    await ask(dueCall(), at(HOUR));

    expect(read).toHaveBeenCalledWith({
      call: {
        provider: VideoCallProvider.Zoom,
        videoCallConnectionId: CONNECTION,
        externalMeetingId: "85746065432",
        externalCalendarEventId: undefined,
        startedAt: STARTED,
      },
      projectId: PROJECT,
      http: undefined,
    });
  });

  test("a Teams call is asked about with the calendar event its meeting belongs to", async () => {
    await ask(
      dueCall({
        provider: VideoCallProvider.MicrosoftTeams,
        externalMeetingId: "MSpkYzE3Njc0Yy04MWQ5",
        externalCalendarEventId: "AAMkAGI2TG93AAA=",
      }),
      at(HOUR),
    );

    expect(read.mock.calls[0]![0].call).toEqual({
      provider: VideoCallProvider.MicrosoftTeams,
      videoCallConnectionId: CONNECTION,
      externalMeetingId: "MSpkYzE3Njc0Yy04MWQ5",
      externalCalendarEventId: "AAMkAGI2TG93AAA=",
      startedAt: STARTED,
    });
  });
});

describe("what the provider answered", () => {
  test("a transcript: stored as read from the provider, by OneUptime itself, and read by OneUptime AI", async () => {
    read.mockResolvedValue(LINES);
    const now: Date = at(80 * MINUTE);
    const call: IncidentVideoCall = dueCall();

    expect(await ask(call, now)).toBe(CallTranscriptFetchOutcome.Found);

    // Taken for storing - the waiting ends with it - then stored.
    expect(takeForSaving).toHaveBeenCalledWith({
      callId: CALL,
      checkedAt: now,
    });
    expect(writes).toEqual([]);
    expect(save).toHaveBeenCalledTimes(1);

    const saved: Parameters<typeof IncidentCallTranscriptSave.save>[0] =
      save.mock.calls[0]![0];

    expect(saved.call).toBe(call);
    expect(saved.source).toBe(VideoCallTranscriptSource.Provider);
    expect(saved.isAutomatic).toBe(true);
    expect(saved.userId).toBeUndefined();
    expect(saved.prepared.lines).toHaveLength(2);
    expect(saved.prepared.info.speakerCount).toBe(2);
    // Found: the reading lets a waiting postmortem draft go on when it ends.
    expect(draftWaiting).not.toHaveBeenCalled();
  });

  /*
   * A person clicked Get from Zoom, or added the transcript, while the
   * provider answered the job: theirs stands, and nothing is stored, read
   * and posted a second time.
   */
  test("a transcript a person got or added while the provider answered is theirs: nothing stored twice", async () => {
    read.mockResolvedValue(LINES);
    takeForSaving.mockResolvedValue(0);

    expect(await ask(dueCall(), at(80 * MINUTE))).toBe(
      CallTranscriptFetchOutcome.Skipped,
    );
    expect(save).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  test.each([
    [VideoCallTranscriptUnavailableReason.NotReady],
    [VideoCallTranscriptUnavailableReason.NotTranscribed],
    [VideoCallTranscriptUnavailableReason.NoMeeting],
  ])(
    "%s: waits, keeps the answer, and asks again at the call's pace",
    async (reason: VideoCallTranscriptUnavailableReason) => {
      read.mockResolvedValue(unavailable(reason));
      const now: Date = at(30 * MINUTE);

      expect(await ask(dueCall(), now)).toBe(
        CallTranscriptFetchOutcome.Waiting,
      );
      expect(writes).toEqual([
        {
          transcriptFetchStatus: CallTranscriptFetchStatus.Waiting,
          transcriptFetchReason: reason,
          transcriptFetchCheckedAt: now,
          transcriptFetchNextAttemptAt: new Date(now.getTime() + 5 * MINUTE),
        },
      ]);
      expect(save).not.toHaveBeenCalled();
      expect(draftWaiting).not.toHaveBeenCalled();
    },
  );

  test.each([
    [VideoCallTranscriptUnavailableReason.PermissionMissing],
    [VideoCallTranscriptUnavailableReason.ConnectionProblem],
    [VideoCallTranscriptUnavailableReason.Expired],
    [VideoCallTranscriptUnavailableReason.NotSupported],
  ])(
    "%s: stops at once, keeping the answer for the card, and lets a waiting postmortem draft go on",
    async (reason: VideoCallTranscriptUnavailableReason) => {
      read.mockResolvedValue(unavailable(reason));
      const now: Date = at(30 * MINUTE);

      expect(await ask(dueCall(), now)).toBe(
        CallTranscriptFetchOutcome.Stopped,
      );
      expect(writes).toEqual([
        {
          transcriptFetchStatus: CallTranscriptFetchStatus.Stopped,
          transcriptFetchReason: reason,
          transcriptFetchCheckedAt: now,
          transcriptFetchNextAttemptAt: null,
        },
      ]);
      expect(draftWaiting).toHaveBeenCalledWith({ incidentId: INCIDENT });
    },
  );

  test("still nothing when the window is over: stops, keeping the last answer", async () => {
    read.mockResolvedValue(
      unavailable(VideoCallTranscriptUnavailableReason.NotTranscribed),
    );
    const now: Date = at(CALL_TRANSCRIPT_FETCH_WINDOW_MS - HOUR + 1);

    expect(
      await ask(dueCall({ transcriptFetchNextAttemptAt: at(71 * HOUR) }), now),
    ).toBe(CallTranscriptFetchOutcome.Stopped);
    expect(writes[0]).toEqual({
      transcriptFetchStatus: CallTranscriptFetchStatus.Stopped,
      transcriptFetchReason:
        VideoCallTranscriptUnavailableReason.NotTranscribed,
      transcriptFetchCheckedAt: now,
      transcriptFetchNextAttemptAt: null,
    });
    expect(draftWaiting).toHaveBeenCalledWith({ incidentId: INCIDENT });
  });

  test("no answer at all (a timeout, an outage): asks again later, and keeps the answer it had", async () => {
    read.mockRejectedValue(
      new APIException("Zoom could not answer (HTTP 503)."),
    );
    const now: Date = at(3 * HOUR);

    expect(await ask(dueCall(), now)).toBe(CallTranscriptFetchOutcome.Waiting);
    expect(writes).toEqual([
      {
        transcriptFetchStatus: CallTranscriptFetchStatus.Waiting,
        transcriptFetchCheckedAt: now,
        transcriptFetchNextAttemptAt: new Date(now.getTime() + 15 * MINUTE),
      },
    ]);
    expect(writes[0]).not.toHaveProperty("transcriptFetchReason");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("asking again later"),
      expect.objectContaining({ projectId: PROJECT.toString() }),
    );
  });

  test("a transcript with no words in it is nothing to store: stops, as nothing transcribed", async () => {
    read.mockResolvedValue(
      transcriptFound({
        lines: [{ text: "   " }],
        format: TranscriptSourceFormat.WebVTT,
      }),
    );
    const now: Date = at(2 * HOUR);

    expect(await ask(dueCall(), now)).toBe(CallTranscriptFetchOutcome.Stopped);
    expect(save).not.toHaveBeenCalled();
    expect(writes).toEqual([
      {
        transcriptFetchStatus: CallTranscriptFetchStatus.Stopped,
        transcriptFetchReason:
          VideoCallTranscriptUnavailableReason.NotTranscribed,
        transcriptFetchCheckedAt: now,
        transcriptFetchNextAttemptAt: null,
      },
    ]);
    expect(draftWaiting).toHaveBeenCalledWith({ incidentId: INCIDENT });
  });

  test("a waiting postmortem draft that cannot go on is logged, and the answer is still kept", async () => {
    read.mockResolvedValue(
      unavailable(VideoCallTranscriptUnavailableReason.Expired),
    );
    draftWaiting.mockRejectedValue(new Error("model unavailable"));

    expect(await ask(dueCall(), at(HOUR))).toBe(
      CallTranscriptFetchOutcome.Stopped,
    );
    expect(writes).toHaveLength(1);
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining("Could not draft a postmortem"),
      expect.objectContaining({ incidentId: INCIDENT.toString() }),
    );
  });
});

/*
 * A call's whole life, with the job running every five minutes against a
 * store that keeps what it writes: in the call, then Zoom preparing the
 * transcript, then the transcript. OneUptime asks only when a call is due,
 * stores the transcript exactly once, and never asks again after.
 */
describe("a call's whole life, run by run", () => {
  test("waits through the call and Zoom's preparing, then stores the transcript once", async () => {
    const stored: IncidentVideoCall = dueCall();
    // The time of the run in progress.
    let now: Date = STARTED;

    // What the query asks for: Waiting, and due by the run's time.
    jest
      .spyOn(IncidentVideoCallService, "findBy")
      .mockImplementation(async (): Promise<Array<IncidentVideoCall>> => {
        return stored.transcriptFetchStatus ===
          CallTranscriptFetchStatus.Waiting &&
          stored.transcriptFetchNextAttemptAt &&
          stored.transcriptFetchNextAttemptAt.getTime() <= now.getTime()
          ? [Object.assign(new IncidentVideoCall(), stored)]
          : [];
      });
    claim.mockImplementation(
      async (data: { dueAt: Date; nextAttemptAt: Date }): Promise<number> => {
        if (
          stored.transcriptFetchStatus !== CallTranscriptFetchStatus.Waiting ||
          stored.transcriptFetchNextAttemptAt?.getTime() !==
            data.dueAt.getTime()
        ) {
          return 0;
        }

        stored.transcriptFetchNextAttemptAt = data.nextAttemptAt;
        return 1;
      },
    );
    takeForSaving.mockImplementation(async (): Promise<number> => {
      if (
        stored.transcriptFetchStatus !== CallTranscriptFetchStatus.Waiting ||
        stored.transcriptAddedAt
      ) {
        return 0;
      }

      Object.assign(stored, {
        transcriptFetchStatus: null,
        transcriptFetchReason: null,
        transcriptFetchNextAttemptAt: null,
      });
      return 1;
    });
    jest
      .spyOn(IncidentVideoCallService, "updateOneById")
      .mockImplementation(async (data: { data: unknown }): Promise<number> => {
        Object.assign(stored, data.data as JSONObject);
        return 1;
      });
    save.mockImplementation(async () => {
      Object.assign(stored, {
        transcriptAddedAt: new Date(),
        transcriptFetchStatus: null,
        transcriptFetchReason: null,
        transcriptFetchNextAttemptAt: null,
      });
      return { status: CallSummaryStatus.Pending, runId: "run-1" };
    });

    // In the call for 45 minutes; Zoom prepares the transcript for 25 more.
    read.mockImplementation(async (): Promise<VideoCallTranscriptRead> => {
      const elapsed: number = now.getTime() - STARTED.getTime();

      if (elapsed < 45 * MINUTE) {
        return unavailable(VideoCallTranscriptUnavailableReason.NotTranscribed);
      }

      if (elapsed < 70 * MINUTE) {
        return unavailable(VideoCallTranscriptUnavailableReason.NotReady);
      }

      return LINES;
    });

    const outcomes: Array<string> = [];

    // Runs every five minutes for three hours.
    for (let run: number = 0; run <= 36; run++) {
      now = at(run * 5 * MINUTE);

      const summary: CallTranscriptFetchRunSummary =
        await IncidentCallTranscriptFetch.fetchDue({ now });

      for (const [outcome, count] of Object.entries(summary.outcomes)) {
        for (let index: number = 0; index < (count || 0); index++) {
          outcomes.push(`${run * 5}:${outcome}`);
        }
      }
    }

    expect(save).toHaveBeenCalledTimes(1);
    // First asked at ten minutes, then every five until the transcript came.
    expect(outcomes[0]).toBe("10:Waiting");
    expect(outcomes[outcomes.length - 1]).toBe("70:Found");
    expect(outcomes).toHaveLength(13);
    expect(stored.transcriptFetchStatus).toBeNull();
    expect(stored.transcriptAddedAt).toBeInstanceOf(Date);
    expect(read).toHaveBeenCalledTimes(13);
  });
});
