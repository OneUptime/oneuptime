import ZoomMeetingClient, {
  ZOOM_API_BASE_URL,
  ZOOM_TOKEN_URL,
} from "../../../../Server/Utils/VideoCall/Providers/ZoomMeetingClient";
import VideoCallHttpClient from "../../../../Server/Utils/VideoCall/VideoCallHttpClient";
import BadDataException from "../../../../Types/Exception/BadDataException";
import APIException from "../../../../Types/Exception/ApiException";
import { JSONObject } from "../../../../Types/JSON";
import VideoCallMeeting from "../../../../Types/VideoCall/VideoCallMeeting";
import VideoCallProvider from "../../../../Types/VideoCall/VideoCallProvider";
import {
  ScriptedFetch,
  readFormBody,
  readJsonBody,
  scriptedFetch,
} from "./VideoCallTestFetch";
import { describe, expect, test } from "@jest/globals";

/*
 * The Zoom half of incident calls: the Server-to-Server OAuth token request,
 * the meeting it creates, and the words a person reads when Zoom refuses.
 *
 * The meeting settings are the point of the provider. The host is a service
 * account that never joins, so a meeting created with a waiting room or
 * without join-before-host is one nobody can get into; and an instant
 * meeting (type 1) dies when the last person leaves, which an incident
 * bridge does many times. These assertions pin exactly that.
 */

const SETTINGS: {
  accountId: string;
  clientId: string;
  clientSecret: string;
  hostEmail: string;
} = {
  accountId: "acct_123",
  clientId: "client_abc",
  clientSecret: "s3cr3t:with:colons",
  hostEmail: "incidents@example.com",
};

const TOKEN_RESPONSE: JSONObject = {
  access_token: "zoom-access-token",
  token_type: "bearer",
  expires_in: 3599,
  scope: "meeting:write:meeting:admin",
  api_url: "https://api.zoom.us",
};

const MEETING_RESPONSE: JSONObject = {
  id: 85746065432,
  topic: "INC-42: Checkout API is down",
  type: 2,
  join_url: "https://us05web.zoom.us/j/85746065432?pwd=abc",
  start_url: "https://us05web.zoom.us/s/85746065432?zak=host-only-secret",
  password: "abc",
};

function newClient(fetcher: ScriptedFetch): ZoomMeetingClient {
  return new ZoomMeetingClient(
    SETTINGS,
    new VideoCallHttpClient({ fetchImplementation: fetcher.fetch }),
  );
}

