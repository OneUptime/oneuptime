import GoogleMeetTranscriptClient, {
  GOOGLE_MEET_API_BASE_URL,
} from "../../../../../Server/Utils/VideoCall/Transcripts/GoogleMeetTranscriptClient";
import { VideoCallTranscriptRead } from "../../../../../Server/Utils/VideoCall/Transcripts/VideoCallTranscriptRead";
import VideoCallHttpClient from "../../../../../Server/Utils/VideoCall/VideoCallHttpClient";
import APIException from "../../../../../Types/Exception/ApiException";
import { JSONObject } from "../../../../../Types/JSON";
import { VideoCallTranscriptUnavailableReason } from "../../../../../Types/VideoCall/VideoCallTranscript";
import { TranscriptLine } from "../../../../../Utils/VideoCall/TranscriptText";
import {
  ScriptedFetch,
  ScriptedResponse,
  scriptedFetch,
} from "../VideoCallTestFetch";
import { describe, expect, test } from "@jest/globals";

/*
 * Reading a Google Meet space's transcript through the Meet REST API, with
 * responses in the shapes Google answers with: the conferences held in the
 * space, each conference's transcripts and participants, and each
 * transcript's entries, page by page. And, when there is nothing to read,
 * why: nobody met, nobody turned transcription on, it is still running or
 * being prepared, or Google no longer keeps it.
 */

const SPACE: string = "spaces/jQCFfuBOdN5z";
const CONFERENCE: string = "conferenceRecords/abc-123";
const TRANSCRIPT: string = `${CONFERENCE}/transcripts/t-1`;
const NOW: Date = new Date("2026-10-17T16:00:00.000Z");

function conferences(records: Array<JSONObject>): ScriptedResponse {
  return { status: 200, body: { conferenceRecords: records } };
}

const CONFERENCE_RECORD: JSONObject = {
  name: CONFERENCE,
  startTime: "2026-10-17T14:05:00.000Z",
  endTime: "2026-10-17T14:57:00.000Z",
  expireTime: "2026-11-16T14:57:00.000Z",
  space: SPACE,
};

function transcripts(states: Array<string>, conference: string = CONFERENCE): ScriptedResponse {
  return {
    status: 200,
    body: {
      transcripts: states.map((state: string, index: number) => {
        return {
          name: `${conference}/transcripts/t-${index + 1}`,
          state,
          startTime: "2026-10-17T14:05:30.000Z",
          endTime: "2026-10-17T14:56:00.000Z",
          docsDestination: {
            document: "1AbCdEf",
            exportUri: "https://docs.google.com/document/d/1AbCdEf",
          },
        };
      }),
    },
  };
}

const PARTICIPANTS: ScriptedResponse = {
  status: 200,
  body: {
    participants: [
      {
        name: `${CONFERENCE}/participants/p-1`,
        earliestStartTime: "2026-10-17T14:05:00.000Z",
        signedinUser: { user: "users/123", displayName: "Priya Shah" },
      },
      {
        name: `${CONFERENCE}/participants/p-2`,
        anonymousUser: { displayName: "Guest Sam" },
      },
      {
        name: `${CONFERENCE}/participants/p-3`,
        phoneUser: { displayName: "+1 555-***-**12" },
      },
    ],
  },
};

let entryCount: number = 0;

function entry(participant: string, text: string, startTime: string): JSONObject {
  entryCount++;

  return {
    name: `${TRANSCRIPT}/entries/e-${entryCount}`,
    participant: `${CONFERENCE}/participants/${participant}`,
    text,
    languageCode: "en-US",
    startTime,
    endTime: startTime,
  };
}

async function read(
  responses: Array<ScriptedResponse>,
  overrides?: Partial<{ isSignIn: boolean; spaceName: string; now: Date }>,
): Promise<{ result: VideoCallTranscriptRead; fetcher: ScriptedFetch }> {
  const fetcher: ScriptedFetch = scriptedFetch(responses);
  const result: VideoCallTranscriptRead =
    await GoogleMeetTranscriptClient.readTranscript({
      http: new VideoCallHttpClient({ fetchImplementation: fetcher.fetch }),
      accessToken: "google-access-token",
      spaceName: overrides?.spaceName ?? SPACE,
      isSignIn: overrides?.isSignIn ?? false,
      ownerLabel: "incidents@acme.com",
      now: overrides?.now ?? NOW,
    });

  return { result, fetcher };
}

function linesOf(result: VideoCallTranscriptRead): Array<TranscriptLine> {
  expect(result.found).toBe(true);
  return result.found ? result.lines : [];
}

function unavailable(result: VideoCallTranscriptRead): {
  reason: VideoCallTranscriptUnavailableReason;
  message: string;
} {
  expect(result.found).toBe(false);
  return result.found
    ? { reason: VideoCallTranscriptUnavailableReason.NotSupported, message: "" }
    : result.unavailable;
}

