import { generateKeyPairSync } from "crypto";
import VideoCallConnection from "../../../../../Models/DatabaseModels/VideoCallConnection";
import VideoCallConnectionService from "../../../../../Server/Services/VideoCallConnectionService";
import { GOOGLE_DEFAULT_TOKEN_URI } from "../../../../../Server/Utils/VideoCall/Providers/GoogleMeetClient";
import { ZOOM_TOKEN_URL } from "../../../../../Server/Utils/VideoCall/Providers/ZoomMeetingClient";
import { VideoCallTranscriptRead } from "../../../../../Server/Utils/VideoCall/Transcripts/VideoCallTranscriptRead";
import VideoCallTranscriptReader, {
  VideoCallTranscriptReaderCall,
} from "../../../../../Server/Utils/VideoCall/Transcripts/VideoCallTranscriptReader";
import VideoCallHttpClient from "../../../../../Server/Utils/VideoCall/VideoCallHttpClient";
import APIException from "../../../../../Types/Exception/ApiException";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import VideoCallAuthMethod from "../../../../../Types/VideoCall/VideoCallAuthMethod";
import VideoCallProvider from "../../../../../Types/VideoCall/VideoCallProvider";
import { VideoCallTranscriptUnavailableReason } from "../../../../../Types/VideoCall/VideoCallTranscript";
import {
  ScriptedFetch,
  ScriptedResponse,
  readFormBody,
  scriptedFetch,
} from "../VideoCallTestFetch";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";

// Microsoft Graph of the commercial cloud, where no MICROSOFT_TEAMS_CLOUD is set.
const MICROSOFT_GRAPH_BASE_URL: string = "https://graph.microsoft.com/v1.0";

type ZoomTokenGetter = () => Promise<{
  accessToken: string;
  apiBaseUrl: string;
}>;

