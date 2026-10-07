import MicrosoftTeamsMeetingClient, {
  MICROSOFT_GRAPH_BASE_URL,
} from "../../../../Server/Utils/VideoCall/Providers/MicrosoftTeamsMeetingClient";
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
 * The Microsoft Teams half of incident calls: the client-credentials token,
 * the online meeting it creates for the organizer, and the words a person
 * reads when Entra or Graph refuses - above all the application access
 * policy, the one step of the setup that is not in the Azure portal.
 */

const TENANT_ID: string = "11111111-2222-3333-4444-555555555555";
const CLIENT_ID: string = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const ORGANIZER_ID: string = "99999999-8888-7777-6666-555555555555";

const TOKEN_RESPONSE: JSONObject = {
  token_type: "Bearer",
  expires_in: 3599,
  access_token: "graph-access-token",
};

const MEETING_RESPONSE: JSONObject = {
  id: "MSpkYzE3Njc0Yy04MWQ5LTRhZGItYmZi",
  joinWebUrl:
    "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%22Tid%22%3a%22x%22%7d",
  subject: "INC-42: Checkout API is down",
};

function newClient(
  fetcher: ScriptedFetch,
  lobbyBypass: string = "organization",
): MicrosoftTeamsMeetingClient {
  return new MicrosoftTeamsMeetingClient(
    {
      tenantId: TENANT_ID,
      clientId: CLIENT_ID,
      clientSecret: "client~secret.value",
      organizerUserId: ORGANIZER_ID,
      lobbyBypass,
    },
    new VideoCallHttpClient({ fetchImplementation: fetcher.fetch }),
  );
}

