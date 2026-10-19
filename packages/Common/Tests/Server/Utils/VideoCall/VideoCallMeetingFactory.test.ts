import VideoCallMeetingFactory from "../../../../Server/Utils/VideoCall/VideoCallMeetingFactory";
import {
  VideoCallOAuthAccess,
  VideoCallOAuthAccessToken,
} from "../../../../Server/Utils/VideoCall/OAuth/VideoCallOAuth";
import VideoCallHttpClient from "../../../../Server/Utils/VideoCall/VideoCallHttpClient";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import VideoCallAuthMethod from "../../../../Types/VideoCall/VideoCallAuthMethod";
import VideoCallMeeting from "../../../../Types/VideoCall/VideoCallMeeting";
import VideoCallProvider from "../../../../Types/VideoCall/VideoCallProvider";
import { ScriptedFetch, scriptedFetch } from "./VideoCallTestFetch";
import { describe, expect, test } from "@jest/globals";

/*
 * The factory hands a connection's settings, read by the catalog's field
 * keys, to the right client - or, for a standing meeting link, returns the
 * link without a request at all.
 */
describe("VideoCallMeetingFactory", () => {
  test("creates a Zoom meeting with the settings read by their catalog keys", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: { access_token: "t" } },
      { status: 201, body: { id: 1, join_url: "https://zoom.us/j/1" } },
    ]);

    const meeting: VideoCallMeeting =
      await VideoCallMeetingFactory.createMeeting({
        settings: {
          provider: VideoCallProvider.Zoom,
          config: {
            accountId: " acct ",
            clientId: "client",
            hostEmail: "host@acme.com",
          },
          secrets: { clientSecret: "secret" },
        },
        request: { title: "INC-1" },
        http: new VideoCallHttpClient({ fetchImplementation: fetcher.fetch }),
      });

    expect(meeting.joinUrl).toBe("https://zoom.us/j/1");
    expect(
      new URLSearchParams(fetcher.requests[0]!.init.body!).get("account_id"),
    ).toBe("acct");
    expect(fetcher.requests[1]!.url).toContain(
      "/users/host%40acme.com/meetings",
    );
  });

  test("creates a Microsoft Teams meeting for the configured organizer", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: { access_token: "t" } },
      {
        status: 201,
        body: {
          id: "m",
          joinWebUrl: "https://teams.microsoft.com/l/meetup-join/x",
        },
      },
    ]);

    const meeting: VideoCallMeeting =
      await VideoCallMeetingFactory.createMeeting({
        settings: {
          provider: VideoCallProvider.MicrosoftTeams,
          config: {
            tenantId: "11111111-2222-3333-4444-555555555555",
            clientId: "11111111-2222-3333-4444-555555555555",
            organizerUserId: "99999999-2222-3333-4444-555555555555",
            lobbyBypass: "organization",
          },
          secrets: { clientSecret: "secret" },
        },
        request: { title: "INC-1" },
        http: new VideoCallHttpClient({ fetchImplementation: fetcher.fetch }),
      });

    expect(meeting.provider).toBe(VideoCallProvider.MicrosoftTeams);
    expect(fetcher.requests[1]!.url).toContain(
      "/users/99999999-2222-3333-4444-555555555555/onlineMeetings",
    );
  });

  test("returns a standing meeting link without any request", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([]);

    const meeting: VideoCallMeeting =
      await VideoCallMeetingFactory.createMeeting({
        settings: {
          provider: VideoCallProvider.CustomLink,
          config: { joinUrl: "https://acme.webex.com/meet/incidents" },
          secrets: {},
        },
        request: { title: "INC-1" },
        http: new VideoCallHttpClient({ fetchImplementation: fetcher.fetch }),
      });

    expect(meeting).toEqual({
      provider: VideoCallProvider.CustomLink,
      joinUrl: "https://acme.webex.com/meet/incidents",
    });
    expect(fetcher.requests).toHaveLength(0);
  });

  test("refuses a standing link that is not https, even if it was stored", async () => {
    await expect(
      VideoCallMeetingFactory.createMeeting({
        settings: {
          provider: VideoCallProvider.CustomLink,
          config: { joinUrl: "http://acme.example.com" },
          secrets: {},
        },
        request: { title: "INC-1" },
      }),
    ).rejects.toThrow("Meeting link must be an https link.");
  });

  test("refuses a provider that has no connection", async () => {
    await expect(
      VideoCallMeetingFactory.createMeeting({
        settings: {
          provider: VideoCallProvider.SlackHuddle,
          config: {},
          secrets: {},
        },
        request: { title: "INC-1" },
      }),
    ).rejects.toBeInstanceOf(BadDataException);
  });
});

/*
 * A connection made by signing in creates the same meeting with the
 * sign-in's own token, as the signed-in account: Zoom's "me", Google's
 * space, Microsoft Graph's /me. Nothing of the app credentials is read.
 */
