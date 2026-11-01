import MicrosoftTeamsMeetingClient, {
  MICROSOFT_TEAMS_MEETING_LOOKUP_ATTEMPTS,
  MICROSOFT_TEAMS_MEETING_LOOKUP_DELAY_IN_MS,
} from "../../../../Server/Utils/VideoCall/Providers/MicrosoftTeamsMeetingClient";
import VideoCallHttpClient, {
  VideoCallFetch,
  VideoCallFetchInit,
  VideoCallFetchResponse,
} from "../../../../Server/Utils/VideoCall/VideoCallHttpClient";
import { VideoCallMeetingRequest } from "../../../../Server/Utils/VideoCall/VideoCallMeetingRequest";
import APIException from "../../../../Types/Exception/ApiException";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import VideoCallMeeting from "../../../../Types/VideoCall/VideoCallMeeting";
import VideoCallProvider from "../../../../Types/VideoCall/VideoCallProvider";
import { VideoCallTranscriptUnavailableReason } from "../../../../Types/VideoCall/VideoCallTranscript";
import {
  ScriptedFetch,
  ScriptedResponse,
  readJsonBody,
  scriptedFetch,
} from "./VideoCallTestFetch";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * Record and transcribe incident calls, for Microsoft Teams. Graph lets
 * apps read the transcripts only of meetings on a calendar, so a meeting
 * that records itself is made as an event on the organizer's calendar that
 * is a Teams meeting: the event, its online meeting found by the join
 * link, and the meeting's options with Record and transcribe automatically
 * on. Whatever of that Graph refuses, the call starts all the same - as the
 * usual meeting, saying why it is not recorded - and any event made on the
 * way is taken back.
 */

const TENANT_ID: string = "11111111-2222-3333-4444-555555555555";
const CLIENT_ID: string = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const ORGANIZER_ID: string = "99999999-8888-7777-6666-555555555555";

// Microsoft Graph of the commercial cloud, where no MICROSOFT_TEAMS_CLOUD is set.
const MICROSOFT_GRAPH_BASE_URL: string = "https://graph.microsoft.com/v1.0";
const GRAPH_ORGANIZER: string = `${MICROSOFT_GRAPH_BASE_URL}/users/${ORGANIZER_ID}`;

// Graph's ids are base64: their "=" and "/" are sent encoded.
const EVENT_ID: string = "AAMkAGI2TG93AAA/BgAAAAAAa+1=";
const MEETING_ID: string = "MSpkYzE3Njc0Yy04MWQ5LTRhZGItYmZi==";

const JOIN_URL: string =
  "https://teams.microsoft.com/l/meetup-join/19%3ameeting_NzIyNzhl%40thread.v2/0?context=%7b%22Tid%22%3a%22x%22%7d";

const PLAIN_MEETING_RESPONSE: JSONObject = {
  id: "plain-meeting-id",
  joinWebUrl:
    "https://teams.microsoft.com/l/meetup-join/19%3ameeting_plain%40thread.v2/0",
};

const TOKEN: ScriptedResponse = {
  status: 200,
  body: { token_type: "Bearer", expires_in: 3599, access_token: "graph-token" },
};

const EVENT_CREATED: ScriptedResponse = {
  status: 201,
  body: {
    id: EVENT_ID,
    subject: "INC-42: Checkout API is down",
    isOnlineMeeting: true,
    onlineMeetingProvider: "teamsForBusiness",
    onlineMeeting: { joinUrl: JOIN_URL },
  },
};

const MEETING_FOUND: ScriptedResponse = {
  status: 200,
  body: { value: [{ id: MEETING_ID, joinWebUrl: JOIN_URL }] },
};

const MEETING_NOT_FOUND_YET: ScriptedResponse = {
  status: 200,
  body: { value: [] },
};

const OPTIONS_SET: ScriptedResponse = {
  status: 200,
  body: { id: MEETING_ID, joinWebUrl: JOIN_URL, recordAutomatically: true },
};

const EVENT_DELETED: ScriptedResponse = { status: 204, body: "" };

const PLAIN_MEETING_CREATED: ScriptedResponse = {
  status: 201,
  body: PLAIN_MEETING_RESPONSE,
};

const START_TIME: Date = new Date("2026-10-19T08:30:00.000Z");

