import { MicrosoftTeamsMeetingOrganizer } from "../../../../../Server/Utils/VideoCall/Providers/MicrosoftTeamsMeetingClient";
import MicrosoftTeamsTranscriptClient, {
  GRAPH_SPEAKER_ATTRIBUTION_NOT_ALLOWED_CODE,
  GRAPH_TRANSCRIPTS_DISABLED_CODE,
  MICROSOFT_TEAMS_MEETING_RETENTION_IN_DAYS,
  MICROSOFT_TEAMS_TRANSCRIPT_CONTENT_TYPE,
  MICROSOFT_TEAMS_UNATTRIBUTED_TRANSCRIPT_CONTENT_TYPE,
  MicrosoftTeamsTranscriptRequest,
} from "../../../../../Server/Utils/VideoCall/Transcripts/MicrosoftTeamsTranscriptClient";
import { VideoCallTranscriptRead } from "../../../../../Server/Utils/VideoCall/Transcripts/VideoCallTranscriptRead";
import VideoCallHttpClient from "../../../../../Server/Utils/VideoCall/VideoCallHttpClient";
import APIException from "../../../../../Types/Exception/ApiException";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import {
  MAX_VIDEO_CALL_TRANSCRIPT_INPUT_CHARACTERS,
  VideoCallTranscriptUnavailableReason,
} from "../../../../../Types/VideoCall/VideoCallTranscript";
import {
  TranscriptLine,
  TranscriptSourceFormat,
} from "../../../../../Utils/VideoCall/TranscriptText";
import {
  ScriptedFetch,
  ScriptedResponse,
  scriptedFetch,
} from "../VideoCallTestFetch";
import { describe, expect, test } from "@jest/globals";

/*
 * The transcript of a Microsoft Teams meeting OneUptime put on its
 * organizer's calendar, read through Microsoft Graph: every transcription
 * of the call, in order, each a WebVTT file whose voice spans name the
 * speakers - and, when Graph says no, an answer that says what to fix.
 */

const ORGANIZER_ID: string = "99999999-8888-7777-6666-555555555555";
const CLIENT_ID: string = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

// A Graph meeting id is base64: its "=" is sent encoded.
const MEETING_ID: string =
  "MSo1N2Y5ZGFjYy03MWJmLTQ3NDMtYjQxMy01M2EdFGkdRWHJlQ==";
const ENCODED_MEETING_ID: string =
  "MSo1N2Y5ZGFjYy03MWJmLTQ3NDMtYjQxMy01M2EdFGkdRWHJlQ%3D%3D";

const APP_ORGANIZER: MicrosoftTeamsMeetingOrganizer = {
  path: `/users/${ORGANIZER_ID}`,
  label: ORGANIZER_ID,
  isSignIn: false,
  clientId: CLIENT_ID,
};

const SIGNED_IN_ORGANIZER: MicrosoftTeamsMeetingOrganizer = {
  path: "/me",
  label: "incidents@acme.com",
  isSignIn: true,
};

// Microsoft Graph of the commercial cloud, where no MICROSOFT_TEAMS_CLOUD is set.
const MICROSOFT_GRAPH_BASE_URL: string = "https://graph.microsoft.com/v1.0";
const MEETING_URL: string = `${MICROSOFT_GRAPH_BASE_URL}/users/${ORGANIZER_ID}/onlineMeetings/${ENCODED_MEETING_ID}`;

const FIRST_TRANSCRIPT: JSONObject = {
  id: "MSMjMCMjZDAwYWU3NjUtNmM2Yi00NjQxLTgwMWQtMTkzMmFmMjEzNzdh",
  meetingId: MEETING_ID,
  createdDateTime: "2026-10-19T08:30:00.0000000Z",
  endDateTime: "2026-10-19T09:05:00.0000000Z",
};

const SECOND_TRANSCRIPT: JSONObject = {
  id: "MSMjMCMjMzAxNjNhYTctNWRmZi00MjM3LTg5MGQtNWJhYWZjZTZhNWYw",
  meetingId: MEETING_ID,
  // Transcription turned on again ten minutes into the call.
  createdDateTime: "2026-10-19T08:40:00.0000000Z",
  endDateTime: "2026-10-19T09:05:00.0000000Z",
};

