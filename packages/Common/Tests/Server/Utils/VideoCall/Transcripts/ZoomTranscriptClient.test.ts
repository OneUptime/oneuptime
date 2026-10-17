import ZoomTranscriptClient from "../../../../../Server/Utils/VideoCall/Transcripts/ZoomTranscriptClient";
import { VideoCallTranscriptRead } from "../../../../../Server/Utils/VideoCall/Transcripts/VideoCallTranscriptRead";
import VideoCallHttpClient from "../../../../../Server/Utils/VideoCall/VideoCallHttpClient";
import APIException from "../../../../../Types/Exception/ApiException";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import {
  ZOOM_CLASSIC_RECORDING_SCOPE,
  ZOOM_MEETING_TRANSCRIPT_SCOPE,
  ZOOM_OAUTH_MEETING_TRANSCRIPT_SCOPE,
  ZOOM_OAUTH_RECORDING_FILES_SCOPE,
  ZOOM_RECORDING_FILES_SCOPE,
} from "../../../../../Types/VideoCall/VideoCallProviderCatalog";
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
 * Reading a Zoom meeting's transcript, against responses in the shapes the
 * Zoom API answers with: the cloud recording's audio transcript first, the
 * transcript AI Companion's meeting summary keeps second, and - when there
 * is none - what the person can do about it: wait, turn transcripts on, add
 * the scope the connection is missing, or reconnect.
 */

const API_BASE: string = "https://api.zoom.us/v2";
const MEETING_ID: string = "85746065432";
const TOKEN: { accessToken: string; apiBaseUrl: string } = {
  accessToken: "zoom-access-token",
  apiBaseUrl: API_BASE,
};

const VTT: string = [
  "WEBVTT",
  "",
  "1",
  "00:00:05.120 --> 00:00:09.300",
  "Priya Shah: Checkout has been timing out since the deploy.",
  "",
  "2",
  "00:12:03.000 --> 00:12:06.000",
  "Sam Lee: The pool maxes at 50 and we just went to 100 workers.",
  "",
].join("\n");

const RECORDING_DOWNLOAD_URL: string =
  "https://us05web.zoom.us/rec/download/vtt-transcript-of-the-recording";
const SUMMARY_DOWNLOAD_URL: string =
  "https://us05web.zoom.us/rec/meeting/transcript/download/YDztop0PYLrAQat616a1q1H86RM4jf1Bf3p42a4Ap1jV3bWAJAE";

function recording(files: Array<JSONObject>): JSONObject {
  return {
    uuid: "4444AAAiAAAAAiAiAiiAii==",
    id: Number(MEETING_ID),
    account_id: "Cx3wERazSgup7ZWRHQM8-w",
    host_id: "_0ctZtY0REqWalTmwvrdIw",
    topic: "INC-42: Checkout API is down",
    type: 2,
    start_time: "2026-10-17T14:05:12Z",
    duration: 52,
    recording_count: files.length,
    recording_files: files,
  };
}

const MP4_FILE: JSONObject = {
  id: "a1",
  file_type: "MP4",
  file_extension: "MP4",
  download_url: "https://us05web.zoom.us/rec/download/mp4",
  status: "completed",
  recording_type: "shared_screen_with_speaker_view",
};

const TRANSCRIPT_FILE: JSONObject = {
  id: "a2",
  file_type: "TRANSCRIPT",
  file_extension: "VTT",
  download_url: RECORDING_DOWNLOAD_URL,
  status: "completed",
  recording_type: "audio_transcript",
};

const NO_RECORDING: ScriptedResponse = {
  status: 404,
  body: { code: 3301, message: "This recording does not exist." },
};
const NO_MEETING_TRANSCRIPT: ScriptedResponse = {
  status: 404,
  body: { code: 3322, message: "This meeting transcript does not exist." },
};

function missingScope(scope: string): ScriptedResponse {
  return {
    status: 400,
    body: {
      code: 4711,
      message: `Invalid access token, does not contain scopes:[${scope}].`,
    },
  };
}

function meetingTranscript(body: JSONObject): ScriptedResponse {
  return {
    status: 200,
    body: {
      meeting_id: "uaFkQyFCSwya8iNYtkAw3A==",
      account_id: "Cx3wERazSgup7ZWRHQM8-w",
      meeting_topic: "INC-42: Checkout API is down",
      host_id: "_0ctZtY0REqWalTmwvrdIw",
      transcript_created_time: "2026-10-17T15:01:24Z",
      ...body,
    },
  };
}