describe("MicrosoftTeamsMeetingClient", () => {
  test("requests an app-only Graph token for the tenant", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: TOKEN_RESPONSE },
      { status: 201, body: MEETING_RESPONSE },
    ]);

    await newClient(fetcher).createMeeting({ title: "INC-42" });

    const tokenRequest: (typeof fetcher.requests)[number] =
      fetcher.requests[0]!;
    expect(tokenRequest.url).toBe(
      `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    );

    const form: URLSearchParams = readFormBody(tokenRequest);
    expect(form.get("grant_type")).toBe("client_credentials");
    expect(form.get("client_id")).toBe(CLIENT_ID);
    expect(form.get("client_secret")).toBe("client~secret.value");
    expect(form.get("scope")).toBe("https://graph.microsoft.com/.default");
  });

  test("creates the meeting for the organizer, with the lobby bypass and without a passcode", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: TOKEN_RESPONSE },
      { status: 201, body: MEETING_RESPONSE },
    ]);

    const startTime: Date = new Date("2026-10-07T08:30:00.000Z");

    const meeting: VideoCallMeeting = await newClient(
      fetcher,
      "everyone",
    ).createMeeting({ title: "INC-42: Checkout API is down", startTime });

    const meetingRequest: (typeof fetcher.requests)[number] =
      fetcher.requests[1]!;
    expect(meetingRequest.url).toBe(
      `${MICROSOFT_GRAPH_BASE_URL}/users/${ORGANIZER_ID}/onlineMeetings`,
    );
    expect(meetingRequest.init.headers["Authorization"]).toBe(
      "Bearer graph-access-token",
    );

    expect(readJsonBody(meetingRequest)).toEqual({
      subject: "INC-42: Checkout API is down",
      startDateTime: "2026-10-07T08:30:00.000Z",
      endDateTime: "2026-10-07T09:30:00.000Z",
      allowedPresenters: "everyone",
      lobbyBypassSettings: { scope: "everyone", isDialInBypassEnabled: true },
      joinMeetingIdSettings: { isPasscodeRequired: false },
    });

    expect(meeting).toEqual({
      provider: VideoCallProvider.MicrosoftTeams,
      joinUrl: MEETING_RESPONSE["joinWebUrl"],
      externalMeetingId: MEETING_RESPONSE["id"],
    });
  });

  test("keeps the lobby bypass to the organization for any value Graph is not given here", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: TOKEN_RESPONSE },
      { status: 201, body: MEETING_RESPONSE },
    ]);

    await newClient(fetcher, "organizer").createMeeting({ title: "x" });

    expect(
      (readJsonBody(fetcher.requests[1]!)["lobbyBypassSettings"] as JSONObject)[
        "scope"
      ],
    ).toBe("organization");
  });

  test("hands over the exact PowerShell when the application access policy is missing", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: TOKEN_RESPONSE },
      {
        status: 403,
        body: {
          error: {
            code: "Forbidden",
            message: "No application access policy found for this app",
          },
        },
      },
    ]);

    const error: unknown = await newClient(fetcher)
      .createMeeting({ title: "x" })
      .catch((e: unknown) => {
        return e;
      });

    expect(error).toBeInstanceOf(BadDataException);
    const message: string = (error as Error).message;
    expect(message).toContain(
      `New-CsApplicationAccessPolicy -Identity OneUptime-Meetings -AppIds "${CLIENT_ID}"`,
    );
    expect(message).toContain(
      `Grant-CsApplicationAccessPolicy -PolicyName OneUptime-Meetings -Identity "${ORGANIZER_ID}"`,
    );
  });

  test("names the missing Graph permission for any other refusal", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: TOKEN_RESPONSE },
      {
        status: 403,
        body: {
          error: {
            code: "Authorization_RequestDenied",
            message: "Insufficient privileges to complete the operation.",
          },
        },
      },
    ]);

    await expect(
      newClient(fetcher).createMeeting({ title: "x" }),
    ).rejects.toThrow(/OnlineMeetings.ReadWrite.All application permission/);
  });

  test("names the organizer Graph cannot find", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: TOKEN_RESPONSE },
      {
        status: 404,
        body: {
          error: { code: "ResourceNotFound", message: "User not found" },
        },
      },
    ]);

    await expect(
      newClient(fetcher).createMeeting({ title: "x" }),
    ).rejects.toThrow(
      `found no user with the organizer object ID ${ORGANIZER_ID}`,
    );
  });

  test.each([
    [
      "AADSTS7000215: Invalid client secret provided. Ensure the secret being sent in the request is the client secret value, not the client secret ID",
      "Use the secret's Value, not its Secret ID",
    ],
    [
      "AADSTS7000222: The provided client secret keys for app are expired.",
      "has not expired",
    ],
    [
      "AADSTS700016: Application with identifier 'x' was not found in the directory 'y'.",
      "no application with this Application (client) ID",
    ],
    [
      "AADSTS90002: Tenant '11111111' not found.",
      "no tenant with this Directory (tenant) ID",
    ],
  ])(
    "explains the Entra error %s",
    async (description: string, expected: string) => {
      const fetcher: ScriptedFetch = scriptedFetch([
        {
          status: 400,
          body: { error: "invalid_request", error_description: description },
        },
      ]);

      const error: unknown = await newClient(fetcher)
        .createMeeting({ title: "x" })
        .catch((e: unknown) => {
          return e;
        });

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as Error).message).toContain(expected);
      expect((error as Error).message).not.toContain("client~secret.value");
    },
  );

  test("reports a Graph outage as a provider failure", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: TOKEN_RESPONSE },
      {
        status: 503,
        body: { error: { code: "ServiceUnavailable", message: "Try later" } },
      },
    ]);

    await expect(
      newClient(fetcher).createMeeting({ title: "x" }),
    ).rejects.toBeInstanceOf(APIException);
  });

  test("refuses a meeting without a Teams join link", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: TOKEN_RESPONSE },
      {
        status: 201,
        body: { id: "x", joinWebUrl: "https://evil.example.com/x" },
      },
    ]);

    await expect(
      newClient(fetcher).createMeeting({ title: "x" }),
    ).rejects.toThrow(/no join link/);
  });

  test("recognises GUIDs", () => {
    expect(MicrosoftTeamsMeetingClient.isGuid(TENANT_ID)).toBe(true);
    expect(MicrosoftTeamsMeetingClient.isGuid(` ${TENANT_ID} `)).toBe(true);
    expect(MicrosoftTeamsMeetingClient.isGuid("incidents@acme.com")).toBe(
      false,
    );
    expect(MicrosoftTeamsMeetingClient.isGuid(undefined)).toBe(false);
  });

  test("encodes the tenant into the token URL", () => {
    expect(
      MicrosoftTeamsMeetingClient.getTokenUrl("acme.onmicrosoft.com"),
    ).toBe(
      "https://login.microsoftonline.com/acme.onmicrosoft.com/oauth2/v2.0/token",
    );
    expect(MicrosoftTeamsMeetingClient.getTokenUrl("a/../b")).toBe(
      "https://login.microsoftonline.com/a%2F..%2Fb/oauth2/v2.0/token",
    );
  });
});
