import GoogleMeetOAuthApp, {
  GOOGLE_AUTHORIZE_URL,
  GOOGLE_REVOKE_URL,
  GOOGLE_TOKEN_URL,
} from "../../../../../Server/Utils/VideoCall/OAuth/GoogleMeetOAuthApp";
import {
  VideoCallOAuthGrant,
  VideoCallOAuthGrantProblem,
  VideoCallOAuthGrantRefusal,
  VideoCallOAuthTokens,
} from "../../../../../Server/Utils/VideoCall/OAuth/VideoCallOAuth";
import VideoCallHttpClient from "../../../../../Server/Utils/VideoCall/VideoCallHttpClient";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import { GOOGLE_MEET_SCOPE } from "../../../../../Types/VideoCall/VideoCallProviderCatalog";
import {
  ScriptedFetch,
  readFormBody,
  scriptedFetch,
} from "../VideoCallTestFetch";
import { unsignedIdToken } from "./VideoCallOAuthTestHelpers";
import { describe, expect, test } from "@jest/globals";

/*
 * Google Meet's one-click Connect. Google's consent screen lets the person
 * untick the Meet permission, and a sign-in without it would connect and
 * then fail every call, so it is refused.
 */

const CREDENTIALS: { clientId: string; clientSecret: string } = {
  clientId: "1234-abc.apps.googleusercontent.com",
  clientSecret: "google-secret",
};

const REDIRECT_URI: string =
  "https://oneuptime.com/api/video-call-oauth/google-meet/callback";

function tokenResponse(overrides?: JSONObject): JSONObject {
  return {
    access_token: "google-access",
    expires_in: 3599,
    refresh_token: "google-refresh",
    scope: `openid https://www.googleapis.com/auth/userinfo.email ${GOOGLE_MEET_SCOPE}`,
    token_type: "Bearer",
    id_token: unsignedIdToken({
      aud: CREDENTIALS.clientId,
      sub: "109876543210",
      email: "incidents@acme.com",
      hd: "acme.com",
    }),
    ...(overrides || {}),
  };
}

function newApp(fetcher: ScriptedFetch): GoogleMeetOAuthApp {
  return new GoogleMeetOAuthApp(
    CREDENTIALS,
    new VideoCallHttpClient({ fetchImplementation: fetcher.fetch }),
  );
}

describe("GoogleMeetOAuthApp", () => {
  test("asks for offline access to create Meet spaces, with the account picker and consent every time", () => {
    const url: URL = new URL(
      newApp(scriptedFetch([])).getAuthorizationUrl({
        state: "state-1",
        redirectUri: REDIRECT_URI,
      }),
    );

    expect(`${url.origin}${url.pathname}`).toBe(GOOGLE_AUTHORIZE_URL);
    expect(url.searchParams.get("client_id")).toBe(CREDENTIALS.clientId);
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("select_account consent");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("scope")!.split(" ")).toEqual([
      "openid",
      "email",
      GOOGLE_MEET_SCOPE,
    ]);
  });

  test("exchanges the code and reads the account from the ID token", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: tokenResponse() },
    ]);

    const grant: VideoCallOAuthGrant = await newApp(fetcher).exchangeCode({
      code: "the-code",
      redirectUri: REDIRECT_URI,
    });

    expect(fetcher.requests[0]!.url).toBe(GOOGLE_TOKEN_URL);
    expect(Object.fromEntries(readFormBody(fetcher.requests[0]!))).toEqual({
      grant_type: "authorization_code",
      code: "the-code",
      redirect_uri: REDIRECT_URI,
      client_id: CREDENTIALS.clientId,
      client_secret: CREDENTIALS.clientSecret,
    });
    expect(grant.account).toEqual({
      label: "incidents@acme.com",
      externalUserId: "109876543210",
      externalAccountId: "acme.com",
    });
    expect(grant.tokens.refreshToken).toBe("google-refresh");
  });

  test("refuses a sign-in where the Meet permission was unticked", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      {
        status: 200,
        body: tokenResponse({
          scope: "openid https://www.googleapis.com/auth/userinfo.email",
        }),
      },
    ]);

    const error: unknown = await newApp(fetcher)
      .exchangeCode({ code: "c", redirectUri: REDIRECT_URI })
      .catch((err: unknown) => {
        return err;
      });

    expect(error).toBeInstanceOf(VideoCallOAuthGrantRefusal);
    expect((error as VideoCallOAuthGrantRefusal).problem).toBe(
      VideoCallOAuthGrantProblem.PermissionNotGranted,
    );
  });

  test("refuses an ID token issued to another app", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      {
        status: 200,
        body: tokenResponse({
          id_token: unsignedIdToken({
            aud: "someone-else.apps.googleusercontent.com",
            sub: "1",
            email: "x@acme.com",
          }),
        }),
      },
    ]);

    await expect(
      newApp(fetcher).exchangeCode({ code: "c", redirectUri: REDIRECT_URI }),
    ).rejects.toThrow("issued to another app");
  });

  test("refuses a sign-in without a refresh token, which could not stay signed in", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: tokenResponse({ refresh_token: undefined }) },
    ]);

    await expect(
      newApp(fetcher).exchangeCode({ code: "c", redirectUri: REDIRECT_URI }),
    ).rejects.toThrow("no refresh token");
  });

  test("a refresh keeps the refresh token Google does not replace", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      {
        status: 200,
        body: {
          access_token: "google-access-2",
          expires_in: 3599,
          scope: GOOGLE_MEET_SCOPE,
        },
      },
    ]);

    const tokens: VideoCallOAuthTokens = await newApp(fetcher).refresh({
      secrets: { refreshToken: "google-refresh" },
      accountLabel: "incidents@acme.com",
    });

    expect(Object.fromEntries(readFormBody(fetcher.requests[0]!))).toEqual({
      grant_type: "refresh_token",
      refresh_token: "google-refresh",
      client_id: CREDENTIALS.clientId,
      client_secret: CREDENTIALS.clientSecret,
    });
    expect(tokens.accessToken).toBe("google-access-2");
    expect(tokens.refreshToken).toBe("google-refresh");
  });

  test("a revoked sign-in says to reconnect Google Meet", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      {
        status: 400,
        body: {
          error: "invalid_grant",
          error_description: "Token has been expired or revoked.",
        },
      },
    ]);

    const error: unknown = await newApp(fetcher)
      .refresh({
        secrets: { refreshToken: "gone" },
        accountLabel: "incidents@acme.com",
      })
      .catch((err: unknown) => {
        return err;
      });

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toContain(
      "Reconnect Google Meet in Project Settings > Video Calls",
    );
  });

  test("withdraws the whole grant by revoking the refresh token", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([{ status: 200, body: {} }]);

    await newApp(fetcher).revoke({ refreshToken: "google-refresh" });

    expect(fetcher.requests[0]!.url).toBe(GOOGLE_REVOKE_URL);
    expect(readFormBody(fetcher.requests[0]!).get("token")).toBe(
      "google-refresh",
    );
  });
});