describe("VideoCallMeetingFactory with a sign-in", () => {
  const signIn: (accessToken: string) => VideoCallOAuthAccess = (
    accessToken: string,
  ): VideoCallOAuthAccess => {
    return {
      accountLabel: "incidents@acme.com",
      getAccessToken: async (): Promise<VideoCallOAuthAccessToken> => {
        return {
          accessToken,
          apiBaseUrl: "https://api.zoom.us/v2",
        };
      },
    };
  };

  test("creates the signed-in Zoom user's own meeting", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 201, body: { id: 7, join_url: "https://zoom.us/j/7" } },
    ]);

    const meeting: VideoCallMeeting =
      await VideoCallMeetingFactory.createMeeting({
        settings: {
          provider: VideoCallProvider.Zoom,
          config: {},
          secrets: {},
          authMethod: VideoCallAuthMethod.OAuth,
        },
        request: { title: "INC-1" },
        http: new VideoCallHttpClient({ fetchImplementation: fetcher.fetch }),
        oauth: signIn("zoom-user-token"),
      });

    expect(meeting.joinUrl).toBe("https://zoom.us/j/7");
    expect(fetcher.requests).toHaveLength(1);
    expect(fetcher.requests[0]!.url).toBe(
      "https://api.zoom.us/v2/users/me/meetings",
    );
    expect(fetcher.requests[0]!.init.headers["Authorization"]).toBe(
      "Bearer zoom-user-token",
    );
  });

  test("creates a Google Meet space as the signed-in account, with who can join", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      {
        status: 200,
        body: {
          name: "spaces/abc",
          meetingUri: "https://meet.google.com/abc-defg-hij",
        },
      },
    ]);

    const meeting: VideoCallMeeting =
      await VideoCallMeetingFactory.createMeeting({
        settings: {
          provider: VideoCallProvider.GoogleMeet,
          config: { accessType: "OPEN" },
          secrets: {},
          authMethod: VideoCallAuthMethod.OAuth,
        },
        request: { title: "INC-1" },
        http: new VideoCallHttpClient({ fetchImplementation: fetcher.fetch }),
        oauth: signIn("google-user-token"),
      });

    expect(meeting.joinUrl).toBe("https://meet.google.com/abc-defg-hij");
    expect(fetcher.requests[0]!.init.headers["Authorization"]).toBe(
      "Bearer google-user-token",
    );
    expect(JSON.parse(fetcher.requests[0]!.init.body!)).toEqual({
      config: { accessType: "OPEN", entryPointAccess: "ALL" },
    });
  });

  test("passes record and transcribe on to the signed-in account's Google Meet space", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      {
        status: 200,
        body: {
          name: "spaces/abc",
          meetingUri: "https://meet.google.com/abc-defg-hij",
        },
      },
    ]);

    await VideoCallMeetingFactory.createMeeting({
      settings: {
        provider: VideoCallProvider.GoogleMeet,
        config: { accessType: "TRUSTED" },
        secrets: {},
        authMethod: VideoCallAuthMethod.OAuth,
      },
      request: { title: "INC-1", recordAndTranscribe: true },
      http: new VideoCallHttpClient({ fetchImplementation: fetcher.fetch }),
      oauth: signIn("google-user-token"),
    });

    expect(JSON.parse(fetcher.requests[0]!.init.body!)).toEqual({
      config: {
        accessType: "TRUSTED",
        entryPointAccess: "ALL",
        artifactConfig: {
          transcriptionConfig: { autoTranscriptionGeneration: "ON" },
        },
      },
    });
  });

  test("passes record and transcribe on to the signed-in Zoom user's meeting", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 201, body: { id: 7, join_url: "https://zoom.us/j/7" } },
    ]);

    await VideoCallMeetingFactory.createMeeting({
      settings: {
        provider: VideoCallProvider.Zoom,
        config: {},
        secrets: {},
        authMethod: VideoCallAuthMethod.OAuth,
      },
      request: { title: "INC-1", recordAndTranscribe: true },
      http: new VideoCallHttpClient({ fetchImplementation: fetcher.fetch }),
      oauth: signIn("zoom-user-token"),
    });

    expect(
      (JSON.parse(fetcher.requests[0]!.init.body!) as JSONObject)["settings"],
    ).toEqual(expect.objectContaining({ auto_recording: "cloud" }));
  });

  /*
   * A Teams meeting asked to record and transcribe goes on its organizer's
   * calendar - Graph keeps transcripts only of meetings on a calendar - and
   * records itself (MicrosoftTeamsMeetingClient).
   */
  const TEAMS_JOIN_URL: string =
    "https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0";

  const TEAMS_RECORDED_MEETING: Array<{ status: number; body: JSONObject }> = [
    {
      status: 201,
      body: { id: "event-1", onlineMeeting: { joinUrl: TEAMS_JOIN_URL } },
    },
    { status: 200, body: { value: [{ id: "meeting-1" }] } },
    { status: 200, body: { id: "meeting-1", recordAutomatically: true } },
  ];

  test("a signed-in Teams account asked to record: the meeting goes on its own calendar, and records itself", async () => {
    const fetcher: ScriptedFetch = scriptedFetch(TEAMS_RECORDED_MEETING);

    const meeting: VideoCallMeeting =
      await VideoCallMeetingFactory.createMeeting({
        settings: {
          provider: VideoCallProvider.MicrosoftTeams,
          config: { lobbyBypass: "organization" },
          secrets: {},
          authMethod: VideoCallAuthMethod.OAuth,
        },
        request: { title: "INC-1", recordAndTranscribe: true },
        http: new VideoCallHttpClient({ fetchImplementation: fetcher.fetch }),
        oauth: signIn("graph-user-token"),
      });

    expect(fetcher.requests[0]!.url).toBe(
      "https://graph.microsoft.com/v1.0/me/events",
    );
    expect(fetcher.requests[0]!.init.headers["Authorization"]).toBe(
      "Bearer graph-user-token",
    );
    expect(fetcher.requests[2]!.url).toBe(
      "https://graph.microsoft.com/v1.0/me/onlineMeetings/meeting-1",
    );
    expect(JSON.parse(fetcher.requests[2]!.init.body!) as JSONObject).toEqual(
      expect.objectContaining({
        recordAutomatically: true,
        allowTranscription: true,
        lobbyBypassSettings: {
          scope: "organization",
          isDialInBypassEnabled: true,
        },
      }),
    );
    expect(meeting).toEqual({
      provider: VideoCallProvider.MicrosoftTeams,
      joinUrl: TEAMS_JOIN_URL,
      externalMeetingId: "meeting-1",
      externalCalendarEventId: "event-1",
    });
  });

  test("an app registration asked to record: its organizer's calendar, with the app's own token", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: { access_token: "app-token" } },
      ...TEAMS_RECORDED_MEETING,
    ]);

    const meeting: VideoCallMeeting =
      await VideoCallMeetingFactory.createMeeting({
        settings: {
          provider: VideoCallProvider.MicrosoftTeams,
          config: {
            tenantId: "11111111-2222-3333-4444-555555555555",
            clientId: "client",
            organizerUserId: " 99999999-8888-7777-6666-555555555555 ",
            lobbyBypass: "everyone",
          },
          secrets: { clientSecret: "secret" },
        },
        request: { title: "INC-1", recordAndTranscribe: true },
        http: new VideoCallHttpClient({ fetchImplementation: fetcher.fetch }),
      });

    expect(fetcher.requests[1]!.url).toBe(
      "https://graph.microsoft.com/v1.0/users/99999999-8888-7777-6666-555555555555/events",
    );
    expect(fetcher.requests[1]!.init.headers["Authorization"]).toBe(
      "Bearer app-token",
    );
    expect(meeting.externalCalendarEventId).toBe("event-1");
  });

  test("creates the signed-in account's own Teams meeting, with no access policy involved", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      {
        status: 201,
        body: {
          id: "m",
          joinWebUrl: "https://teams.microsoft.com/l/meetup-join/x",
        },
      },
    ]);

    await VideoCallMeetingFactory.createMeeting({
      settings: {
        provider: VideoCallProvider.MicrosoftTeams,
        config: { lobbyBypass: "everyone" },
        secrets: {},
        authMethod: VideoCallAuthMethod.OAuth,
      },
      request: { title: "INC-1" },
      http: new VideoCallHttpClient({ fetchImplementation: fetcher.fetch }),
      oauth: signIn("graph-user-token"),
    });

    expect(fetcher.requests[0]!.url).toBe(
      "https://graph.microsoft.com/v1.0/me/onlineMeetings",
    );
    expect(
      (JSON.parse(fetcher.requests[0]!.init.body!) as JSONObject)[
        "lobbyBypassSettings"
      ],
    ).toEqual({ scope: "everyone", isDialInBypassEnabled: true });
    // Not asked to record: one meeting, nothing on a calendar, nothing recording.
    expect(fetcher.requests).toHaveLength(1);
    expect(
      JSON.parse(fetcher.requests[0]!.init.body!) as JSONObject,
    ).not.toHaveProperty("recordAutomatically");
  });

  test("a refusal at meeting time names the account and says to reconnect", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 401, body: { code: 124, message: "Invalid access token." } },
    ]);

    await expect(
      VideoCallMeetingFactory.createMeeting({
        settings: {
          provider: VideoCallProvider.Zoom,
          config: {},
          secrets: {},
          authMethod: VideoCallAuthMethod.OAuth,
        },
        request: { title: "INC-1" },
        http: new VideoCallHttpClient({ fetchImplementation: fetcher.fetch }),
        oauth: signIn("t"),
      }),
    ).rejects.toThrow(
      "Zoom no longer accepts OneUptime's sign-in for incidents@acme.com",
    );
  });

  test("a connection made by signing in with no sign-in to use says to reconnect", async () => {
    await expect(
      VideoCallMeetingFactory.createMeeting({
        settings: {
          provider: VideoCallProvider.Zoom,
          config: {},
          secrets: {},
          authMethod: VideoCallAuthMethod.OAuth,
        },
        request: { title: "INC-1" },
      }),
    ).rejects.toThrow("Reconnect Zoom");
  });
});