describe("GoogleMeetTranscriptClient - reading the transcript", () => {
  test("lists the space's conferences, their transcripts, participants and entries, page by page", async () => {
    const { result, fetcher } = await read([
      conferences([CONFERENCE_RECORD]),
      transcripts(["FILE_GENERATED"]),
      PARTICIPANTS,
      {
        status: 200,
        body: {
          transcriptEntries: [
            entry("p-1", "Checkout is down.", "2026-10-17T14:05:10.000Z"),
            entry("p-2", "The pool is full.", "2026-10-17T14:17:03.000Z"),
          ],
          nextPageToken: "page-2",
        },
      },
      {
        status: 200,
        body: {
          transcriptEntries: [
            entry("p-3", "Calling in from the car.", "2026-10-17T14:20:00.000Z"),
            entry("p-9", "Someone who left before the list was read.", "2026-10-17T14:21:00.000Z"),
          ],
        },
      },
    ]);

    expect(linesOf(result)).toEqual([
      { offsetInSeconds: 10, speaker: "Priya Shah", text: "Checkout is down." },
      { offsetInSeconds: 723, speaker: "Guest Sam", text: "The pool is full." },
      {
        offsetInSeconds: 900,
        speaker: "+1 555-***-**12",
        text: "Calling in from the car.",
      },
      { offsetInSeconds: 960, text: "Someone who left before the list was read." },
    ]);

    const urls: Array<URL> = fetcher.requests.map((request: { url: string }) => {
      return new URL(request.url);
    });

    expect(urls[0]!.origin + urls[0]!.pathname).toBe(
      `${GOOGLE_MEET_API_BASE_URL}/conferenceRecords`,
    );
    expect(urls[0]!.searchParams.get("filter")).toBe(`space.name = "${SPACE}"`);
    expect(urls[1]!.pathname).toBe(`/v2/${CONFERENCE}/transcripts`);
    expect(urls[2]!.pathname).toBe(`/v2/${CONFERENCE}/participants`);
    expect(urls[2]!.searchParams.get("pageSize")).toBe("250");
    expect(urls[3]!.pathname).toBe(`/v2/${TRANSCRIPT}/entries`);
    expect(urls[3]!.searchParams.get("pageSize")).toBe("100");
    expect(urls[3]!.searchParams.get("pageToken")).toBeNull();
    expect(urls[4]!.searchParams.get("pageToken")).toBe("page-2");

    for (const request of fetcher.requests) {
      expect(request.init.method).toBe("GET");
      expect(request.init.headers["Authorization"]).toBe(
        "Bearer google-access-token",
      );
    }
  });

  test("two conferences in the space: one transcript, timed from the first", async () => {
    const second: string = "conferenceRecords/def-456";
    const { result } = await read([
      conferences([
        {
          ...CONFERENCE_RECORD,
          name: second,
          startTime: "2026-10-17T15:00:00.000Z",
          endTime: "2026-10-17T15:10:00.000Z",
        },
        CONFERENCE_RECORD,
      ]),
      transcripts(["ENDED"]),
      PARTICIPANTS,
      {
        status: 200,
        body: {
          transcriptEntries: [
            entry("p-1", "First call.", "2026-10-17T14:06:00.000Z"),
          ],
        },
      },
      transcripts(["FILE_GENERATED"], second),
      {
        status: 200,
        body: {
          participants: [
            {
              name: `${second}/participants/p-1`,
              signedinUser: { displayName: "Sam Lee" },
            },
          ],
        },
      },
      {
        status: 200,
        body: {
          transcriptEntries: [
            {
              participant: `${second}/participants/p-1`,
              text: "Back after the rollback.",
              startTime: "2026-10-17T15:01:00.000Z",
            },
          ],
        },
      },
    ]);

    expect(linesOf(result)).toEqual([
      { offsetInSeconds: 60, speaker: "Priya Shah", text: "First call." },
      { offsetInSeconds: 3360, speaker: "Sam Lee", text: "Back after the rollback." },
    ]);
  });

  test("a transcript still running is skipped while a finished one is read", async () => {
    const { result, fetcher } = await read([
      conferences([CONFERENCE_RECORD]),
      transcripts(["STARTED", "FILE_GENERATED"]),
      PARTICIPANTS,
      {
        status: 200,
        body: {
          transcriptEntries: [entry("p-1", "Finished part.", "2026-10-17T14:05:10.000Z")],
        },
      },
    ]);

    expect(linesOf(result)).toHaveLength(1);
    expect(fetcher.requests[3]!.url).toContain("/transcripts/t-2/entries");
  });
});

