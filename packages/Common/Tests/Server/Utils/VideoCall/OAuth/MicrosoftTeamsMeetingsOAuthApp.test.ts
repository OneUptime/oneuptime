import MicrosoftTeamsMeetingsOAuthApp, {
  MICROSOFT_CONSUMER_TENANT_ID,
  MICROSOFT_ORGANIZATIONS_AUTHORITY,
  MICROSOFT_TEAMS_MEETINGS_SCOPE,
} from "../../../../../Server/Utils/VideoCall/OAuth/MicrosoftTeamsMeetingsOAuthApp";
import {
  VideoCallOAuthGrant,
  VideoCallOAuthGrantProblem,
  VideoCallOAuthGrantRefusal,
  VideoCallOAuthTokens,
} from "../../../../../Server/Utils/VideoCall/OAuth/VideoCallOAuth";
import VideoCallHttpClient from "../../../../../Server/Utils/VideoCall/VideoCallHttpClient";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import {
  ScriptedFetch,
  readFormBody,
  scriptedFetch,
} from "../VideoCallTestFetch";
import { unsignedIdToken } from "./VideoCallOAuthTestHelpers";
import { describe, expect, test } from "@jest/globals";

/*
 * Microsoft Teams' one-click Connect: a work or school account signs in
 * with the delegated OnlineMeetings.ReadWrite permission - no application
 * access policy - and every refresh's new refresh token is kept.
 */

const CLIENT_ID: string = "6c1a8d3e-1111-4222-8333-944455556666";
const TENANT_ID: string = "0d3b1c0e-58f1-4bd1-8bb0-2b0f6f3f6c11";
const OBJECT_ID: string = "7b2e9f10-aaaa-4bbb-8ccc-dddddddddddd";

const REDIRECT_URI: string =
  "https://oneuptime.com/api/video-call-oauth/microsoft-teams/callback";

function tokenResponse(
  overrides?: JSONObject,
  claims?: JSONObject,
): JSONObject {
  return {
    token_type: "Bearer",
    scope: `${MICROSOFT_TEAMS_MEETINGS_SCOPE} openid profile email`,
    expires_in: 4000,
    access_token: "graph-access",
    refresh_token: "ms-refresh-1",
    id_token: unsignedIdToken({
      aud: CLIENT_ID,
      tid: TENANT_ID,
      oid: OBJECT_ID,
      preferred_username: "incidents@acme.onmicrosoft.com",
      ...(claims || {}),
    }),
    ...(overrides || {}),
  };
}

function newApp(fetcher: ScriptedFetch): MicrosoftTeamsMeetingsOAuthApp {
  return new MicrosoftTeamsMeetingsOAuthApp(
    { clientId: CLIENT_ID, clientSecret: "ms-secret" },
    new VideoCallHttpClient({ fetchImplementation: fetcher.fetch }),
  );
}

describe("MicrosoftTeamsMeetingsOAuthApp", () => {
  test("signs in work and school accounts only, asking for the delegated meeting permission and offline access", () => {
    const url: URL = new URL(
      newApp(scriptedFetch([])).getAuthorizationUrl({
        state: "s",
        redirectUri: REDIRECT_URI,
      }),
    );

    expect(`${url.origin}${url.pathname}`).toBe(
      `${MICROSOFT_ORGANIZATIONS_AUTHORITY}/oauth2/v2.0/authorize`,
    );
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("response_mode")).toBe("query");
    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(url.searchParams.get("scope")!.split(" ")).toEqual([
      "openid",
      "profile",
      "email",
      "offline_access",
      MICROSOFT_TEAMS_MEETINGS_SCOPE,
    ]);
  });

  test("exchanges the code and reads the tenant and the account from the ID token", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: tokenResponse() },
    ]);

    const grant: VideoCallOAuthGrant = await newApp(fetcher).exchangeCode({
      code: "code",
      redirectUri: REDIRECT_URI,
    });

    expect(fetcher.requests[0]!.url).toBe(
      `${MICROSOFT_ORGANIZATIONS_AUTHORITY}/oauth2/v2.0/token`,
    );
    const body: URLSearchParams = readFormBody(fetcher.requests[0]!);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("client_secret")).toBe("ms-secret");
    expect(body.get("redirect_uri")).toBe(REDIRECT_URI);

    expect(grant.account).toEqual({
      label: "incidents@acme.onmicrosoft.com",
      externalUserId: OBJECT_ID,
      externalAccountId: TENANT_ID,
    });
  });

  test("refuses a personal Microsoft account, which cannot create Teams meetings", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      {
        status: 200,
        body: tokenResponse(undefined, { tid: MICROSOFT_CONSUMER_TENANT_ID }),
      },
    ]);

    const error: unknown = await newApp(fetcher)
      .exchangeCode({ code: "c", redirectUri: REDIRECT_URI })
      .catch((err: unknown) => {
        return err;
      });

    expect(error).toBeInstanceOf(VideoCallOAuthGrantRefusal);
    expect((error as VideoCallOAuthGrantRefusal).problem).toBe(
      VideoCallOAuthGrantProblem.WorkAccountRequired,
    );
  });

  test("refuses a sign-in without the meeting permission", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: tokenResponse({ scope: "openid profile email" }) },
    ]);

    const error: unknown = await newApp(fetcher)
      .exchangeCode({ code: "c", redirectUri: REDIRECT_URI })
      .catch((err: unknown) => {
        return err;
      });

    expect((error as VideoCallOAuthGrantRefusal).problem).toBe(
      VideoCallOAuthGrantProblem.PermissionNotGranted,
    );
  });

  test("accepts the permission however Microsoft lists it", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      {
        status: 200,
        body: tokenResponse({ scope: "OnlineMeetings.ReadWrite openid" }),
      },
    ]);

    await expect(
      newApp(fetcher).exchangeCode({ code: "c", redirectUri: REDIRECT_URI }),
    ).resolves.toBeDefined();
  });

  test("refreshes against the account's own tenant and keeps the new refresh token", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      {
        status: 200,
        body: tokenResponse({
          access_token: "graph-access-2",
          refresh_token: "ms-refresh-2",
        }),
      },
    ]);

    const tokens: VideoCallOAuthTokens = await newApp(fetcher).refresh({
      secrets: { refreshToken: "ms-refresh-1", externalAccountId: TENANT_ID },
      accountLabel: "incidents@acme.onmicrosoft.com",
    });

    expect(fetcher.requests[0]!.url).toBe(
      `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    );
    const body: URLSearchParams = readFormBody(fetcher.requests[0]!);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("ms-refresh-1");
    expect(body.get("scope")).toBe(
      `offline_access ${MICROSOFT_TEAMS_MEETINGS_SCOPE}`,
    );
    expect(tokens.refreshToken).toBe("ms-refresh-2");
  });

  test("a sign-in a tenant policy ended says to reconnect", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      {
        status: 400,
        body: {
          error: "interaction_required",
          error_description:
            "AADSTS50076: Due to a configuration change made by your administrator, you must use multi-factor authentication.",
        },
      },
    ]);

    const error: unknown = await newApp(fetcher)
      .refresh({
        secrets: { refreshToken: "r", externalAccountId: TENANT_ID },
        accountLabel: "incidents@acme.onmicrosoft.com",
      })
      .catch((err: unknown) => {
        return err;
      });

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toContain(
      "Reconnect Microsoft Teams in Project Settings > Video Calls",
    );
  });
});