async function read(
  responses: Array<ScriptedResponse>,
  overrides?: Partial<{
    isSignIn: boolean;
    grantedScope: string;
    meetingId: string;
  }>,
): Promise<{ result: VideoCallTranscriptRead; fetcher: ScriptedFetch }> {
  const fetcher: ScriptedFetch = scriptedFetch(responses);
  const result: VideoCallTranscriptRead =
    await ZoomTranscriptClient.readTranscript({
      http: new VideoCallHttpClient({ fetchImplementation: fetcher.fetch }),
      token: TOKEN,
      meetingId: overrides?.meetingId ?? MEETING_ID,
      isSignIn: overrides?.isSignIn ?? false,
      grantedScope: overrides?.grantedScope,
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

async function expectThrows(
  promise: Promise<unknown>,
  type: typeof APIException | typeof BadDataException,
  message: RegExp,
): Promise<void> {
  let thrown: unknown = null;

  try {
    await promise;
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(type);
  expect((thrown as Error).message).toMatch(message);
}

describe("ZoomTranscriptClient - finding the transcript", () => {
  test("reads the cloud recording's audio transcript, downloading it with the token", async () => {
    const { result, fetcher } = await read([
      { status: 200, body: recording([MP4_FILE, TRANSCRIPT_FILE]) },
      { status: 200, body: VTT },
    ]);

    expect(linesOf(result)).toEqual([
      {
        offsetInSeconds: 5.12,
        speaker: "Priya Shah",
        text: "Checkout has been timing out since the deploy.",
      },
      {
        offsetInSeconds: 723,
        speaker: "Sam Lee",
        text: "The pool maxes at 50 and we just went to 100 workers.",
      },
    ]);
    expect(result.found && result.format).toBe(TranscriptSourceFormat.WebVTT);

    expect(
      fetcher.requests.map((request: { url: string }) => {
        return request.url;
      }),
    ).toEqual([
      `${API_BASE}/meetings/${MEETING_ID}/recordings`,
      RECORDING_DOWNLOAD_URL,
    ]);

    for (const request of fetcher.requests) {
      expect(request.init.method).toBe("GET");
      expect(request.init.headers["Authorization"]).toBe(
        "Bearer zoom-access-token",
      );
    }
  });

  test("the meeting's id is encoded into the path", async () => {
    const { fetcher } = await read([NO_RECORDING, NO_MEETING_TRANSCRIPT], {
      meetingId: "/ajXp112QmuoKj4854875==",
    });

    expect(fetcher.requests[0]!.url).toBe(
      `${API_BASE}/meetings/%2FajXp112QmuoKj4854875%3D%3D/recordings`,
    );
  });

  test("a recording with closed captions but no audio transcript gives its captions", async () => {
    const { result, fetcher } = await read([
      {
        status: 200,
        body: recording([
          MP4_FILE,
          {
            ...TRANSCRIPT_FILE,
            file_type: "CC",
            recording_type: "closed_caption",
            download_url: "https://us05web.zoom.us/rec/download/cc",
          },
        ]),
      },
      { status: 200, body: VTT },
    ]);

    expect(linesOf(result)).toHaveLength(2);
    expect(fetcher.requests[1]!.url).toBe(
      "https://us05web.zoom.us/rec/download/cc",
    );
  });

  test("with no cloud recording, reads the transcript AI Companion's meeting summary kept", async () => {
    const { result, fetcher } = await read([
      NO_RECORDING,
      meetingTranscript({
        can_download: true,
        download_url: SUMMARY_DOWNLOAD_URL,
      }),
      { status: 200, body: VTT },
    ]);

    expect(linesOf(result)).toHaveLength(2);
    expect(
      fetcher.requests.map((request: { url: string }) => {
        return request.url;
      }),
    ).toEqual([
      `${API_BASE}/meetings/${MEETING_ID}/recordings`,
      `${API_BASE}/meetings/${MEETING_ID}/transcript`,
      SUMMARY_DOWNLOAD_URL,
    ]);
  });

  test("a recording with no transcript among its files looks for the meeting summary's", async () => {
    const { result } = await read([
      { status: 200, body: recording([MP4_FILE]) },
      meetingTranscript({
        can_download: true,
        download_url: SUMMARY_DOWNLOAD_URL,
      }),
      { status: 200, body: VTT },
    ]);

    expect(linesOf(result)).toHaveLength(2);
  });
});

describe("ZoomTranscriptClient - when there is no transcript to read", () => {
  test("neither place has one: says how Zoom keeps a transcript, and that a person can add it", async () => {
    const { result, fetcher } = await read([
      NO_RECORDING,
      NO_MEETING_TRANSCRIPT,
    ]);

    expect(unavailable(result)).toEqual({
      reason: VideoCallTranscriptUnavailableReason.NotTranscribed,
      message: expect.stringMatching(
        /recorded to the cloud with Audio transcript on, or when AI Companion's meeting summary is on\. You can add the transcript yourself\./,
      ),
    });
    expect(fetcher.requests).toHaveLength(2);
  });

  test("the recording's transcript is still being processed: try again later", async () => {
    const { result } = await read([
      {
        status: 200,
        body: recording([
          {
            ...TRANSCRIPT_FILE,
            status: "processing",
            download_url: undefined,
          } as unknown as JSONObject,
        ]),
      },
      NO_MEETING_TRANSCRIPT,
    ]);

    expect(unavailable(result)).toEqual({
      reason: VideoCallTranscriptUnavailableReason.NotReady,
      message: expect.stringMatching(
        /still preparing.*twice the length of the call/,
      ),
    });
  });

  test("the recording is still processing and has no transcript yet: not ready", async () => {
    const { result } = await read([
      { status: 200, body: recording([{ ...MP4_FILE, status: "processing" }]) },
      NO_MEETING_TRANSCRIPT,
    ]);

    expect(unavailable(result).reason).toBe(
      VideoCallTranscriptUnavailableReason.NotReady,
    );
  });

  test("the meeting summary's transcript is NOT_READY: not ready", async () => {
    const { result } = await read([
      NO_RECORDING,
      meetingTranscript({
        can_download: false,
        download_restriction_reason: "NOT_READY",
      }),
    ]);

    expect(unavailable(result).reason).toBe(
      VideoCallTranscriptUnavailableReason.NotReady,
    );
  });

  test("the meeting summary's transcript was deleted: says so, and how to get it back", async () => {
    const { result } = await read([
      NO_RECORDING,
      meetingTranscript({
        can_download: false,
        download_restriction_reason: "DELETED_OR_TRASHED",
      }),
    ]);

    expect(unavailable(result)).toEqual({
      reason: VideoCallTranscriptUnavailableReason.Expired,
      message: expect.stringMatching(/deleted .* or moved it to the trash/),
    });
  });

  test("NO_TRANSCRIPT_DATA is no transcript", async () => {
    const { result } = await read([
      NO_RECORDING,
      meetingTranscript({
        can_download: false,
        download_restriction_reason: "NO_TRANSCRIPT_DATA",
      }),
    ]);

    expect(unavailable(result).reason).toBe(
      VideoCallTranscriptUnavailableReason.NotTranscribed,
    );
  });

  test("no meeting number: nothing to ask Zoom, and no request", async () => {
    const { result, fetcher } = await read([], { meetingId: "  " });

    expect(unavailable(result).reason).toBe(
      VideoCallTranscriptUnavailableReason.NotSupported,
    );
    expect(fetcher.requests).toHaveLength(0);
  });
});

describe("ZoomTranscriptClient - a connection that cannot read transcripts", () => {
  test("a Server-to-Server OAuth app without the scopes is told which to add, granular and classic", async () => {
    const { result } = await read([
      missingScope(ZOOM_RECORDING_FILES_SCOPE),
      missingScope(ZOOM_MEETING_TRANSCRIPT_SCOPE),
    ]);

    const { reason, message } = unavailable(result);

    expect(reason).toBe(VideoCallTranscriptUnavailableReason.PermissionMissing);
    expect(message).toContain(ZOOM_RECORDING_FILES_SCOPE);
    expect(message).toContain(ZOOM_MEETING_TRANSCRIPT_SCOPE);
    expect(message).toContain(ZOOM_CLASSIC_RECORDING_SCOPE);
    expect(message).toContain("Scopes page");
  });

  test("a sign-in without the scopes is told to reconnect", async () => {
    const { result } = await read(
      [
        missingScope(ZOOM_OAUTH_RECORDING_FILES_SCOPE),
        missingScope(ZOOM_OAUTH_MEETING_TRANSCRIPT_SCOPE),
      ],
      { isSignIn: true },
    );

    const { reason, message } = unavailable(result);

    expect(reason).toBe(VideoCallTranscriptUnavailableReason.PermissionMissing);
    expect(message).toMatch(
      /Reconnect Zoom in Project Settings > Workspace > Video Calls/,
    );
    expect(message).toContain(ZOOM_OAUTH_RECORDING_FILES_SCOPE);
    expect(message).toContain(ZOOM_OAUTH_MEETING_TRANSCRIPT_SCOPE);
  });

  test("a sign-in granted only the meeting scopes is told to reconnect, without asking Zoom", async () => {
    const { result, fetcher } = await read([], {
      isSignIn: true,
      grantedScope: "meeting:write:meeting user:read:user",
    });

    expect(unavailable(result).reason).toBe(
      VideoCallTranscriptUnavailableReason.PermissionMissing,
    );
    expect(fetcher.requests).toHaveLength(0);
  });

  test("a sign-in granted a transcript scope asks Zoom", async () => {
    const { fetcher } = await read([NO_RECORDING, NO_MEETING_TRANSCRIPT], {
      isSignIn: true,
      grantedScope: `meeting:write:meeting user:read:user ${ZOOM_OAUTH_MEETING_TRANSCRIPT_SCOPE}`,
    });

    expect(fetcher.requests).toHaveLength(2);
  });

  test("one scope of two still finds the transcript where it looks", async () => {
    const { result } = await read([
      missingScope(ZOOM_RECORDING_FILES_SCOPE),
      meetingTranscript({
        can_download: true,
        download_url: SUMMARY_DOWNLOAD_URL,
      }),
      { status: 200, body: VTT },
    ]);

    expect(linesOf(result)).toHaveLength(2);
  });

  test("a rejected token is the connection's problem: no second request", async () => {
    const { result, fetcher } = await read([
      { status: 401, body: { code: 124, message: "Invalid access token." } },
    ]);

    expect(unavailable(result)).toEqual({
      reason: VideoCallTranscriptUnavailableReason.ConnectionProblem,
      message: expect.stringMatching(
        /Server-to-Server OAuth app is still activated/,
      ),
    });
    expect(fetcher.requests).toHaveLength(1);
  });

  test("a sign-in Zoom no longer accepts: reconnect", async () => {
    const { result } = await read(
      [{ status: 401, body: { code: 124, message: "Invalid access token." } }],
      { isSignIn: true },
    );

    expect(unavailable(result)).toEqual({
      reason: VideoCallTranscriptUnavailableReason.ConnectionProblem,
      message: expect.stringMatching(/Reconnect Zoom/),
    });
  });
});

describe("ZoomTranscriptClient - Zoom not answering is an error", () => {
  test("a rate limit throws, asking to try again", async () => {
    await expectThrows(
      read([
        { status: 429, body: { code: 429, message: "Too many requests" } },
      ]),
      APIException,
      /limiting requests .* Try again in a minute/,
    );
  });

  test("a server error throws, with Zoom's words", async () => {
    await expectThrows(
      read([{ status: 503, body: "Service Unavailable" }]),
      APIException,
      /HTTP 503.*Service Unavailable/,
    );
  });

  test("a download link that is not on a Zoom host is never sent the token", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      {
        status: 200,
        body: recording([
          {
            ...TRANSCRIPT_FILE,
            download_url: "https://zoom.us.evil.example/rec/download/x",
          },
        ]),
      },
    ]);

    await expectThrows(
      ZoomTranscriptClient.readTranscript({
        http: new VideoCallHttpClient({ fetchImplementation: fetcher.fetch }),
        token: TOKEN,
        meetingId: MEETING_ID,
        isSignIn: false,
      }),
      APIException,
      /not on a Zoom host/,
    );
    expect(fetcher.requests).toHaveLength(1);
  });

  test("a transcript longer than any call is refused", async () => {
    await expectThrows(
      read([
        { status: 200, body: recording([TRANSCRIPT_FILE]) },
        {
          status: 200,
          body: "a".repeat(MAX_VIDEO_CALL_TRANSCRIPT_INPUT_CHARACTERS + 1),
        },
      ]),
      BadDataException,
      /too long to add/,
    );
  });

  test("a refused download is the connection's problem", async () => {
    const { result } = await read([
      { status: 200, body: recording([TRANSCRIPT_FILE]) },
      { status: 401, body: { code: 124, message: "Invalid access token." } },
    ]);

    expect(unavailable(result).reason).toBe(
      VideoCallTranscriptUnavailableReason.ConnectionProblem,
    );
  });
});

describe("ZoomTranscriptClient.grantsTranscripts", () => {
  test.each([
    ["cloud_recording:read:list_recording_files", true],
    ["cloud_recording:read:meeting_transcript", true],
    ["meeting:write:meeting recording:read", true],
    [`meeting:write:meeting,${ZOOM_CLASSIC_RECORDING_SCOPE}`, true],
    ["meeting:write:meeting user:read:user", false],
    ["", false],
  ])("%s grants transcripts: %s", (scope: string, grants: boolean) => {
    expect(ZoomTranscriptClient.grantsTranscripts(scope)).toBe(grants);
  });
});