describe("GoogleMeetTranscriptClient - when there is nothing to read", () => {
  test("nobody has met in the space yet", async () => {
    const { result } = await read([conferences([])]);

    expect(unavailable(result)).toEqual({
      reason: VideoCallTranscriptUnavailableReason.NoMeeting,
      message: expect.stringMatching(/Nobody has met in this Google Meet yet/),
    });
  });

  test("nobody turned on transcription: says how, and that a person can add it", async () => {
    const { result } = await read([
      conferences([CONFERENCE_RECORD]),
      transcripts([]),
    ]);

    expect(unavailable(result)).toEqual({
      reason: VideoCallTranscriptUnavailableReason.NotTranscribed,
      message: expect.stringMatching(
        /Turn on Transcripts in the call \(Activities > Transcripts\).*transcribe meetings by default/,
      ),
    });
  });

  test("transcription is still running", async () => {
    const { result } = await read([
      conferences([CONFERENCE_RECORD]),
      transcripts(["STARTED"]),
    ]);

    expect(unavailable(result)).toEqual({
      reason: VideoCallTranscriptUnavailableReason.NotReady,
      message: expect.stringMatching(/still running/),
    });
  });

  test("a finished transcript with no entries yet is still being prepared", async () => {
    const { result } = await read([
      conferences([CONFERENCE_RECORD]),
      transcripts(["ENDED"]),
      PARTICIPANTS,
      { status: 200, body: {} },
    ]);

    expect(unavailable(result)).toEqual({
      reason: VideoCallTranscriptUnavailableReason.NotReady,
      message: expect.stringMatching(/still preparing/),
    });
  });

  test("a call that ended more than 30 days ago: Google no longer keeps its entries", async () => {
    const { result } = await read(
      [
        conferences([CONFERENCE_RECORD]),
        transcripts(["FILE_GENERATED"]),
        PARTICIPANTS,
        { status: 200, body: { transcriptEntries: [] } },
      ],
      { now: new Date("2026-11-30T00:00:00.000Z") },
    );

    expect(unavailable(result)).toEqual({
      reason: VideoCallTranscriptUnavailableReason.Expired,
      message: expect.stringMatching(/for 30 days after it ends.*organizer's Google Drive/),
    });
  });

  test("a space name that is not one: no request", async () => {
    const { result, fetcher } = await read([], { spaceName: 'spaces/a" OR "1' });

    expect(unavailable(result).reason).toBe(
      VideoCallTranscriptUnavailableReason.NotSupported,
    );
    expect(fetcher.requests).toHaveLength(0);
  });
});

describe("GoogleMeetTranscriptClient - Google refusing", () => {
  test("the Meet API not enabled for the service account's project: says where to enable it", async () => {
    const { result } = await read([
      {
        status: 403,
        body: {
          error: {
            code: 403,
            message: "Google Meet REST API has not been used in project 1234 before or it is disabled.",
            status: "PERMISSION_DENIED",
            details: [{ reason: "SERVICE_DISABLED" }],
          },
        },
      },
    ]);

    expect(unavailable(result)).toEqual({
      reason: VideoCallTranscriptUnavailableReason.PermissionMissing,
      message: expect.stringMatching(/service account's Google Cloud project/),
    });
  });

  test("the Meet API not enabled for this server's Google app: the server administrator's to fix", async () => {
    const { result } = await read(
      [{ status: 403, body: "SERVICE_DISABLED" }],
      { isSignIn: true },
    );

    expect(unavailable(result).message).toMatch(/Ask your server administrator/);
  });

  test("a sign-in Google no longer accepts: reconnect", async () => {
    const { result } = await read(
      [
        {
          status: 401,
          body: { error: { code: 401, message: "Request had invalid authentication credentials.", status: "UNAUTHENTICATED" } },
        },
      ],
      { isSignIn: true },
    );

    expect(unavailable(result)).toEqual({
      reason: VideoCallTranscriptUnavailableReason.ConnectionProblem,
      message: expect.stringMatching(/Reconnect Google Meet/),
    });
  });

  test("not allowed to read this space", async () => {
    const { result } = await read([
      conferences([CONFERENCE_RECORD]),
      {
        status: 403,
        body: { error: { code: 403, message: "The caller does not have permission", status: "PERMISSION_DENIED" } },
      },
    ]);

    expect(unavailable(result).reason).toBe(
      VideoCallTranscriptUnavailableReason.PermissionMissing,
    );
  });

  test("the space is gone", async () => {
    const { result } = await read([
      { status: 404, body: { error: { code: 404, message: "Requested entity was not found.", status: "NOT_FOUND" } } },
    ]);

    expect(unavailable(result).reason).toBe(
      VideoCallTranscriptUnavailableReason.NoMeeting,
    );
  });

  test("a rate limit or a server error throws", async () => {
    for (const status of [429, 500]) {
      let thrown: unknown = null;

      try {
        await read([{ status, body: { error: { code: status, message: "busy" } } }]);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(APIException);
    }
  });
});
