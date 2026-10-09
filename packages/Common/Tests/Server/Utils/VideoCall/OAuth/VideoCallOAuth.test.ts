import VideoCallOAuthUtil, {
  VideoCallOAuthSecrets,
  VideoCallOAuthTokens,
} from "../../../../../Server/Utils/VideoCall/OAuth/VideoCallOAuth";
import { VideoCallHttpResponse } from "../../../../../Server/Utils/VideoCall/VideoCallHttpClient";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import APIException from "../../../../../Types/Exception/ApiException";
import { JSONObject } from "../../../../../Types/JSON";
import VideoCallProvider from "../../../../../Types/VideoCall/VideoCallProvider";
import { describe, expect, test } from "@jest/globals";

/*
 * What every provider's sign-in shares: reading a token response, what is
 * stored of it, when the stored access token is still good, and what a
 * refused refresh tells the person who reads the connection's error.
 */

const NOW: Date = new Date("2026-10-09T12:00:00.000Z");

function response(status: number, json: JSONObject): VideoCallHttpResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    bodyText: JSON.stringify(json),
    json,
  };
}

describe("VideoCallOAuthUtil.readTokenResponse", () => {
  test("reads the tokens and when the access token runs out", () => {
    const tokens: VideoCallOAuthTokens = VideoCallOAuthUtil.readTokenResponse({
      response: response(200, {
        access_token: "a",
        refresh_token: "r",
        expires_in: 3600,
        scope: "meeting:write:meeting",
      }),
      providerTitle: "Zoom",
      now: NOW,
    });

    expect(tokens).toEqual({
      accessToken: "a",
      refreshToken: "r",
      accessTokenExpiresAt: new Date("2026-10-09T13:00:00.000Z"),
      scope: "meeting:write:meeting",
    });
  });

  test("keeps the previous refresh token when a refresh answers without one", () => {
    expect(
      VideoCallOAuthUtil.readTokenResponse({
        response: response(200, { access_token: "a", expires_in: 60 }),
        providerTitle: "Google",
        previousRefreshToken: "kept",
        now: NOW,
      }).refreshToken,
    ).toBe("kept");
  });

  test("an hour when the lifetime is missing, and never more than a day", () => {
    expect(
      VideoCallOAuthUtil.readTokenResponse({
        response: response(200, { access_token: "a", refresh_token: "r" }),
        providerTitle: "Zoom",
        now: NOW,
      }).accessTokenExpiresAt.toISOString(),
    ).toBe("2026-10-09T13:00:00.000Z");

    expect(
      VideoCallOAuthUtil.readTokenResponse({
        response: response(200, {
          access_token: "a",
          refresh_token: "r",
          expires_in: 10 * 24 * 3600,
        }),
        providerTitle: "Zoom",
        now: NOW,
      }).accessTokenExpiresAt.toISOString(),
    ).toBe("2026-10-10T12:00:00.000Z");
  });

  test("refuses a response without an access token, or without any refresh token", () => {
    expect(() => {
      VideoCallOAuthUtil.readTokenResponse({
        response: response(200, { refresh_token: "r" }),
        providerTitle: "Zoom",
      });
    }).toThrow(APIException);

    expect(() => {
      VideoCallOAuthUtil.readTokenResponse({
        response: response(200, { access_token: "a" }),
        providerTitle: "Zoom",
      });
    }).toThrow("no refresh token");
  });
});