const FIRST_VTT: string = [
  "WEBVTT",
  "",
  "0f2b3e8c-1234-4a56-8b9c-0d1e2f3a4b5c/17-0",
  "00:00:03.120 --> 00:00:05.480",
  "<v Priya Shah>We rolled back the deploy at 14:02.</v>",
  "",
  "0f2b3e8c-1234-4a56-8b9c-0d1e2f3a4b5c/18-0",
  "00:00:06.000 --> 00:00:09.250",
  "<v Marco Rossi>The error rate is back under one percent.</v>",
  "",
].join("\n");

const SECOND_VTT: string = [
  "WEBVTT",
  "",
  "8a1d0c2e-9f8e-4d7c-b6a5-4f3e2d1c0b9a/1-0",
  "00:00:02.000 --> 00:00:04.000",
  "<v Priya Shah>The connection pool ran out first.</v>",
  "",
].join("\n");

const FIRST_LINES: Array<TranscriptLine> = [
  {
    offsetInSeconds: 3.12,
    speaker: "Priya Shah",
    text: "We rolled back the deploy at 14:02.",
  },
  {
    offsetInSeconds: 6,
    speaker: "Marco Rossi",
    text: "The error rate is back under one percent.",
  },
];

function listOf(
  transcripts: Array<JSONObject>,
  nextLink?: string,
): ScriptedResponse {
  return {
    status: 200,
    body: {
      "@odata.context": `${MICROSOFT_GRAPH_BASE_URL}/$metadata#users('${ORGANIZER_ID}')/onlineMeetings('${MEETING_ID}')/transcripts`,
      value: transcripts,
      ...(nextLink ? { "@odata.nextLink": nextLink } : {}),
    },
  };
}

function contentOf(text: string): ScriptedResponse {
  return { status: 200, body: text };
}

function graphError(data: {
  status: number;
  code?: string;
  message: string;
  innerCode?: string;
  innerKey?: string;
}): ScriptedResponse {
  return {
    status: data.status,
    body: {
      error: {
        code: data.code || "Forbidden",
        message: data.message,
        ...(data.innerCode
          ? { [data.innerKey || "innerError"]: { code: data.innerCode } }
          : {}),
      },
    },
  };
}

