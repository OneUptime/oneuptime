import ZoomOAuthApp, {
  ZOOM_AUTHORIZE_URL,
  ZOOM_REVOKE_URL,
} from "../../../../../Server/Utils/VideoCall/OAuth/ZoomOAuthApp";
import {
  VideoCallOAuthGrant,
  VideoCallOAuthGrantProblem,
  VideoCallOAuthGrantRefusal,
  VideoCallOAuthTokens,
} from "../../../../../Server/Utils/VideoCall/OAuth/VideoCallOAuth";
import { ZOOM_TOKEN_URL } from "../../../../../Server/Utils/VideoCall/Providers/ZoomMeetingClient";
import VideoCallHttpClient from "../../../../../Server/Utils/VideoCall/VideoCallHttpClient";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import APIException from "../../../../../Types/Exception/ApiException";
import { JSONObject } from "../../../../../Types/JSON";
import {
  ScriptedFetch,
  readFormBody,
  scriptedFetch,
} from "../VideoCallTestFetch";
import { describe, expect, test } from "@jest/globals";

/*
 * Zoom's one-click Connect: the sign-in URL, the code exchange with the
 * user it was for, and the refresh, whose new refresh token must replace
 * the one it spent.
 */

const CREDENTIALS: { clientId: string; clientSecret: string } = {
  clientId: "zoom-client-id",
  clientSecret: "zoom:secret",
};

const REDIRECT_URI: string =
  "https://oneuptime.com/api/video-call-oauth/zoom/callback";

const TOKEN_RESPONSE: JSONObject = {
  access_token: "zoom-access",
  token_type: "bearer",
  refresh_token: "zoom-refresh-1",
  expires_in: 3599,
  scope: "meeting:write:meeting user:read:user",
  api_url: "https://api.zoom.us",
};

const USER_RESPONSE: JSONObject = {
  id: "KdYKjnimT4KPd8FFgQt9FQ",
  email: "incidents@acme.com",
  account_id: "acct-1",
  type: 2,
};

function newApp(fetcher: ScriptedFetch): ZoomOAuthApp {
  return new ZoomOAuthApp(
    CREDENTIALS,
    new VideoCallHttpClient({ fetchImplementation: fetcher.fetch }),
  );
}

function basicAuth(): string {
  return `Basic ${Buffer.from("zoom-client-id:zoom:secret").toString("base64")}`;
}

describe("ZoomOAuthApp", () => {
  test("sends the browser to Zoom's sign-in with the app, the redirect URI and the state", () => {
    const url: URL = new URL(
      newApp(scriptedFetch([])).getAuthorizationUrl({
        state: "state-123",
        redirectUri: REDIRECT_URI,
      }),
    );

    expect(`${url.origin}${url.pathname}`).toBe(ZOOM_AUTHORIZE_URL);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("zoom-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("state")).toBe("state-123");
  });

  test("exchanges the code with Basic auth and reads who signed in", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: TOKEN_RESPONSE },
      { status: 200, body: USER_RESPONSE },
    ]);

    const grant: VideoCallOAuthGrant = await newApp(fetcher).exchangeCode({
      code: "the-code",
      redirectUri: REDIRECT_URI,
    });

    const tokenRequest: (typeof fetcher.requests)[number] =
      fetcher.requests[0]!;
    expect(tokenRequest.url).toBe(ZOOM_TOKEN_URL);
    expect(tokenRequest.init.headers["Authorization"]).toBe(basicAuth());
    expect(Object.fromEntries(readFormBody(tokenRequest))).toEqual({
      grant_type: "authorization_code",
      code: "the-code",
      redirect_uri: REDIRECT_URI,
    });

    const userRequest: (typeof fetcher.requests)[number] = fetcher.requests[1]!;
    expect(userRequest.url).toBe("https://api.zoom.us/v2/users/me");
    expect(userRequest.init.headers["Authorization"]).toBe(
      "Bearer zoom-access",
    );

    expect(grant.account).toEqual({
      label: "incidents@acme.com",
      externalUserId: "KdYKjnimT4KPd8FFgQt9FQ",
      externalAccountId: "acct-1",
    });
    expect(grant.tokens.accessToken).toBe("zoom-access");
    expect(grant.tokens.refreshToken).toBe("zoom-refresh-1");
    expect(grant.tokens.apiBaseUrl).toBe("https://api.zoom.us/v2");
  });

  test("never sends a token to a host that is not Zoom's", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      {
        status: 200,
        body: { ...TOKEN_RESPONSE, api_url: "https://evil.example.com" },
      },
      { status: 200, body: USER_RESPONSE },
    ]);

    await newApp(fetcher).exchangeCode({
      code: "c",
      redirectUri: REDIRECT_URI,
    });

    expect(fetcher.requests[1]!.url).toBe("https://api.zoom.us/v2/users/me");
  });

  test("refuses a sign-in whose app has no meeting scope", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: { ...TOKEN_RESPONSE, scope: "user:read:user" } },
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
    // Nothing more is asked of Zoom.
    expect(fetcher.requests).toHaveLength(1);
  });

  test("a code Zoom refuses is an error for the log, not a connection", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 400, body: { reason: "Invalid authorization code" } },
    ]);

    await expect(
      newApp(fetcher).exchangeCode({ code: "c", redirectUri: REDIRECT_URI }),
    ).rejects.toThrow(APIException);
  });

  test("refuses a sign-in that does not say who it was", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: TOKEN_RESPONSE },
      { status: 200, body: { email: "incidents@acme.com" } },
    ]);

    await expect(
      newApp(fetcher).exchangeCode({ code: "c", redirectUri: REDIRECT_URI }),
    ).rejects.toThrow("Zoom did not say who signed in.");
  });

  test("refreshes with the stored refresh token and returns the new one Zoom issues", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      {
        status: 200,
        body: {
          ...TOKEN_RESPONSE,
          access_token: "zoom-access-2",
          refresh_token: "zoom-refresh-2",
        },
      },
    ]);

    const tokens: VideoCallOAuthTokens = await newApp(fetcher).refresh({
      secrets: { refreshToken: "zoom-refresh-1" },
      accountLabel: "incidents@acme.com",
    });

    expect(fetcher.requests[0]!.init.headers["Authorization"]).toBe(
      basicAuth(),
    );
    expect(Object.fromEntries(readFormBody(fetcher.requests[0]!))).toEqual({
      grant_type: "refresh_token",
      refresh_token: "zoom-refresh-1",
    });
    expect(tokens.accessToken).toBe("zoom-access-2");
    expect(tokens.refreshToken).toBe("zoom-refresh-2");
  });

  test("a refresh token Zoom no longer accepts says to reconnect, naming the account", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      {
        status: 400,
        body: { reason: "Invalid Token!", error: "invalid_grant" },
      },
    ]);

    const error: unknown = await newApp(fetcher)
      .refresh({
        secrets: { refreshToken: "spent" },
        accountLabel: "incidents@acme.com",
      })
      .catch((err: unknown) => {
        return err;
      });

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toContain("incidents@acme.com");
    expect((error as Error).message).toContain("Reconnect Zoom");
  });

  test("withdraws the sign-in with the app's credentials", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: { status: "success" } },
    ]);

    await newApp(fetcher).revoke({
      refreshToken: "zoom-refresh-1",
      accessToken: "zoom-access",
    });

    expect(fetcher.requests[0]!.url).toBe(ZOOM_REVOKE_URL);
    expect(fetcher.requests[0]!.init.headers["Authorization"]).toBe(
      basicAuth(),
    );
    expect(readFormBody(fetcher.requests[0]!).get("token")).toBe("zoom-access");
  });
});