describe("ZoomMeetingClient", () => {
  test("requests an account token with Basic auth and the account id", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: TOKEN_RESPONSE },
      { status: 201, body: MEETING_RESPONSE },
    ]);

    await newClient(fetcher).createMeeting({ title: "INC-42: Down" });

    const tokenRequest: (typeof fetcher.requests)[number] =
      fetcher.requests[0]!;

    expect(tokenRequest.url).toBe(ZOOM_TOKEN_URL);
    expect(tokenRequest.init.method).toBe("POST");
    expect(tokenRequest.init.headers["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );

    const expectedBasic: string = Buffer.from(
      `${SETTINGS.clientId}:${SETTINGS.clientSecret}`,
    ).toString("base64");
    expect(tokenRequest.init.headers["Authorization"]).toBe(
      `Basic ${expectedBasic}`,
    );

    const form: URLSearchParams = readFormBody(tokenRequest);
    expect(form.get("grant_type")).toBe("account_credentials");
    expect(form.get("account_id")).toBe(SETTINGS.accountId);
  });

  test("creates a scheduled meeting anyone can join before the host, without a waiting room", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: TOKEN_RESPONSE },
      { status: 201, body: MEETING_RESPONSE },
    ]);

    const startTime: Date = new Date("2026-10-07T08:30:15.123Z");

    const meeting: VideoCallMeeting = await newClient(fetcher).createMeeting({
      title: "INC-42: Checkout API is down",
      description: "Incident INC-42 in OneUptime: https://oneuptime.com/x",
      startTime,
    });

    const meetingRequest: (typeof fetcher.requests)[number] =
      fetcher.requests[1]!;

    expect(meetingRequest.url).toBe(
      `${ZOOM_API_BASE_URL}/users/incidents%40example.com/meetings`,
    );
    expect(meetingRequest.init.headers["Authorization"]).toBe(
      "Bearer zoom-access-token",
    );

    const body: JSONObject = readJsonBody(meetingRequest);
    expect(body["type"]).toBe(2);
    expect(body["topic"]).toBe("INC-42: Checkout API is down");
    expect(body["agenda"]).toBe(
      "Incident INC-42 in OneUptime: https://oneuptime.com/x",
    );
    // Zoom's UTC format has no milliseconds.
    expect(body["start_time"]).toBe("2026-10-07T08:30:15Z");
    expect(body["timezone"]).toBe("UTC");
    expect(body["settings"]).toEqual({
      join_before_host: true,
      jbh_time: 0,
      waiting_room: false,
    });

    expect(meeting).toEqual({
      provider: VideoCallProvider.Zoom,
      joinUrl: "https://us05web.zoom.us/j/85746065432?pwd=abc",
      externalMeetingId: "85746065432",
    });
  });

  test("never returns the host's start link", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: TOKEN_RESPONSE },
      { status: 201, body: MEETING_RESPONSE },
    ]);

    const meeting: VideoCallMeeting = await newClient(fetcher).createMeeting({
      title: "x",
    });

    expect(JSON.stringify(meeting)).not.toContain("zak=");
    expect(JSON.stringify(meeting)).not.toContain("/s/");
  });

  test("leaves the agenda out when there is no description", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: TOKEN_RESPONSE },
      { status: 201, body: MEETING_RESPONSE },
    ]);

    await newClient(fetcher).createMeeting({ title: "INC-1: Down" });

    expect(readJsonBody(fetcher.requests[1]!)).not.toHaveProperty("agenda");
  });

  test("truncates the topic to Zoom's 200 characters", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: TOKEN_RESPONSE },
      { status: 201, body: MEETING_RESPONSE },
    ]);

    await newClient(fetcher).createMeeting({ title: "x".repeat(500) });

    const topic: string = readJsonBody(fetcher.requests[1]!)["topic"] as string;
    expect(topic.length).toBe(200);
    expect(topic.endsWith("…")).toBe(true);
  });

  test("uses the cluster the token response names, but only a Zoom host", () => {
    expect(ZoomMeetingClient.getApiBaseUrl("https://api-eu.zoom.us")).toBe(
      "https://api-eu.zoom.us/v2",
    );
    expect(ZoomMeetingClient.getApiBaseUrl(undefined)).toBe(ZOOM_API_BASE_URL);
    expect(ZoomMeetingClient.getApiBaseUrl("https://evil.example.com")).toBe(
      ZOOM_API_BASE_URL,
    );
    expect(ZoomMeetingClient.getApiBaseUrl("http://api.zoom.us")).toBe(
      ZOOM_API_BASE_URL,
    );
    expect(ZoomMeetingClient.getApiBaseUrl("https://user:pw@api.zoom.us")).toBe(
      ZOOM_API_BASE_URL,
    );
    expect(ZoomMeetingClient.getApiBaseUrl("not a url")).toBe(
      ZOOM_API_BASE_URL,
    );
    // A look-alike domain is not Zoom's.
    expect(ZoomMeetingClient.getApiBaseUrl("https://api.notzoom.us")).toBe(
      ZOOM_API_BASE_URL,
    );
  });

  test("sends the meeting request to the cluster from the token response", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      {
        status: 200,
        body: { ...TOKEN_RESPONSE, api_url: "https://api-eu.zoom.us" },
      },
      { status: 201, body: MEETING_RESPONSE },
    ]);

    await newClient(fetcher).createMeeting({ title: "x" });

    expect(fetcher.requests[1]!.url).toBe(
      "https://api-eu.zoom.us/v2/users/incidents%40example.com/meetings",
    );
  });

  test("explains a rejected client id or secret", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      {
        status: 400,
        body: {
          reason: "Invalid client_id or client_secret",
          error: "invalid_client",
        },
      },
    ]);

    const error: unknown = await newClient(fetcher)
      .createMeeting({ title: "x" })
      .catch((e: unknown) => {
        return e;
      });

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toContain(
      "Zoom rejected the Client ID or Client secret",
    );
    expect((error as Error).message).toContain(
      "Invalid client_id or client_secret",
    );
    // The secret itself never appears in a message a person reads.
    expect((error as Error).message).not.toContain(SETTINGS.clientSecret);
  });

  test("explains any other refused token request as an account problem", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      {
        status: 400,
        body: {
          reason: "Invalid request : Account ID is invalid",
          error: "invalid_request",
        },
      },
    ]);

    await expect(
      newClient(fetcher).createMeeting({ title: "x" }),
    ).rejects.toThrow(/Check the Account ID/);
  });

  test("names the missing scope", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: TOKEN_RESPONSE },
      {
        status: 400,
        body: {
          code: 4711,
          message:
            "Invalid access token, does not contain scopes:[meeting:write:meeting:admin, meeting:write:admin].",
        },
      },
    ]);

    const error: unknown = await newClient(fetcher)
      .createMeeting({ title: "x" })
      .catch((e: unknown) => {
        return e;
      });

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toContain(
      "missing the meeting:write:meeting:admin scope",
    );
  });

  test("names the host Zoom does not know", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: TOKEN_RESPONSE },
      {
        status: 404,
        body: {
          code: 1001,
          message: "User does not exist: incidents@example.com.",
        },
      },
    ]);

    await expect(
      newClient(fetcher).createMeeting({ title: "x" }),
    ).rejects.toThrow(/Zoom has no user incidents@example.com/);
  });

  test("says when Zoom is rate limiting, as a provider failure rather than bad settings", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: TOKEN_RESPONSE },
      { status: 429, body: { code: 429, message: "Too many requests" } },
    ]);

    const error: unknown = await newClient(fetcher)
      .createMeeting({ title: "x" })
      .catch((e: unknown) => {
        return e;
      });

    expect(error).toBeInstanceOf(APIException);
    expect((error as Error).message).toContain("Try again in a minute");
  });

  test("reports a Zoom outage as a provider failure", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: TOKEN_RESPONSE },
      { status: 503, body: "<html>Service Unavailable</html>" },
    ]);

    const error: unknown = await newClient(fetcher)
      .createMeeting({ title: "x" })
      .catch((e: unknown) => {
        return e;
      });

    expect(error).toBeInstanceOf(APIException);
    expect((error as Error).message).toContain("HTTP 503");
  });

  test("refuses a meeting response without a Zoom join link", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: TOKEN_RESPONSE },
      {
        status: 201,
        body: { ...MEETING_RESPONSE, join_url: "https://evil.example.com/j/1" },
      },
    ]);

    await expect(
      newClient(fetcher).createMeeting({ title: "x" }),
    ).rejects.toThrow(/no join link/);
  });

  test("refuses a token response without an access token", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: { token_type: "bearer" } },
    ]);

    await expect(
      newClient(fetcher).createMeeting({ title: "x" }),
    ).rejects.toThrow(/no access token/);
  });

  test("recognises Zoom join links only on Zoom hosts over https", () => {
    expect(
      ZoomMeetingClient.isZoomJoinUrl("https://us02web.zoom.us/j/1?pwd=x"),
    ).toBe(true);
    expect(ZoomMeetingClient.isZoomJoinUrl("https://zoom.us/j/1")).toBe(true);
    expect(ZoomMeetingClient.isZoomJoinUrl("https://x.zoomgov.com/j/1")).toBe(
      true,
    );
    expect(ZoomMeetingClient.isZoomJoinUrl("http://zoom.us/j/1")).toBe(false);
    expect(
      ZoomMeetingClient.isZoomJoinUrl("https://zoom.us.evil.com/j/1"),
    ).toBe(false);
    expect(ZoomMeetingClient.isZoomJoinUrl("javascript:alert(1)")).toBe(false);
  });
});