async function read(
  responses: Array<ScriptedResponse>,
  overrides: Partial<MicrosoftTeamsTranscriptRequest> = {},
): Promise<{ result: VideoCallTranscriptRead; fetcher: ScriptedFetch }> {
  const fetcher: ScriptedFetch = scriptedFetch(responses);

  const result: VideoCallTranscriptRead =
    await MicrosoftTeamsTranscriptClient.readTranscript({
      http: new VideoCallHttpClient({ fetchImplementation: fetcher.fetch }),
      accessToken: "graph-access-token",
      organizer: APP_ORGANIZER,
      meetingId: MEETING_ID,
      ...overrides,
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

describe("MicrosoftTeamsTranscriptClient - reading a meeting's transcript", () => {
  test("lists the meeting's transcripts as its organizer, then reads each as WebVTT, speakers and all", async () => {
    const { result, fetcher } = await read([
      listOf([FIRST_TRANSCRIPT]),
      contentOf(FIRST_VTT),
    ]);

    expect(fetcher.requests).toHaveLength(2);

    const list: (typeof fetcher.requests)[number] = fetcher.requests[0]!;
    expect(list.url).toBe(`${MEETING_URL}/transcripts`);
    expect(list.init.method).toBe("GET");
    expect(list.init.headers).toEqual({
      Authorization: "Bearer graph-access-token",
      Accept: "application/json",
    });

    const content: (typeof fetcher.requests)[number] = fetcher.requests[1]!;
    expect(content.url).toBe(
      `${MEETING_URL}/transcripts/${encodeURIComponent(FIRST_TRANSCRIPT["id"] as string)}/content`,
    );
    expect(content.init.headers).toEqual({
      Authorization: "Bearer graph-access-token",
      Accept: MICROSOFT_TEAMS_TRANSCRIPT_CONTENT_TYPE,
    });

    expect(result).toEqual({
      found: true,
      format: TranscriptSourceFormat.WebVTT,
      lines: FIRST_LINES,
    });
  });

  test("a signed-in organizer's meeting is read as /me", async () => {
    const { fetcher } = await read(
      [listOf([FIRST_TRANSCRIPT]), contentOf(FIRST_VTT)],
      { organizer: SIGNED_IN_ORGANIZER },
    );

    expect(fetcher.requests[0]!.url).toBe(
      `${MICROSOFT_GRAPH_BASE_URL}/me/onlineMeetings/${ENCODED_MEETING_ID}/transcripts`,
    );
    const signedInMeetings: string = `${MICROSOFT_GRAPH_BASE_URL}/me/onlineMeetings/`;
    expect(fetcher.requests[1]!.url.slice(0, signedInMeetings.length)).toBe(
      signedInMeetings,
    );
  });

  test("several transcriptions of one call: in the order they began, each later one placed where it began", async () => {
    // Graph lists the later one first: the order is the transcripts' own.
    const { result, fetcher } = await read([
      listOf([SECOND_TRANSCRIPT, FIRST_TRANSCRIPT]),
      contentOf(FIRST_VTT),
      contentOf(SECOND_VTT),
    ]);

    expect(fetcher.requests[1]!.url).toContain(
      encodeURIComponent(FIRST_TRANSCRIPT["id"] as string),
    );
    expect(fetcher.requests[2]!.url).toContain(
      encodeURIComponent(SECOND_TRANSCRIPT["id"] as string),
    );

    expect(linesOf(result)).toEqual([
      ...FIRST_LINES,
      {
        // Two seconds into a transcription that began ten minutes in.
        offsetInSeconds: 602,
        speaker: "Priya Shah",
        text: "The connection pool ran out first.",
      },
    ]);
  });

  test("a transcript without a start time is read where it is listed, unmoved", async () => {
    const { result } = await read([
      listOf([FIRST_TRANSCRIPT, { id: "no-start" }]),
      contentOf(FIRST_VTT),
      contentOf(SECOND_VTT),
    ]);

    expect(linesOf(result)[2]).toEqual({
      offsetInSeconds: 2,
      speaker: "Priya Shah",
      text: "The connection pool ran out first.",
    });
  });

  test("follows Graph's next page of transcripts", async () => {
    const nextPage: string = `${MEETING_URL}/transcripts?$skiptoken=abc123`;
    const { result, fetcher } = await read([
      listOf([FIRST_TRANSCRIPT], nextPage),
      listOf([SECOND_TRANSCRIPT]),
      contentOf(FIRST_VTT),
      contentOf(SECOND_VTT),
    ]);

    expect(fetcher.requests[1]!.url).toBe(nextPage);
    expect(fetcher.requests[1]!.init.headers["Authorization"]).toBe(
      "Bearer graph-access-token",
    );
    expect(linesOf(result)).toHaveLength(3);
  });

  test("never follows a next page off Graph: the token goes nowhere else", async () => {
    const { result, fetcher } = await read([
      listOf([FIRST_TRANSCRIPT], "https://graph.evil.example/v1.0/steal"),
      contentOf(FIRST_VTT),
    ]);

    expect(
      fetcher.requests.map((request: { url: string }): string => {
        return request.url;
      }),
    ).not.toContain("https://graph.evil.example/v1.0/steal");
    expect(linesOf(result)).toEqual(FIRST_LINES);
  });

  test("skips list items that are not transcripts", async () => {
    const { result, fetcher } = await read([
      {
        status: 200,
        body: {
          value: [
            null,
            "text",
            [],
            { meetingId: MEETING_ID },
            FIRST_TRANSCRIPT,
          ],
        },
      },
      contentOf(FIRST_VTT),
    ]);

    expect(fetcher.requests).toHaveLength(2);
    expect(linesOf(result)).toEqual(FIRST_LINES);
  });

  test("an organization that keeps who said what from apps: the words are read again without their speakers", async () => {
    const { result, fetcher } = await read([
      listOf([FIRST_TRANSCRIPT]),
      graphError({
        status: 403,
        message:
          "Speaker-attributed transcript content is disabled for this tenant. Retry with Accept 'application/vnd.microsoft.graph.transcript+text'.",
        innerCode: GRAPH_SPEAKER_ATTRIBUTION_NOT_ALLOWED_CODE,
      }),
      contentOf(
        [
          "00:00:03.120 --> 00:00:05.480",
          "We rolled back the deploy at 14:02.",
          "",
        ].join("\n"),
      ),
    ]);

    expect(fetcher.requests).toHaveLength(3);
    expect(fetcher.requests[1]!.init.headers["Accept"]).toBe(
      MICROSOFT_TEAMS_TRANSCRIPT_CONTENT_TYPE,
    );
    expect(fetcher.requests[2]!.url).toBe(fetcher.requests[1]!.url);
    expect(fetcher.requests[2]!.init.headers["Accept"]).toBe(
      MICROSOFT_TEAMS_UNATTRIBUTED_TRANSCRIPT_CONTENT_TYPE,
    );
    expect(linesOf(result)).toEqual([
      { offsetInSeconds: 3.12, text: "We rolled back the deploy at 14:02." },
    ]);
  });

  test("words said before the transcription began are placed at the start of the call", async () => {
    const { result } = await read([
      listOf([FIRST_TRANSCRIPT]),
      contentOf(
        [
          "WEBVTT",
          "",
          "-00:00:01.500 --> 00:00:02.000",
          "<v Priya Shah>...so that is the plan.</v>",
          "",
          "00:00:03.120 --> 00:00:05.480",
          "<v Marco Rossi>Agreed.</v>",
          "",
        ].join("\n"),
      ),
    ]);

    expect(linesOf(result)).toEqual([
      {
        offsetInSeconds: 0,
        speaker: "Priya Shah",
        text: "...so that is the plan.",
      },
      { offsetInSeconds: 3.12, speaker: "Marco Rossi", text: "Agreed." },
    ]);
  });
});

describe("MicrosoftTeamsTranscriptClient - negative cue times", () => {
  test("clamps a negative start, a negative end, or both, to the start of the call", () => {
    expect(
      MicrosoftTeamsTranscriptClient.clampNegativeCueTimes(
        [
          "WEBVTT",
          "-00:00:01.500 --> 00:00:02.000",
          "-00:00:03.000 --> -00:00:01.000",
          "00:00:04.000 --> 00:00:05.000",
        ].join("\n"),
      ),
    ).toBe(
      [
        "WEBVTT",
        "00:00:00.000 --> 00:00:02.000",
        "00:00:00.000 --> 00:00:00.000",
        "00:00:04.000 --> 00:00:05.000",
      ].join("\n"),
    );
  });

  test("keeps a cue's settings, and leaves every other line as it was", () => {
    const text: string = [
      "-00:00:01.500 --> 00:00:02.000 align:start line:0",
      "<v Priya Shah>A caption that mentions --> an arrow.</v>",
      "NOTE -- not a cue",
    ].join("\n");

    expect(MicrosoftTeamsTranscriptClient.clampNegativeCueTimes(text)).toBe(
      [
        "00:00:00.000 --> 00:00:02.000 align:start line:0",
        "<v Priya Shah>A caption that mentions --> an arrow.</v>",
        "NOTE -- not a cue",
      ].join("\n"),
    );
  });
});

describe("MicrosoftTeamsTranscriptClient - when there is no transcript to read", () => {
  test("none yet: the job asks again, and a person is told to try later", async () => {
    const { result, fetcher } = await read([listOf([])]);

    expect(unavailable(result)).toEqual({
      reason: VideoCallTranscriptUnavailableReason.NotTranscribed,
      message: expect.stringMatching(/no transcript of this meeting yet/),
    });
    expect(fetcher.requests).toHaveLength(1);
  });

  test("a transcript Teams is still preparing: NotReady", async () => {
    const { result } = await read([
      listOf([FIRST_TRANSCRIPT]),
      graphError({
        status: 404,
        code: "NotFound",
        message: "The transcript content is not available yet.",
      }),
    ]);

    expect(unavailable(result)).toEqual({
      reason: VideoCallTranscriptUnavailableReason.NotReady,
      message: expect.stringMatching(/still preparing/),
    });
  });

  test("a transcript with no words in it: NotTranscribed", async () => {
    const { result } = await read([
      listOf([FIRST_TRANSCRIPT]),
      contentOf("WEBVTT\n\n"),
    ]);

    expect(unavailable(result)).toEqual({
      reason: VideoCallTranscriptUnavailableReason.NotTranscribed,
      message: expect.stringMatching(/has no words in it/),
    });
  });

  test("a call longer than a transcript can hold is refused, not cut", async () => {
    const half: string = `WEBVTT\n\n${"x".repeat(
      Math.ceil(MAX_VIDEO_CALL_TRANSCRIPT_INPUT_CHARACTERS / 2) + 10,
    )}`;

    await expect(
      read([
        listOf([FIRST_TRANSCRIPT, SECOND_TRANSCRIPT]),
        contentOf(half),
        contentOf(half),
      ]),
    ).rejects.toThrow(BadDataException);
  });

  test("no meeting id: nothing to ask Graph about", async () => {
    const { result, fetcher } = await read([], { meetingId: "   " });

    expect(unavailable(result)).toEqual({
      reason: VideoCallTranscriptUnavailableReason.NotSupported,
      message: expect.stringMatching(
        /no Microsoft Teams meeting for this call/,
      ),
    });
    expect(fetcher.requests).toHaveLength(0);
  });
});

describe("MicrosoftTeamsTranscriptClient - when Graph says no", () => {
  test("an organization that turned apps' access to transcripts off: say so, and how to add it by hand", async () => {
    for (const innerKey of ["innerError", "innererror"]) {
      const { result } = await read([
        graphError({
          status: 403,
          message:
            "Graph API access to transcripts is disabled for this tenant.",
          innerCode: GRAPH_TRANSCRIPTS_DISABLED_CODE,
          innerKey,
        }),
      ]);

      expect(unavailable(result)).toEqual({
        reason: VideoCallTranscriptUnavailableReason.PermissionMissing,
        message: expect.stringMatching(
          /administrator turned off apps' access to meeting transcripts.*download the transcript as a \.vtt file/,
        ),
      });
    }
  });

  test("the same when only the transcript's words are refused", async () => {
    const { result } = await read([
      listOf([FIRST_TRANSCRIPT]),
      graphError({
        status: 403,
        message: "Graph API access to transcripts is disabled for this tenant.",
        innerCode: GRAPH_TRANSCRIPTS_DISABLED_CODE,
      }),
    ]);

    expect(unavailable(result).reason).toBe(
      VideoCallTranscriptUnavailableReason.PermissionMissing,
    );
  });

  test("an app registration without the transcript permission: the permission to add", async () => {
    const { result } = await read([
      graphError({
        status: 403,
        message: "Insufficient privileges to complete the operation.",
      }),
    ]);

    expect(unavailable(result)).toEqual({
      reason: VideoCallTranscriptUnavailableReason.PermissionMissing,
      message: expect.stringMatching(
        /OnlineMeetingTranscript\.Read\.All application permission.*grant admin consent.*Insufficient privileges/,
      ),
    });
  });

  test("an app whose access policy does not cover the organizer: the PowerShell that fixes it", async () => {
    const { result } = await read([
      graphError({
        status: 403,
        message: "No application access policy found for this app.",
      }),
    ]);

    expect(unavailable(result)).toEqual({
      reason: VideoCallTranscriptUnavailableReason.PermissionMissing,
      message: expect.stringContaining(
        `Grant-CsApplicationAccessPolicy -PolicyName OneUptime-Meetings -Identity "${ORGANIZER_ID}"`,
      ),
    });
  });

  test("a sign-in without the transcript permission: Reconnect, with an administrator's approval", async () => {
    const { result } = await read(
      [
        graphError({
          status: 403,
          message: "Insufficient privileges to complete the operation.",
        }),
      ],
      { organizer: SIGNED_IN_ORGANIZER },
    );

    expect(unavailable(result)).toEqual({
      reason: VideoCallTranscriptUnavailableReason.PermissionMissing,
      message: expect.stringMatching(
        /Reconnect Microsoft Teams.*Record and transcribe incident calls is on.*Microsoft 365 administrator approve/,
      ),
    });
  });

  test("a sign-in never granted transcripts is told so without asking Graph", async () => {
    const { result, fetcher } = await read([], {
      organizer: SIGNED_IN_ORGANIZER,
      grantedScope:
        "openid profile email https://graph.microsoft.com/OnlineMeetings.ReadWrite",
    });

    expect(unavailable(result)).toEqual({
      reason: VideoCallTranscriptUnavailableReason.PermissionMissing,
      message: expect.stringMatching(/Reconnect Microsoft Teams/),
    });
    expect(fetcher.requests).toHaveLength(0);
  });

  test("a sign-in granted transcripts asks, whichever way Microsoft wrote the scope", async () => {
    for (const grantedScope of [
      "OnlineMeetings.ReadWrite OnlineMeetingTranscript.Read.All Calendars.ReadWrite",
      "https://graph.microsoft.com/onlinemeetingtranscript.read.all",
    ]) {
      const { result, fetcher } = await read(
        [listOf([FIRST_TRANSCRIPT]), contentOf(FIRST_VTT)],
        { organizer: SIGNED_IN_ORGANIZER, grantedScope },
      );

      expect(fetcher.requests).toHaveLength(2);
      expect(linesOf(result)).toEqual(FIRST_LINES);
    }
  });

  test("an app registration's scope is never checked: Graph answers for it", async () => {
    const { fetcher } = await read(
      [listOf([FIRST_TRANSCRIPT]), contentOf(FIRST_VTT)],
      { grantedScope: "OnlineMeetings.ReadWrite.All" },
    );

    expect(fetcher.requests).toHaveLength(2);
  });

  test("a token Graph refuses is the connection's problem", async () => {
    const signIn: { result: VideoCallTranscriptRead } = await read(
      [
        graphError({
          status: 401,
          code: "InvalidAuthenticationToken",
          message: "Access token has expired or is not yet valid.",
        }),
      ],
      { organizer: SIGNED_IN_ORGANIZER },
    );

    expect(unavailable(signIn.result)).toEqual({
      reason: VideoCallTranscriptUnavailableReason.ConnectionProblem,
      message: expect.stringMatching(
        /no longer accepts OneUptime's sign-in for incidents@acme\.com\. Reconnect Microsoft Teams/,
      ),
    });

    const app: { result: VideoCallTranscriptRead } = await read([
      graphError({
        status: 401,
        code: "InvalidAuthenticationToken",
        message: "Access token has expired or is not yet valid.",
      }),
    ]);

    expect(unavailable(app.result)).toEqual({
      reason: VideoCallTranscriptUnavailableReason.ConnectionProblem,
      message: expect.stringMatching(
        /did not accept the app registration's token/,
      ),
    });
  });

  test("a meeting Graph no longer has: Expired once it is past Graph's 60 days, otherwise NoMeeting", async () => {
    const now: Date = new Date("2026-12-31T00:00:00.000Z");
    const day: number = 24 * 60 * 60 * 1000;
    const notFound: ScriptedResponse = graphError({
      status: 404,
      code: "NotFound",
      message: "The meeting was not found.",
    });

    const old: { result: VideoCallTranscriptRead } = await read([notFound], {
      now,
      callStartedAt: new Date(
        now.getTime() - (MICROSOFT_TEAMS_MEETING_RETENTION_IN_DAYS + 1) * day,
      ),
    });

    expect(unavailable(old.result)).toEqual({
      reason: VideoCallTranscriptUnavailableReason.Expired,
      message: expect.stringMatching(/for 60 days after it ends/),
    });

    const recent: { result: VideoCallTranscriptRead } = await read([notFound], {
      now,
      callStartedAt: new Date(
        now.getTime() - (MICROSOFT_TEAMS_MEETING_RETENTION_IN_DAYS - 1) * day,
      ),
    });

    expect(unavailable(recent.result).reason).toBe(
      VideoCallTranscriptUnavailableReason.NoMeeting,
    );

    const unknownStart: { result: VideoCallTranscriptRead } = await read([
      notFound,
    ]);

    expect(unavailable(unknownStart.result)).toEqual({
      reason: VideoCallTranscriptUnavailableReason.NoMeeting,
      message: expect.stringMatching(/no record of this meeting/),
    });
  });

  test("any other refusal: NotSupported, in Graph's words", async () => {
    const { result } = await read([
      graphError({
        status: 400,
        code: "BadRequest",
        message: "Invalid meeting id.",
      }),
    ]);

    expect(unavailable(result)).toEqual({
      reason: VideoCallTranscriptUnavailableReason.NotSupported,
      message: expect.stringMatching(/HTTP 400\): Invalid meeting id\./),
    });
  });

  test("Graph limiting requests, or failing, is no answer at all: the job asks again later", async () => {
    await expect(
      read([
        graphError({
          status: 429,
          code: "TooManyRequests",
          message: "Too many requests.",
        }),
      ]),
    ).rejects.toThrow(APIException);

    await expect(
      read([
        listOf([FIRST_TRANSCRIPT]),
        graphError({
          status: 503,
          code: "ServiceUnavailable",
          message: "Service unavailable.",
        }),
      ]),
    ).rejects.toThrow(APIException);
  });
});
