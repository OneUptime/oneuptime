import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * TEAMS MEETINGS FOR INCIDENTS IN A US GOVERNMENT CLOUD.
 *
 * Incident calls in Microsoft Teams are made through Microsoft Graph: by
 * the one-click Connect's signed-in account (MicrosoftTeamsMeetingsOAuthApp)
 * or by a project's own app registration (MicrosoftTeamsMeetingClient). In
 * GCC High and DoD the sign-in is login.microsoftonline.us and Graph is the
 * cloud's own - graph.microsoft.us, dod-graph.microsoft.us - and the
 * meeting's join link is on that cloud's Teams. With MICROSOFT_TEAMS_CLOUD
 * set, every sign-in, scope, token, meeting and join link is that cloud's.
 */

const environment: Record<string, string | null> = {
  MicrosoftTeamsCloudSetting: null,
};

jest.mock("../../../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  return new Proxy(actual, {
    get: (target: Record<string, unknown>, key: string | symbol): unknown => {
      if (typeof key === "string" && key in environment) {
        return environment[key];
      }

      return target[key as string];
    },
  });
});

import MicrosoftTeamsMeetingsOAuthApp from "../../../../../Server/Utils/VideoCall/OAuth/MicrosoftTeamsMeetingsOAuthApp";
import { VideoCallOAuthTokens } from "../../../../../Server/Utils/VideoCall/OAuth/VideoCallOAuth";
import MicrosoftTeamsMeetingClient from "../../../../../Server/Utils/VideoCall/Providers/MicrosoftTeamsMeetingClient";
import VideoCallHttpClient from "../../../../../Server/Utils/VideoCall/VideoCallHttpClient";
import { JSONObject } from "../../../../../Types/JSON";
import VideoCallMeeting from "../../../../../Types/VideoCall/VideoCallMeeting";
import VideoCallProvider from "../../../../../Types/VideoCall/VideoCallProvider";
import {
  ScriptedFetch,
  readFormBody,
  scriptedFetch,
} from "../VideoCallTestFetch";
import { unsignedIdToken } from "./VideoCallOAuthTestHelpers";

const CLIENT_ID: string = "6c1a8d3e-1111-4222-8333-944455556666";
const AGENCY: string = "5a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OBJECT_ID: string = "7b2e9f10-aaaa-4bbb-8ccc-dddddddddddd";
const ORGANIZER_ID: string = "99999999-8888-7777-6666-555555555555";
const REDIRECT_URI: string =
  "https://oneuptime.agency.example.gov/api/video-call-oauth/microsoft-teams/callback";

interface GovernmentCloud {
  setting: string;
  graph: string;
  teams: string;
}

const CLOUDS: Array<GovernmentCloud> = [
  {
    setting: "gcc-high",
    graph: "https://graph.microsoft.us",
    teams: "https://gov.teams.microsoft.us",
  },
  {
    setting: "dod",
    graph: "https://dod-graph.microsoft.us",
    teams: "https://dod.teams.microsoft.us",
  },
];

const SIGN_IN: string = "https://login.microsoftonline.us";

const setCloud: (value: string | null) => void = (
  value: string | null,
): void => {
  environment["MicrosoftTeamsCloudSetting"] = value;
};

const tokenResponse: (graph: string) => JSONObject = (
  graph: string,
): JSONObject => {
  return {
    token_type: "Bearer",
    scope: `${graph}/OnlineMeetings.ReadWrite openid profile email`,
    expires_in: 4000,
    access_token: "graph-access",
    refresh_token: "ms-refresh-1",
    id_token: unsignedIdToken({
      aud: CLIENT_ID,
      tid: AGENCY,
      oid: OBJECT_ID,
      preferred_username: "incidents@agency.example.gov",
    }),
  };
};

const oneClickApp: (
  fetcher: ScriptedFetch,
  tenantId?: string | undefined,
) => MicrosoftTeamsMeetingsOAuthApp = (
  fetcher: ScriptedFetch,
  tenantId?: string | undefined,
): MicrosoftTeamsMeetingsOAuthApp => {
  return new MicrosoftTeamsMeetingsOAuthApp(
    tenantId
      ? { clientId: CLIENT_ID, clientSecret: "ms-secret", tenantId: tenantId }
      : { clientId: CLIENT_ID, clientSecret: "ms-secret" },
    new VideoCallHttpClient({ fetchImplementation: fetcher.fetch }),
  );
};

afterEach(() => {
  setCloud(null);
});