describe("VideoCallOAuthUtil secrets", () => {
  test("stores the tokens and who signed in, without keys a provider has no value for", () => {
    const secrets: VideoCallOAuthSecrets = VideoCallOAuthUtil.toSecrets({
      tokens: {
        accessToken: "a",
        refreshToken: "r",
        accessTokenExpiresAt: new Date("2026-10-09T13:00:00.000Z"),
      },
      account: { label: "x@acme.com", externalUserId: "u-1" },
      now: NOW,
    });

    expect(secrets).toEqual({
      refreshToken: "r",
      accessToken: "a",
      accessTokenExpiresAt: "2026-10-09T13:00:00.000Z",
      tokensRefreshedAt: "2026-10-09T12:00:00.000Z",
      externalUserId: "u-1",
    });
  });

  test("a refresh keeps who signed in and the API host from before", () => {
    const secrets: VideoCallOAuthSecrets = VideoCallOAuthUtil.toSecrets({
      tokens: {
        accessToken: "a2",
        refreshToken: "r2",
        accessTokenExpiresAt: new Date("2026-10-09T13:00:00.000Z"),
      },
      previous: {
        refreshToken: "r1",
        apiBaseUrl: "https://api.zoom.us/v2",
        externalUserId: "u-1",
        externalAccountId: "acct",
        scope: "meeting:write:meeting",
      },
      now: NOW,
    });

    expect(secrets.refreshToken).toBe("r2");
    expect(secrets.apiBaseUrl).toBe("https://api.zoom.us/v2");
    expect(secrets.externalUserId).toBe("u-1");
    expect(secrets.externalAccountId).toBe("acct");
    expect(secrets.scope).toBe("meeting:write:meeting");
  });

  test("reads stored secrets, and nothing without a refresh token", () => {
    expect(
      VideoCallOAuthUtil.readSecrets({ refreshToken: "r", accessToken: "a" }),
    ).toEqual(expect.objectContaining({ refreshToken: "r", accessToken: "a" }));
    expect(VideoCallOAuthUtil.readSecrets({})).toBe(null);
    expect(VideoCallOAuthUtil.readSecrets({ refreshToken: "" })).toBe(null);
    expect(VideoCallOAuthUtil.readSecrets(null)).toBe(null);
  });

  test("an access token is fresh only while it has the margin left", () => {
    const secrets: VideoCallOAuthSecrets = {
      refreshToken: "r",
      accessToken: "a",
      accessTokenExpiresAt: "2026-10-09T12:05:00.000Z",
    };

    expect(
      VideoCallOAuthUtil.hasFreshAccessToken(secrets, 2 * 60 * 1000, NOW),
    ).toBe(true);
    expect(
      VideoCallOAuthUtil.hasFreshAccessToken(secrets, 10 * 60 * 1000, NOW),
    ).toBe(false);
    expect(
      VideoCallOAuthUtil.hasFreshAccessToken({ refreshToken: "r" }, 0, NOW),
    ).toBe(false);
  });

  test("finds a scope in a space- or comma-separated list", () => {
    const isMeet: (scope: string) => boolean = (scope: string): boolean => {
      return scope === "meet";
    };

    expect(VideoCallOAuthUtil.hasScope("openid meet", isMeet)).toBe(true);
    expect(VideoCallOAuthUtil.hasScope("openid,meet", isMeet)).toBe(true);
    expect(VideoCallOAuthUtil.hasScope("openid", isMeet)).toBe(false);
    expect(VideoCallOAuthUtil.hasScope(undefined, isMeet)).toBe(false);
  });
});

describe("VideoCallOAuthUtil.getRefreshError", () => {
  test("a sign-in that is gone says to reconnect the provider, naming the account", () => {
    const error: Error = VideoCallOAuthUtil.getRefreshError({
      response: response(400, { error: "invalid_grant" }),
      provider: VideoCallProvider.Zoom,
      accountLabel: "incidents@acme.com",
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toContain(
      "Zoom no longer accepts OneUptime's sign-in for incidents@acme.com",
    );
    expect(error.message).toContain(
      "Reconnect Zoom in Project Settings > Video Calls",
    );
  });

  test("a refused app is the server administrator's to fix", () => {
    const error: Error = VideoCallOAuthUtil.getRefreshError({
      response: response(401, { error: "invalid_client" }),
      provider: VideoCallProvider.GoogleMeet,
      accountLabel: "x",
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toContain("Ask your server administrator");
  });

  test("an outage is the provider's, not the settings'", () => {
    expect(
      VideoCallOAuthUtil.getRefreshError({
        response: response(503, { error: "temporarily_unavailable" }),
        provider: VideoCallProvider.MicrosoftTeams,
        accountLabel: "x",
      }),
    ).toBeInstanceOf(APIException);
  });
});