/*
 * A call's transcript is read with the connection that started the call -
 * the same sign-in or app credentials that created the meeting - and only
 * for a Zoom or Google Meet meeting OneUptime created, or a Microsoft Teams
 * meeting it put on its organizer's calendar. Every other call is answered
 * with how to add its transcript instead, without a request.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const CONNECTION: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

function connectionOf(data: {
  provider: VideoCallProvider;
  authMethod?: VideoCallAuthMethod;
  connectedAccount?: string;
}): VideoCallConnection {
  const connection: VideoCallConnection = new VideoCallConnection();
  connection.id = CONNECTION;
  connection.projectId = PROJECT;
  connection.provider = data.provider;

  if (data.authMethod) {
    connection.authMethod = data.authMethod;
  }

  if (data.connectedAccount) {
    connection.connectedAccount = data.connectedAccount;
  }

  return connection;
}

function useSettings(data: {
  provider: VideoCallProvider;
  config: JSONObject;
  secrets: JSONObject;
  authMethod?: VideoCallAuthMethod;
  connectedAccount?: string;
}): void {
  const connection: VideoCallConnection = connectionOf(data);

  jest.spyOn(VideoCallConnectionService, "getSettings").mockResolvedValue({
    connection,
    settings: {
      provider: data.provider,
      config: data.config,
      secrets: data.secrets,
      authMethod: data.authMethod,
    },
  });
}

async function read(
  call: VideoCallTranscriptReaderCall,
  responses: Array<ScriptedResponse>,
): Promise<{ result: VideoCallTranscriptRead; fetcher: ScriptedFetch }> {
  const fetcher: ScriptedFetch = scriptedFetch(responses);
  const result: VideoCallTranscriptRead = await VideoCallTranscriptReader.read({
    call,
    projectId: PROJECT,
    http: new VideoCallHttpClient({ fetchImplementation: fetcher.fetch }),
  });

  return { result, fetcher };
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

const NO_RECORDING: ScriptedResponse = {
  status: 404,
  body: { code: 3301, message: "This recording does not exist." },
};
const NO_MEETING_TRANSCRIPT: ScriptedResponse = {
  status: 404,
  body: { code: 3322, message: "This meeting transcript does not exist." },
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("VideoCallTranscriptReader - calls whose transcript a person adds", () => {
  test("a Microsoft Teams meeting not on a calendar: download the .vtt from the meeting's Recap", async () => {
    const getSettings: ReturnType<typeof jest.spyOn> = jest.spyOn(
      VideoCallConnectionService,
      "getSettings",
    );
    const { result, fetcher } = await read(
      {
        provider: VideoCallProvider.MicrosoftTeams,
        videoCallConnectionId: CONNECTION,
        externalMeetingId: "MSo1N2Y5ZGFjYy03MWJm",
      },
      [],
    );

    expect(unavailable(result)).toEqual({
      reason: VideoCallTranscriptUnavailableReason.NotSupported,
      message: expect.stringMatching(
        /only of meetings on a calendar, and OneUptime started this one without putting it on its organizer's calendar\. In Teams, open the meeting's Recap, download the transcript as a \.vtt file, and add it here/,
      ),
    });
    expect(fetcher.requests).toHaveLength(0);
    expect(getSettings).not.toHaveBeenCalled();
  });

  test("a Slack huddle: copy it from the huddle's notes", async () => {
    const { result } = await read(
      { provider: VideoCallProvider.SlackHuddle, externalMeetingId: "C0456" },
      [],
    );

    expect(unavailable(result).message).toMatch(/huddle's notes in Slack/);
  });

  test("a link of one's own, or a pasted Zoom link: OneUptime did not start the meeting", async () => {
    for (const provider of [
      VideoCallProvider.CustomLink,
      VideoCallProvider.Zoom,
    ]) {
      const { result } = await read({ provider }, []);

      expect(unavailable(result)).toEqual({
        reason: VideoCallTranscriptUnavailableReason.NotSupported,
        message: expect.stringMatching(/did not start this meeting/),
      });
    }
  });

  test("the connection that started the call was deleted", async () => {
    jest
      .spyOn(VideoCallConnectionService, "getSettings")
      .mockRejectedValue(
        new BadDataException("The video call connection no longer exists."),
      );

    const { result } = await read(
      {
        provider: VideoCallProvider.Zoom,
        videoCallConnectionId: CONNECTION,
        externalMeetingId: "85746065432",
      },
      [],
    );

    expect(unavailable(result).message).toMatch(/no longer exists/);
  });
});

describe("VideoCallTranscriptReader - Zoom", () => {
  const ZOOM_CALL: {
    provider: VideoCallProvider;
    videoCallConnectionId: ObjectID;
    externalMeetingId: string;
  } = {
    provider: VideoCallProvider.Zoom,
    videoCallConnectionId: CONNECTION,
    externalMeetingId: "85746065432",
  };

  test("a Server-to-Server OAuth app: its own account token, then the meeting's transcript", async () => {
    useSettings({
      provider: VideoCallProvider.Zoom,
      config: {
        accountId: "acct_123",
        clientId: "client_abc",
        hostEmail: "incidents@example.com",
      },
      secrets: { clientSecret: "secret" },
    });

    const { result, fetcher } = await read(ZOOM_CALL, [
      {
        status: 200,
        body: {
          access_token: "s2s-token",
          api_url: "https://api.zoom.us",
          scope: "meeting:write:meeting:admin",
        },
      },
      NO_RECORDING,
      NO_MEETING_TRANSCRIPT,
    ]);

    expect(unavailable(result).reason).toBe(
      VideoCallTranscriptUnavailableReason.NotTranscribed,
    );
    expect(fetcher.requests[0]!.url).toBe(ZOOM_TOKEN_URL);
    expect(readFormBody(fetcher.requests[0]!).get("account_id")).toBe(
      "acct_123",
    );
    expect(fetcher.requests[1]!.url).toBe(
      "https://api.zoom.us/v2/meetings/85746065432/recordings",
    );
    expect(fetcher.requests[1]!.init.headers["Authorization"]).toBe(
      "Bearer s2s-token",
    );
  });

  test("an app Zoom refuses is the connection's problem, in Zoom's words", async () => {
    useSettings({
      provider: VideoCallProvider.Zoom,
      config: {
        accountId: "acct_123",
        clientId: "client_abc",
        hostEmail: "incidents@example.com",
      },
      secrets: { clientSecret: "wrong" },
    });

    const { result, fetcher } = await read(ZOOM_CALL, [
      {
        status: 401,
        body: {
          reason: "Invalid client_id or client_secret",
          error: "invalid_client",
        },
      },
    ]);

    expect(unavailable(result)).toEqual({
      reason: VideoCallTranscriptUnavailableReason.ConnectionProblem,
      message: expect.stringMatching(/rejected the Client ID or Client secret/),
    });
    expect(fetcher.requests).toHaveLength(1);
  });

  test("a sign-in: its own token, and the scopes it was granted checked first", async () => {
    useSettings({
      provider: VideoCallProvider.Zoom,
      authMethod: VideoCallAuthMethod.OAuth,
      connectedAccount: "incidents@acme.com",
      config: {},
      secrets: {
        refreshToken: "refresh",
        scope: "meeting:write:meeting user:read:user",
      },
    });
    const getAccessToken: Mock<ZoomTokenGetter> = jest.fn<ZoomTokenGetter>(
      async () => {
        return { accessToken: "user-token", apiBaseUrl: "https://api.zoom.us" };
      },
    );
    jest.spyOn(VideoCallConnectionService, "getOAuthAccess").mockReturnValue({
      accountLabel: "incidents@acme.com",
      getAccessToken,
    });

    const { result, fetcher } = await read(ZOOM_CALL, []);

    expect(unavailable(result)).toEqual({
      reason: VideoCallTranscriptUnavailableReason.PermissionMissing,
      message: expect.stringMatching(/Reconnect Zoom/),
    });
    expect(getAccessToken).toHaveBeenCalledTimes(1);
    expect(fetcher.requests).toHaveLength(0);
  });

  test("a sign-in that cannot be refreshed is the connection's problem", async () => {
    useSettings({
      provider: VideoCallProvider.Zoom,
      authMethod: VideoCallAuthMethod.OAuth,
      config: {},
      secrets: { refreshToken: "refresh" },
    });
    jest.spyOn(VideoCallConnectionService, "getOAuthAccess").mockReturnValue({
      accountLabel: "incidents@acme.com",
      getAccessToken: async () => {
        throw new BadDataException(
          "Zoom no longer accepts OneUptime's sign-in for incidents@acme.com.",
        );
      },
    });

    const { result } = await read(ZOOM_CALL, []);

    expect(unavailable(result)).toEqual({
      reason: VideoCallTranscriptUnavailableReason.ConnectionProblem,
      message: expect.stringMatching(/no longer accepts OneUptime's sign-in/),
    });
  });

  test("Zoom not answering is an error, not an answer about the transcript", async () => {
    useSettings({
      provider: VideoCallProvider.Zoom,
      config: {
        accountId: "acct_123",
        clientId: "client_abc",
        hostEmail: "incidents@example.com",
      },
      secrets: { clientSecret: "secret" },
    });

    let thrown: unknown = null;

    try {
      await read(ZOOM_CALL, [
        {
          status: 200,
          body: { access_token: "s2s-token", api_url: "https://api.zoom.us" },
        },
        { status: 502, body: "Bad Gateway" },
      ]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(APIException);
  });
});

describe("VideoCallTranscriptReader - Google Meet", () => {
  const MEET_CALL: {
    provider: VideoCallProvider;
    videoCallConnectionId: ObjectID;
    externalMeetingId: string;
  } = {
    provider: VideoCallProvider.GoogleMeet,
    videoCallConnectionId: CONNECTION,
    externalMeetingId: "spaces/jQCFfuBOdN5z",
  };

  test("a service account: its delegated token for the scope it creates meetings with", async () => {
    useSettings({
      provider: VideoCallProvider.GoogleMeet,
      config: {
        impersonatedUserEmail: "incidents@acme.com",
        accessType: "TRUSTED",
      },
      secrets: {
        serviceAccountJson: JSON.stringify({
          type: "service_account",
          client_email: "meet@acme.iam.gserviceaccount.com",
          client_id: "102345678901234567890",
          private_key: privateKey,
          token_uri: GOOGLE_DEFAULT_TOKEN_URI,
        }),
      },
    });

    const { result, fetcher } = await read(MEET_CALL, [
      {
        status: 200,
        body: { access_token: "delegated-token", expires_in: 3599 },
      },
      { status: 200, body: { conferenceRecords: [] } },
    ]);

    expect(unavailable(result).reason).toBe(
      VideoCallTranscriptUnavailableReason.NoMeeting,
    );
    expect(fetcher.requests[0]!.url).toBe(GOOGLE_DEFAULT_TOKEN_URI);
    expect(fetcher.requests[1]!.init.headers["Authorization"]).toBe(
      "Bearer delegated-token",
    );
  });

  test("a sign-in: its own token, and the account named when Google refuses", async () => {
    useSettings({
      provider: VideoCallProvider.GoogleMeet,
      authMethod: VideoCallAuthMethod.OAuth,
      connectedAccount: "incidents@acme.com",
      config: { accessType: "TRUSTED" },
      secrets: { refreshToken: "refresh" },
    });
    jest.spyOn(VideoCallConnectionService, "getOAuthAccess").mockReturnValue({
      accountLabel: "incidents@acme.com",
      getAccessToken: async () => {
        return { accessToken: "user-token" };
      },
    });

    const { result, fetcher } = await read(MEET_CALL, [
      {
        status: 401,
        body: { error: { code: 401, message: "Invalid credentials" } },
      },
    ]);

    expect(unavailable(result)).toEqual({
      reason: VideoCallTranscriptUnavailableReason.ConnectionProblem,
      message: expect.stringMatching(
        /sign-in for incidents@acme\.com\. Reconnect Google Meet/,
      ),
    });
    expect(fetcher.requests[0]!.init.headers["Authorization"]).toBe(
      "Bearer user-token",
    );
  });

  test("a service account key that does not parse is the connection's problem", async () => {
    useSettings({
      provider: VideoCallProvider.GoogleMeet,
      config: {
        impersonatedUserEmail: "incidents@acme.com",
        accessType: "TRUSTED",
      },
      secrets: { serviceAccountJson: "{not json" },
    });

    const { result } = await read(MEET_CALL, []);

    expect(unavailable(result)).toEqual({
      reason: VideoCallTranscriptUnavailableReason.ConnectionProblem,
      message: expect.stringMatching(/not valid JSON/),
    });
  });
});

describe("VideoCallTranscriptReader - Microsoft Teams", () => {
  const TENANT_ID: string = "11111111-2222-3333-4444-555555555555";
  const CLIENT_ID: string = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const ORGANIZER_ID: string = "99999999-8888-7777-6666-555555555555";
  const MEETING_ID: string = "MSpkYzE3Njc0Yy04MWQ5LTRhZGItYmZi";

  // A meeting OneUptime put on its organizer's calendar, to record it.
  const TEAMS_CALL: VideoCallTranscriptReaderCall = {
    provider: VideoCallProvider.MicrosoftTeams,
    videoCallConnectionId: CONNECTION,
    externalMeetingId: MEETING_ID,
    externalCalendarEventId: "AAMkAGI2TG93AAA=",
  };

  const APP_CONFIG: JSONObject = {
    tenantId: TENANT_ID,
    clientId: CLIENT_ID,
    organizerUserId: ORGANIZER_ID,
    lobbyBypass: "organization",
  };

  const TRANSCRIPTS: ScriptedResponse = {
    status: 200,
    body: {
      value: [
        {
          id: "transcript-1",
          meetingId: MEETING_ID,
          createdDateTime: "2026-10-19T08:30:00Z",
        },
      ],
    },
  };

  const CONTENT: ScriptedResponse = {
    status: 200,
    body: [
      "WEBVTT",
      "",
      "00:00:03.000 --> 00:00:05.000",
      "<v Priya Shah>We rolled back the deploy.</v>",
      "",
    ].join("\n"),
  };

  test("an app registration: its own token for the tenant, then the meeting's transcripts as its organizer", async () => {
    useSettings({
      provider: VideoCallProvider.MicrosoftTeams,
      config: APP_CONFIG,
      secrets: { clientSecret: "client~secret.value" },
    });

    const { result, fetcher } = await read(TEAMS_CALL, [
      {
        status: 200,
        body: {
          token_type: "Bearer",
          expires_in: 3599,
          access_token: "app-token",
        },
      },
      TRANSCRIPTS,
      CONTENT,
    ]);

    expect(fetcher.requests[0]!.url).toBe(
      `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    );
    const form: URLSearchParams = readFormBody(fetcher.requests[0]!);
    expect(form.get("grant_type")).toBe("client_credentials");
    expect(form.get("client_id")).toBe(CLIENT_ID);
    expect(form.get("client_secret")).toBe("client~secret.value");

    expect(fetcher.requests[1]!.url).toBe(
      `${MICROSOFT_GRAPH_BASE_URL}/users/${ORGANIZER_ID}/onlineMeetings/${MEETING_ID}/transcripts`,
    );
    expect(fetcher.requests[1]!.init.headers["Authorization"]).toBe(
      "Bearer app-token",
    );

    expect(result.found).toBe(true);
    expect(result.found ? result.lines : []).toEqual([
      {
        offsetInSeconds: 3,
        speaker: "Priya Shah",
        text: "We rolled back the deploy.",
      },
    ]);
  });

  test("an app registration's refusal names the policy that lets it act for the organizer", async () => {
    useSettings({
      provider: VideoCallProvider.MicrosoftTeams,
      config: APP_CONFIG,
      secrets: { clientSecret: "client~secret.value" },
    });

    const { result } = await read(TEAMS_CALL, [
      {
        status: 200,
        body: {
          token_type: "Bearer",
          expires_in: 3599,
          access_token: "app-token",
        },
      },
      {
        status: 403,
        body: {
          error: {
            code: "Forbidden",
            message: "No application access policy found for this app.",
          },
        },
      },
    ]);

    expect(unavailable(result)).toEqual({
      reason: VideoCallTranscriptUnavailableReason.PermissionMissing,
      message: expect.stringContaining(`-Identity "${ORGANIZER_ID}"`),
    });
  });

  test("a client secret Entra refuses is the connection's problem", async () => {
    useSettings({
      provider: VideoCallProvider.MicrosoftTeams,
      config: APP_CONFIG,
      secrets: { clientSecret: "expired" },
    });

    const { result, fetcher } = await read(TEAMS_CALL, [
      {
        status: 401,
        body: {
          error: "invalid_client",
          error_description:
            "AADSTS7000222: The provided client secret keys for app are expired.",
        },
      },
    ]);

    expect(unavailable(result)).toEqual({
      reason: VideoCallTranscriptUnavailableReason.ConnectionProblem,
      message: expect.stringMatching(/rejected the client secret/),
    });
    expect(fetcher.requests).toHaveLength(1);
  });

  test("a sign-in: its own token, as /me, and the transcript permission it was granted checked first", async () => {
    useSettings({
      provider: VideoCallProvider.MicrosoftTeams,
      authMethod: VideoCallAuthMethod.OAuth,
      connectedAccount: "incidents@acme.com",
      config: { lobbyBypass: "organization" },
      secrets: {
        refreshToken: "refresh",
        // Connected before the project recorded its calls.
        scope: "openid profile email OnlineMeetings.ReadWrite",
      },
    });
    const getAccessToken: Mock<() => Promise<{ accessToken: string }>> =
      jest.fn<() => Promise<{ accessToken: string }>>(async () => {
        return { accessToken: "user-token" };
      });
    jest.spyOn(VideoCallConnectionService, "getOAuthAccess").mockReturnValue({
      accountLabel: "incidents@acme.com",
      getAccessToken,
    });

    const { result, fetcher } = await read(TEAMS_CALL, []);

    expect(unavailable(result)).toEqual({
      reason: VideoCallTranscriptUnavailableReason.PermissionMissing,
      message: expect.stringMatching(
        /Reconnect Microsoft Teams .* while Record and transcribe incident calls is on/,
      ),
    });
    expect(getAccessToken).toHaveBeenCalledTimes(1);
    expect(fetcher.requests).toHaveLength(0);
  });

  test("a sign-in granted transcripts reads them as the signed-in account", async () => {
    useSettings({
      provider: VideoCallProvider.MicrosoftTeams,
      authMethod: VideoCallAuthMethod.OAuth,
      connectedAccount: "incidents@acme.com",
      config: { lobbyBypass: "organization" },
      secrets: {
        refreshToken: "refresh",
        scope:
          "OnlineMeetings.ReadWrite Calendars.ReadWrite OnlineMeetingTranscript.Read.All",
      },
    });
    jest.spyOn(VideoCallConnectionService, "getOAuthAccess").mockReturnValue({
      accountLabel: "incidents@acme.com",
      getAccessToken: async () => {
        return { accessToken: "user-token" };
      },
    });

    const { result, fetcher } = await read(TEAMS_CALL, [TRANSCRIPTS, CONTENT]);

    expect(fetcher.requests[0]!.url).toBe(
      `${MICROSOFT_GRAPH_BASE_URL}/me/onlineMeetings/${MEETING_ID}/transcripts`,
    );
    expect(fetcher.requests[0]!.init.headers["Authorization"]).toBe(
      "Bearer user-token",
    );
    expect(result.found).toBe(true);
  });

  test("a sign-in Microsoft no longer accepts is named in the answer", async () => {
    useSettings({
      provider: VideoCallProvider.MicrosoftTeams,
      authMethod: VideoCallAuthMethod.OAuth,
      connectedAccount: "incidents@acme.com",
      config: {},
      secrets: { refreshToken: "refresh" },
    });
    jest.spyOn(VideoCallConnectionService, "getOAuthAccess").mockReturnValue({
      accountLabel: "incidents@acme.com",
      getAccessToken: async () => {
        return { accessToken: "user-token" };
      },
    });

    const { result } = await read(TEAMS_CALL, [
      {
        status: 401,
        body: {
          error: {
            code: "InvalidAuthenticationToken",
            message: "Lifetime validation failed, the token is expired.",
          },
        },
      },
    ]);

    expect(unavailable(result)).toEqual({
      reason: VideoCallTranscriptUnavailableReason.ConnectionProblem,
      message: expect.stringMatching(
        /sign-in for incidents@acme\.com\. Reconnect Microsoft Teams/,
      ),
    });
  });

  test("an old call's meeting Graph no longer has: Expired, from when the call started", async () => {
    useSettings({
      provider: VideoCallProvider.MicrosoftTeams,
      config: APP_CONFIG,
      secrets: { clientSecret: "client~secret.value" },
    });

    const { result } = await read(
      {
        ...TEAMS_CALL,
        startedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      },
      [
        {
          status: 200,
          body: { token_type: "Bearer", expires_in: 3599, access_token: "t" },
        },
        {
          status: 404,
          body: { error: { code: "NotFound", message: "Not found." } },
        },
      ],
    );

    expect(unavailable(result).reason).toBe(
      VideoCallTranscriptUnavailableReason.Expired,
    );
  });

  test("Graph not answering is an error, not an answer about the transcript", async () => {
    useSettings({
      provider: VideoCallProvider.MicrosoftTeams,
      config: APP_CONFIG,
      secrets: { clientSecret: "client~secret.value" },
    });

    await expect(
      read(TEAMS_CALL, [
        {
          status: 200,
          body: { token_type: "Bearer", expires_in: 3599, access_token: "t" },
        },
        {
          status: 503,
          body: { error: { code: "ServiceUnavailable", message: "Busy." } },
        },
      ]),
    ).rejects.toBeInstanceOf(APIException);
  });
});