const DESCRIPTION: string =
  "OneUptime incident INC-42: Checkout API is down. https://oneuptime.com/dashboard/p/incidents/42";

function recordedRequest(
  overrides: Partial<VideoCallMeetingRequest> = {},
): VideoCallMeetingRequest {
  return {
    title: "INC-42: Checkout API is down",
    description: DESCRIPTION,
    startTime: START_TIME,
    recordAndTranscribe: true,
    ...overrides,
  };
}

function newClient(
  fetch: VideoCallFetch,
  lobbyBypass: string = "everyone",
): MicrosoftTeamsMeetingClient {
  return new MicrosoftTeamsMeetingClient(
    {
      tenantId: TENANT_ID,
      clientId: CLIENT_ID,
      clientSecret: "client~secret.value",
      organizerUserId: ORGANIZER_ID,
      lobbyBypass,
    },
    new VideoCallHttpClient({ fetchImplementation: fetch }),
  );
}

function graphError(
  status: number,
  code: string,
  message: string,
): ScriptedResponse {
  return { status, body: { error: { code, message } } };
}

function urlsOf(fetcher: ScriptedFetch): Array<string> {
  return fetcher.requests.map((request: { url: string }): string => {
    return request.url;
  });
}

function methodsOf(fetcher: ScriptedFetch): Array<string> {
  return fetcher.requests.map(
    (request: { init: VideoCallFetchInit }): string => {
      return request.init.method;
    },
  );
}

const LOOKUP_URL: string = `${GRAPH_ORGANIZER}/onlineMeetings?$filter=${encodeURIComponent(`JoinWebUrl eq '${JOIN_URL}'`)}`;

let waitBeforeLookingAgain: Mock<(delayInMs: number) => Promise<void>>;