describe.each(CLOUDS)(
  "the one-click Connect in $setting",
  (cloud: GovernmentCloud) => {
    test("signs in at Azure Government's sign-in, for the meetings permission on that cloud's Graph", () => {
      setCloud(cloud.setting);

      const url: URL = new URL(
        oneClickApp(scriptedFetch([])).getAuthorizationUrl({
          state: "s",
          redirectUri: REDIRECT_URI,
        }),
      );

      expect(`${url.origin}${url.pathname}`).toBe(
        `${SIGN_IN}/organizations/oauth2/v2.0/authorize`,
      );
      expect(url.searchParams.get("scope")!.split(" ")).toEqual([
        "openid",
        "profile",
        "email",
        "offline_access",
        `${cloud.graph}/OnlineMeetings.ReadWrite`,
      ]);
    });

    test("a project that records its calls asks for the calendar and transcripts on that Graph too", () => {
      setCloud(cloud.setting);

      expect(MicrosoftTeamsMeetingsOAuthApp.getSignInScopes(true)).toEqual([
        "openid",
        "profile",
        "email",
        "offline_access",
        `${cloud.graph}/OnlineMeetings.ReadWrite`,
        `${cloud.graph}/Calendars.ReadWrite`,
        `${cloud.graph}/OnlineMeetingTranscript.Read.All`,
      ]);
      // A refresh keeps what the sign-in was granted, on the same Graph.
      expect(
        MicrosoftTeamsMeetingsOAuthApp.getRefreshScopes(
          `${cloud.graph}/OnlineMeetings.ReadWrite ${cloud.graph}/Calendars.ReadWrite`,
        ),
      ).toEqual([
        "offline_access",
        `${cloud.graph}/OnlineMeetings.ReadWrite`,
        `${cloud.graph}/Calendars.ReadWrite`,
      ]);
    });

    test("a single-tenant app signs in at the agency's tenant there", () => {
      setCloud(cloud.setting);

      expect(
        oneClickApp(scriptedFetch([]), AGENCY).getSignInAuthority(),
      ).toBe(`${SIGN_IN}/${AGENCY}`);
    });

    test("the code is exchanged there, and the refresh goes to the account's own tenant there", async () => {
      setCloud(cloud.setting);

      const fetcher: ScriptedFetch = scriptedFetch([
        { status: 200, body: tokenResponse(cloud.graph) },
        { status: 200, body: tokenResponse(cloud.graph) },
      ]);

      await oneClickApp(fetcher).exchangeCode({
        code: "code",
        redirectUri: REDIRECT_URI,
      });

      const refreshed: VideoCallOAuthTokens = await oneClickApp(
        fetcher,
      ).refresh({
        secrets: { refreshToken: "ms-refresh-1", externalAccountId: AGENCY },
        accountLabel: "incidents@agency.example.gov",
      });

      expect(
        fetcher.requests.map((request: { url: string }): string => {
          return request.url;
        }),
      ).toEqual([
        `${SIGN_IN}/organizations/oauth2/v2.0/token`,
        `${SIGN_IN}/${AGENCY}/oauth2/v2.0/token`,
      ]);
      expect(readFormBody(fetcher.requests[0]!).get("scope")).toContain(
        `${cloud.graph}/OnlineMeetings.ReadWrite`,
      );
      expect(refreshed.refreshToken).toBe("ms-refresh-1");
    });
  },
);

describe.each(CLOUDS)(
  "a project's own app registration in $setting",
  (cloud: GovernmentCloud) => {
    test("its app token comes from Azure Government's sign-in, for that cloud's Graph; the meeting is made there, and its join link is that cloud's Teams", async () => {
      setCloud(cloud.setting);

      const joinUrl: string = `${cloud.teams}/l/meetup-join/19%3ameeting_abc%40thread.v2/0`;
      const fetcher: ScriptedFetch = scriptedFetch([
        {
          status: 200,
          body: { token_type: "Bearer", expires_in: 3599, access_token: "t" },
        },
        {
          status: 201,
          body: { id: "MSpkYzE3Njc0", joinWebUrl: joinUrl, subject: "INC-42" },
        },
      ]);

      const meeting: VideoCallMeeting = await new MicrosoftTeamsMeetingClient(
        {
          tenantId: AGENCY,
          clientId: CLIENT_ID,
          clientSecret: "client~secret.value",
          organizerUserId: ORGANIZER_ID,
          lobbyBypass: "organization",
        },
        new VideoCallHttpClient({ fetchImplementation: fetcher.fetch }),
      ).createMeeting({ title: "INC-42" });

      expect(fetcher.requests[0]!.url).toBe(
        `${SIGN_IN}/${AGENCY}/oauth2/v2.0/token`,
      );
      expect(readFormBody(fetcher.requests[0]!).get("scope")).toBe(
        `${cloud.graph}/.default`,
      );
      expect(fetcher.requests[1]!.url).toBe(
        `${cloud.graph}/v1.0/users/${ORGANIZER_ID}/onlineMeetings`,
      );
      // The join link Graph answers with is taken: it is Teams', in that cloud.
      expect(meeting).toEqual({
        provider: VideoCallProvider.MicrosoftTeams,
        joinUrl: joinUrl,
        externalMeetingId: "MSpkYzE3Njc0",
      });
    });
  },
);

describe("Teams join links, in every cloud", () => {
  test("Teams' meeting hosts of each cloud are taken, and nothing that only looks like one", () => {
    for (const url of [
      "https://teams.microsoft.com/l/meetup-join/1",
      "https://gov.teams.microsoft.us/l/meetup-join/1",
      "https://dod.teams.microsoft.us/l/meetup-join/1",
      "https://teams.microsoft.us/l/meetup-join/1",
      "https://teams.live.com/meet/1",
    ]) {
      expect(MicrosoftTeamsMeetingClient.isTeamsJoinUrl(url)).toBe(true);
    }

    for (const url of [
      "http://gov.teams.microsoft.us/l/meetup-join/1",
      "https://gov.teams.microsoft.us.evil.example/l/meetup-join/1",
      "https://teams.example.com/l/meetup-join/1",
      "not a link",
    ]) {
      expect(MicrosoftTeamsMeetingClient.isTeamsJoinUrl(url)).toBe(false);
    }
  });
});