beforeEach(() => {
  waitBeforeLookingAgain = jest
    .spyOn(MicrosoftTeamsMeetingClient, "waitBeforeLookingAgain")
    .mockResolvedValue(undefined) as unknown as Mock<
    (delayInMs: number) => Promise<void>
  >;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MicrosoftTeamsMeetingClient - a meeting that records and transcribes itself", () => {
  test("puts the meeting on the organizer's calendar, as a Teams meeting that says what it is for", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      TOKEN,
      EVENT_CREATED,
      MEETING_FOUND,
      OPTIONS_SET,
    ]);

    await newClient(fetcher.fetch).createMeeting(recordedRequest());

    const event: (typeof fetcher.requests)[number] = fetcher.requests[1]!;
    expect(event.url).toBe(`${GRAPH_ORGANIZER}/events`);
    expect(event.init.method).toBe("POST");
    expect(event.init.headers).toEqual({
      Authorization: "Bearer graph-token",
      "Content-Type": "application/json",
      Accept: "application/json",
    });
    expect(readJsonBody(event)).toEqual({
      subject: "INC-42: Checkout API is down",
      body: { contentType: "text", content: DESCRIPTION },
      start: { dateTime: "2026-10-19T08:30:00", timeZone: "UTC" },
      end: { dateTime: "2026-10-19T09:30:00", timeZone: "UTC" },
      isOnlineMeeting: true,
      onlineMeetingProvider: "teamsForBusiness",
      allowNewTimeProposals: false,
      isReminderOn: false,
    });
  });

  test("finds the event's online meeting by its join link, quoted and encoded as Graph asks", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      TOKEN,
      EVENT_CREATED,
      MEETING_FOUND,
      OPTIONS_SET,
    ]);

    await newClient(fetcher.fetch).createMeeting(recordedRequest());

    const lookup: (typeof fetcher.requests)[number] = fetcher.requests[2]!;
    expect(lookup.init.method).toBe("GET");
    expect(lookup.url).toBe(LOOKUP_URL);
    // Decoded once, the filter holds the join link exactly as Graph wrote it.
    expect(new URL(lookup.url).searchParams.get("$filter")).toBe(
      `JoinWebUrl eq '${JOIN_URL}'`,
    );
    expect(lookup.init.headers["Authorization"]).toBe("Bearer graph-token");
  });

  test("turns on Record and transcribe automatically, with every incident meeting's lobby and presenters", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      TOKEN,
      EVENT_CREATED,
      MEETING_FOUND,
      OPTIONS_SET,
    ]);

    await newClient(fetcher.fetch).createMeeting(recordedRequest());

    const options: (typeof fetcher.requests)[number] = fetcher.requests[3]!;
    expect(options.url).toBe(
      `${GRAPH_ORGANIZER}/onlineMeetings/${encodeURIComponent(MEETING_ID)}`,
    );
    expect(options.init.method).toBe("PATCH");
    expect(options.init.headers["Content-Type"]).toBe("application/json");
    expect(readJsonBody(options)).toEqual({
      allowedPresenters: "everyone",
      lobbyBypassSettings: { scope: "everyone", isDialInBypassEnabled: true },
      allowRecording: true,
      allowTranscription: true,
      recordAutomatically: true,
    });
  });

  test("returns the meeting with its calendar event, recorded: four requests, no other meeting", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      TOKEN,
      EVENT_CREATED,
      MEETING_FOUND,
      OPTIONS_SET,
    ]);

    const meeting: VideoCallMeeting = await newClient(
      fetcher.fetch,
    ).createMeeting(recordedRequest());

    expect(meeting).toEqual({
      provider: VideoCallProvider.MicrosoftTeams,
      joinUrl: JOIN_URL,
      externalMeetingId: MEETING_ID,
      externalCalendarEventId: EVENT_ID,
    });
    expect(methodsOf(fetcher)).toEqual(["POST", "POST", "GET", "PATCH"]);
    expect(urlsOf(fetcher)).not.toContain(`${GRAPH_ORGANIZER}/onlineMeetings`);
    expect(waitBeforeLookingAgain).not.toHaveBeenCalled();
  });

  test("a signed-in organizer's meeting goes on their own calendar, as /me", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      EVENT_CREATED,
      MEETING_FOUND,
      OPTIONS_SET,
    ]);

    const meeting: VideoCallMeeting =
      await MicrosoftTeamsMeetingClient.createMeetingWithToken({
        http: new VideoCallHttpClient({ fetchImplementation: fetcher.fetch }),
        accessToken: "user-token",
        organizer: { path: "/me", label: "incidents@acme.com", isSignIn: true },
        lobbyBypass: "organization",
        request: recordedRequest(),
      });

    expect(urlsOf(fetcher)).toEqual([
      `${MICROSOFT_GRAPH_BASE_URL}/me/events`,
      `${MICROSOFT_GRAPH_BASE_URL}/me/onlineMeetings?$filter=${encodeURIComponent(`JoinWebUrl eq '${JOIN_URL}'`)}`,
      `${MICROSOFT_GRAPH_BASE_URL}/me/onlineMeetings/${encodeURIComponent(MEETING_ID)}`,
    ]);
    expect(fetcher.requests[0]!.init.headers["Authorization"]).toBe(
      "Bearer user-token",
    );
    expect(
      (readJsonBody(fetcher.requests[2]!)["lobbyBypassSettings"] as JSONObject)[
        "scope"
      ],
    ).toBe("organization");
    expect(meeting.externalCalendarEventId).toBe(EVENT_ID);
    expect(meeting.notRecorded).toBeUndefined();
  });

  test("a meeting with no description has no event body, and starts now when no time is given", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      TOKEN,
      EVENT_CREATED,
      MEETING_FOUND,
      OPTIONS_SET,
    ]);
    const before: number = Date.now();

    await newClient(fetcher.fetch).createMeeting(
      recordedRequest({ description: "   ", startTime: undefined }),
    );

    const event: JSONObject = readJsonBody(fetcher.requests[1]!);
    expect(event["body"]).toBeUndefined();

    const start: number = Date.parse(
      `${(event["start"] as JSONObject)["dateTime"] as string}Z`,
    );
    const end: number = Date.parse(
      `${(event["end"] as JSONObject)["dateTime"] as string}Z`,
    );
    // Whole seconds: the event's start is now, give or take the second it was cut to.
    expect(start).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
    expect(start).toBeLessThanOrEqual(Date.now());
    expect(end - start).toBe(60 * 60 * 1000);
  });

  test("a long title is cut for the calendar as for any meeting, and a missing one named", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      TOKEN,
      EVENT_CREATED,
      MEETING_FOUND,
      OPTIONS_SET,
      TOKEN,
      EVENT_CREATED,
      MEETING_FOUND,
      OPTIONS_SET,
    ]);

    await newClient(fetcher.fetch).createMeeting(
      recordedRequest({ title: `INC-42: ${"x".repeat(400)}` }),
    );
    await newClient(fetcher.fetch).createMeeting(
      recordedRequest({ title: "  " }),
    );

    const subject: string = readJsonBody(fetcher.requests[1]!)[
      "subject"
    ] as string;
    expect(subject).toHaveLength(255);
    expect(subject.endsWith("…")).toBe(true);
    expect(readJsonBody(fetcher.requests[5]!)["subject"]).toBe("Incident call");
  });

  test("any lobby value Graph is not given here is the organization's", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      TOKEN,
      EVENT_CREATED,
      MEETING_FOUND,
      OPTIONS_SET,
    ]);

    await newClient(fetcher.fetch, "organizer").createMeeting(
      recordedRequest(),
    );

    expect(readJsonBody(fetcher.requests[3]!)["lobbyBypassSettings"]).toEqual({
      scope: "organization",
      isDialInBypassEnabled: true,
    });
  });

  test("a quote in the join link is doubled, as OData quotes a string", async () => {
    const joinUrl: string =
      "https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0?context=it's";
    const fetcher: ScriptedFetch = scriptedFetch([
      TOKEN,
      { status: 201, body: { id: EVENT_ID, onlineMeeting: { joinUrl } } },
      MEETING_FOUND,
      OPTIONS_SET,
    ]);

    const meeting: VideoCallMeeting = await newClient(
      fetcher.fetch,
    ).createMeeting(recordedRequest());

    expect(new URL(fetcher.requests[2]!.url).searchParams.get("$filter")).toBe(
      "JoinWebUrl eq 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0?context=it''s'",
    );
    expect(meeting.joinUrl).toBe(joinUrl);
  });

  test("looks again while Graph does not have the new event's meeting yet, waiting longer each time", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      TOKEN,
      EVENT_CREATED,
      MEETING_NOT_FOUND_YET,
      { status: 200, body: { value: [{ joinWebUrl: JOIN_URL }] } },
      MEETING_FOUND,
      OPTIONS_SET,
    ]);

    const meeting: VideoCallMeeting = await newClient(
      fetcher.fetch,
    ).createMeeting(recordedRequest());

    expect(MICROSOFT_TEAMS_MEETING_LOOKUP_ATTEMPTS).toBe(3);
    expect(
      urlsOf(fetcher).filter((url: string): boolean => {
        return url === LOOKUP_URL;
      }),
    ).toHaveLength(3);
    expect(waitBeforeLookingAgain.mock.calls).toEqual([
      [MICROSOFT_TEAMS_MEETING_LOOKUP_DELAY_IN_MS],
      [MICROSOFT_TEAMS_MEETING_LOOKUP_DELAY_IN_MS * 2],
    ]);
    expect(meeting.externalMeetingId).toBe(MEETING_ID);
    expect(meeting.notRecorded).toBeUndefined();
  });

  test("not asked to record: the usual online meeting, nothing on a calendar", async () => {
    for (const recordAndTranscribe of [false, undefined]) {
      const fetcher: ScriptedFetch = scriptedFetch([
        TOKEN,
        PLAIN_MEETING_CREATED,
      ]);

      const meeting: VideoCallMeeting = await newClient(
        fetcher.fetch,
      ).createMeeting(recordedRequest({ recordAndTranscribe }));

      expect(urlsOf(fetcher)[1]).toBe(`${GRAPH_ORGANIZER}/onlineMeetings`);
      expect(meeting).toEqual({
        provider: VideoCallProvider.MicrosoftTeams,
        joinUrl: PLAIN_MEETING_RESPONSE["joinWebUrl"],
        externalMeetingId: PLAIN_MEETING_RESPONSE["id"],
      });
    }
  });

  test("waits for real between looks", async () => {
    waitBeforeLookingAgain.mockRestore();
    jest.useFakeTimers();

    try {
      let waited: boolean = false;
      const wait: Promise<void> =
        MicrosoftTeamsMeetingClient.waitBeforeLookingAgain(1000).then(() => {
          waited = true;
        });

      jest.advanceTimersByTime(999);
      await Promise.resolve();
      expect(waited).toBe(false);

      jest.advanceTimersByTime(1);
      await wait;
      expect(waited).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("MicrosoftTeamsMeetingClient - when Graph says no, the call starts unrecorded and says why", () => {
  function expectPlainMeeting(
    meeting: VideoCallMeeting,
    reason: VideoCallTranscriptUnavailableReason,
    message: RegExp,
  ): void {
    expect(meeting).toEqual({
      provider: VideoCallProvider.MicrosoftTeams,
      joinUrl: PLAIN_MEETING_RESPONSE["joinWebUrl"],
      externalMeetingId: PLAIN_MEETING_RESPONSE["id"],
      notRecorded: { reason, message: expect.stringMatching(message) },
    });
  }

  test("an app without the calendar permission: the usual meeting, and the two permissions to add", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      TOKEN,
      graphError(
        403,
        "ErrorAccessDenied",
        "Access is denied. Check credentials and try again.",
      ),
      PLAIN_MEETING_CREATED,
    ]);

    const meeting: VideoCallMeeting = await newClient(
      fetcher.fetch,
    ).createMeeting(recordedRequest());

    expectPlainMeeting(
      meeting,
      VideoCallTranscriptUnavailableReason.PermissionMissing,
      /did not let the app put the meeting on the organizer's calendar\. Check that the app registration has the Calendars\.ReadWrite and OnlineMeetingTranscript\.Read\.All application permissions.*Access is denied/,
    );
    // Nothing was made on the calendar, so nothing is taken back.
    expect(methodsOf(fetcher)).toEqual(["POST", "POST", "POST"]);
    expect(urlsOf(fetcher)[2]).toBe(`${GRAPH_ORGANIZER}/onlineMeetings`);
    expect(readJsonBody(fetcher.requests[2]!)).toEqual({
      subject: "INC-42: Checkout API is down",
      startDateTime: "2026-10-19T08:30:00.000Z",
      endDateTime: "2026-10-19T09:30:00.000Z",
      allowedPresenters: "everyone",
      lobbyBypassSettings: { scope: "everyone", isDialInBypassEnabled: true },
      joinMeetingIdSettings: { isPasscodeRequired: false },
    });
  });

  test("a sign-in without the calendar permission: Reconnect while recording is on", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      graphError(401, "InvalidAuthenticationToken", "Access token is empty."),
      PLAIN_MEETING_CREATED,
    ]);

    const meeting: VideoCallMeeting =
      await MicrosoftTeamsMeetingClient.createMeetingWithToken({
        http: new VideoCallHttpClient({ fetchImplementation: fetcher.fetch }),
        accessToken: "user-token",
        organizer: { path: "/me", label: "incidents@acme.com", isSignIn: true },
        lobbyBypass: "organization",
        request: recordedRequest(),
      });

    expect(urlsOf(fetcher)).toEqual([
      `${MICROSOFT_GRAPH_BASE_URL}/me/events`,
      `${MICROSOFT_GRAPH_BASE_URL}/me/onlineMeetings`,
    ]);
    expectPlainMeeting(
      meeting,
      VideoCallTranscriptUnavailableReason.PermissionMissing,
      /sign-in for incidents@acme\.com put the meeting on the organizer's calendar\. Reconnect Microsoft Teams .* while Record and transcribe incident calls is on/,
    );
  });

  test("an organizer without a mailbox: not something a permission fixes", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      TOKEN,
      graphError(
        404,
        "MailboxNotEnabledForRESTAPI",
        "The mailbox is either inactive, soft-deleted, or is hosted on-premise.",
      ),
      PLAIN_MEETING_CREATED,
    ]);

    const meeting: VideoCallMeeting = await newClient(
      fetcher.fetch,
    ).createMeeting(recordedRequest());

    expectPlainMeeting(
      meeting,
      VideoCallTranscriptUnavailableReason.NotSupported,
      /could not put the meeting on the organizer's calendar \(HTTP 404\): The mailbox is either inactive/,
    );
  });

  test("an event that did not become a Teams meeting is taken back", async () => {
    for (const onlineMeeting of [
      null,
      {},
      { joinUrl: "https://evil.example.com/l/meetup-join/x" },
    ]) {
      const fetcher: ScriptedFetch = scriptedFetch([
        TOKEN,
        { status: 201, body: { id: EVENT_ID, onlineMeeting } },
        EVENT_DELETED,
        PLAIN_MEETING_CREATED,
      ]);

      const meeting: VideoCallMeeting = await newClient(
        fetcher.fetch,
      ).createMeeting(recordedRequest());

      expectPlainMeeting(
        meeting,
        VideoCallTranscriptUnavailableReason.NotSupported,
        new RegExp(
          `did not make the event a Microsoft Teams meeting\\. Check that ${ORGANIZER_ID} has a Microsoft Teams license`,
        ),
      );
      expect(fetcher.requests[2]!.init.method).toBe("DELETE");
      expect(fetcher.requests[2]!.url).toBe(
        `${GRAPH_ORGANIZER}/events/${encodeURIComponent(EVENT_ID)}`,
      );
      expect(fetcher.requests[2]!.init.headers).toEqual({
        Authorization: "Bearer graph-token",
      });
    }
  });

  test("an event Graph returned no id for: nothing to take back", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      TOKEN,
      { status: 201, body: { onlineMeeting: { joinUrl: JOIN_URL } } },
      PLAIN_MEETING_CREATED,
    ]);

    const meeting: VideoCallMeeting = await newClient(
      fetcher.fetch,
    ).createMeeting(recordedRequest());

    expectPlainMeeting(
      meeting,
      VideoCallTranscriptUnavailableReason.NotSupported,
      /returned no event for it/,
    );
    expect(methodsOf(fetcher)).toEqual(["POST", "POST", "POST"]);
  });

  test("a meeting Graph never finds: the event is taken back after the last look", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      TOKEN,
      EVENT_CREATED,
      MEETING_NOT_FOUND_YET,
      MEETING_NOT_FOUND_YET,
      MEETING_NOT_FOUND_YET,
      EVENT_DELETED,
      PLAIN_MEETING_CREATED,
    ]);

    const meeting: VideoCallMeeting = await newClient(
      fetcher.fetch,
    ).createMeeting(recordedRequest());

    expectPlainMeeting(
      meeting,
      VideoCallTranscriptUnavailableReason.NotSupported,
      /did not find the Teams meeting of the calendar event it had just created/,
    );
    expect(methodsOf(fetcher)).toEqual([
      "POST",
      "POST",
      "GET",
      "GET",
      "GET",
      "DELETE",
      "POST",
    ]);
    expect(waitBeforeLookingAgain).toHaveBeenCalledTimes(2);
  });

  test("a lookup Graph refuses: the event is taken back, and the permissions named", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      TOKEN,
      EVENT_CREATED,
      graphError(
        403,
        "Forbidden",
        "No application access policy found for this app.",
      ),
      EVENT_DELETED,
      PLAIN_MEETING_CREATED,
    ]);

    const meeting: VideoCallMeeting = await newClient(
      fetcher.fetch,
    ).createMeeting(recordedRequest());

    expectPlainMeeting(
      meeting,
      VideoCallTranscriptUnavailableReason.PermissionMissing,
      /did not let the app find the Teams meeting of the calendar event/,
    );
    expect(methodsOf(fetcher)).toEqual([
      "POST",
      "POST",
      "GET",
      "DELETE",
      "POST",
    ]);
  });

  test("options Graph refuses: the event is taken back, in Graph's words", async () => {
    const refused: Array<
      [ScriptedResponse, VideoCallTranscriptUnavailableReason, RegExp]
    > = [
      [
        graphError(
          400,
          "BadRequest",
          "Automatic recording is not allowed by the organizer's policy.",
        ),
        VideoCallTranscriptUnavailableReason.NotSupported,
        /could not turn on recording and transcription for the meeting \(HTTP 400\): Automatic recording is not allowed/,
      ],
      [
        graphError(403, "Forbidden", "Insufficient privileges."),
        VideoCallTranscriptUnavailableReason.PermissionMissing,
        /did not let the app turn on recording and transcription for the meeting/,
      ],
    ];

    for (const [response, reason, message] of refused) {
      const fetcher: ScriptedFetch = scriptedFetch([
        TOKEN,
        EVENT_CREATED,
        MEETING_FOUND,
        response,
        EVENT_DELETED,
        PLAIN_MEETING_CREATED,
      ]);

      const meeting: VideoCallMeeting = await newClient(
        fetcher.fetch,
      ).createMeeting(recordedRequest());

      expectPlainMeeting(meeting, reason, message);
      expect(methodsOf(fetcher)).toEqual([
        "POST",
        "POST",
        "GET",
        "PATCH",
        "DELETE",
        "POST",
      ]);
    }
  });

  test("an event that cannot be taken back does not stop the call", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      TOKEN,
      EVENT_CREATED,
      graphError(400, "BadRequest", "Nope."),
      graphError(500, "InternalServerError", "Delete failed."),
      PLAIN_MEETING_CREATED,
    ]);

    const meeting: VideoCallMeeting = await newClient(
      fetcher.fetch,
    ).createMeeting(recordedRequest());

    expect(meeting.externalMeetingId).toBe(PLAIN_MEETING_RESPONSE["id"]);
    expect(meeting.notRecorded?.reason).toBe(
      VideoCallTranscriptUnavailableReason.NotSupported,
    );
  });

  test("Graph not answering at all, at any step: the usual meeting all the same", async () => {
    // The step whose request never completes, and what Graph answers to the rest.
    const scenarios: Array<{
      failsAt: (url: string, init: VideoCallFetchInit) => boolean;
      script: Array<ScriptedResponse>;
      requests: Array<string>;
      message: RegExp;
    }> = [
      {
        // The event: nothing was made, nothing to take back.
        failsAt: (url: string): boolean => {
          return url.endsWith("/events");
        },
        script: [TOKEN, PLAIN_MEETING_CREATED],
        requests: ["POST", "POST", "POST"],
        message:
          /did not answer while OneUptime put the meeting on the organizer's calendar: .*socket hang up/,
      },
      {
        // The lookup: the event is taken back.
        failsAt: (url: string): boolean => {
          return url.includes("?$filter=");
        },
        script: [TOKEN, EVENT_CREATED, EVENT_DELETED, PLAIN_MEETING_CREATED],
        requests: ["POST", "POST", "GET", "DELETE", "POST"],
        message: /did not answer/,
      },
      {
        // Taking the event back, after Graph refused the options.
        failsAt: (_url: string, init: VideoCallFetchInit): boolean => {
          return init.method === "DELETE";
        },
        script: [
          TOKEN,
          EVENT_CREATED,
          MEETING_FOUND,
          graphError(400, "BadRequest", "Nope."),
          PLAIN_MEETING_CREATED,
        ],
        requests: ["POST", "POST", "GET", "PATCH", "DELETE", "POST"],
        message: /could not turn on recording and transcription/,
      },
    ];

    for (const scenario of scenarios) {
      const fetcher: ScriptedFetch = scriptedFetch(scenario.script);
      const methods: Array<string> = [];

      const fetch: VideoCallFetch = async (
        url: string,
        init: VideoCallFetchInit,
      ): Promise<VideoCallFetchResponse> => {
        methods.push(init.method);

        if (scenario.failsAt(url, init)) {
          throw new Error("socket hang up");
        }

        return await fetcher.fetch(url, init);
      };

      const meeting: VideoCallMeeting =
        await newClient(fetch).createMeeting(recordedRequest());

      expect(methods).toEqual(scenario.requests);
      expect(meeting).toEqual({
        provider: VideoCallProvider.MicrosoftTeams,
        joinUrl: PLAIN_MEETING_RESPONSE["joinWebUrl"],
        externalMeetingId: PLAIN_MEETING_RESPONSE["id"],
        notRecorded: {
          reason: VideoCallTranscriptUnavailableReason.NotSupported,
          message: expect.stringMatching(scenario.message),
        },
      });
    }
  });

  test("when the usual meeting cannot be made either, the call fails with that meeting's own error", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      TOKEN,
      graphError(403, "ErrorAccessDenied", "Access is denied."),
      graphError(
        403,
        "Forbidden",
        "No application access policy found for this app",
      ),
    ]);

    const error: unknown = await newClient(fetcher.fetch)
      .createMeeting(recordedRequest())
      .catch((caught: unknown) => {
        return caught;
      });

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toContain(
      `New-CsApplicationAccessPolicy -Identity OneUptime-Meetings -AppIds "${CLIENT_ID}"`,
    );
  });

  test("a Graph outage on the usual meeting is still the provider failing", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      TOKEN,
      graphError(503, "ServiceUnavailable", "Try later."),
      graphError(503, "ServiceUnavailable", "Try later."),
    ]);

    await expect(
      newClient(fetcher.fetch).createMeeting(recordedRequest()),
    ).rejects.toBeInstanceOf(APIException);
  });
});
