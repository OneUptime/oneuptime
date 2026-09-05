import {
  REDACTED,
  isSensitiveLogKey,
  redactLogString,
  redactLogValue,
} from "../../../Server/Utils/LogRedaction";
import { describe, expect, it } from "@jest/globals";

/*
 * These are the regression tests for GHSA-3x69-fj58-3pc6 (Slack / Microsoft
 * Teams OAuth client secrets and access tokens written to DEBUG logs) and
 * GHSA-c4c2-r4hm-6pjj (login passwords and MFA material written to DEBUG
 * logs).
 *
 * The call sites that produced those two advisories have been removed, but the
 * class of bug is "somebody logs a request body". So the assertions here are
 * written against the payloads those handlers actually pass around -- a Slack
 * token exchange, a Microsoft Graph token response, a login body -- and they
 * check the property that matters: the secret is not in the output, in any
 * form, whether it arrived as an object or as text somebody had already
 * stringified.
 */

const SENTINEL: string = "sentinel-secret-value-a1b2c3d4";

type SerializeFunction = (value: unknown) => string;

// What the logger would end up writing for this body.
const serialize: SerializeFunction = (value: unknown): string => {
  return JSON.stringify(redactLogValue(value));
};

describe("isSensitiveLogKey", () => {
  it("matches credential keys in every spelling", () => {
    for (const key of [
      "password",
      "Password",
      "newPassword",
      "client_secret",
      "clientSecret",
      "CLIENT-SECRET",
      "access_token",
      "accessToken",
      "slackBotAccessToken",
      "refresh_token",
      "id_token",
      "authorization",
      "Authorization",
      "x-api-key",
      "apiKey",
      "Cookie",
      "set-cookie",
      "credential",
      "passwordSalt",
      "twoFactorSecret",
      "clientDataJSON",
      "authenticatorData",
      "userHandle",
      "rawId",
      "signature",
      "parameters",
      "parameterValues",
      "bindParameters",
    ]) {
      expect(isSensitiveLogKey(key)).toBe(true);
    }
  });

  it("leaves ordinary keys alone", () => {
    for (const key of [
      "email",
      "projectId",
      "userId",
      "client_id",
      "redirect_uri",
      "team",
      "statusCode",
      "expires_in",
      "scope",
      "name",
      "url",
      "isAuthorized",
    ]) {
      expect(isSensitiveLogKey(key)).toBe(false);
    }
  });

  it("keeps token accounting, which is not a token", () => {
    expect(isSensitiveLogKey("tokenCount", 42)).toBe(false);
    expect(isSensitiveLogKey("totalTokens", 42)).toBe(false);
    expect(isSensitiveLogKey("inputTokens", 42)).toBe(false);
  });

  /*
   * `code` is the one key that has to be decided by its value: it is the OAuth
   * authorization code and the TOTP code, and it is also the `ECONNREFUSED` on
   * every failed socket.
   */
  it("treats `code` as secret only when the value looks like one", () => {
    expect(isSensitiveLogKey("code", "123456")).toBe(true);
    expect(isSensitiveLogKey("code", "1234.5678.abcdef0123456789")).toBe(true);
    expect(isSensitiveLogKey("code", 123456)).toBe(true);

    expect(isSensitiveLogKey("code", "ECONNREFUSED")).toBe(false);
    expect(isSensitiveLogKey("code", "BadDataException")).toBe(false);
    expect(isSensitiveLogKey("code", 500)).toBe(false);
  });
});

describe("redactLogValue - Slack OAuth payloads (GHSA-3x69-fj58-3pc6)", () => {
  it("redacts the token request body the callback used to log", () => {
    // Exactly the object Common/Server/API/SlackAPI.ts builds.
    const requestBody: Record<string, unknown> = {
      code: "1234567890.9876543210." + SENTINEL,
      client_id: "1234567890.1111111111",
      client_secret: SENTINEL,
      redirect_uri: "https://oneuptime.com/api/slack/auth/project/user",
    };

    const output: string = serialize(requestBody);

    expect(output).not.toContain(SENTINEL);
    expect(JSON.parse(output)).toEqual({
      code: REDACTED,
      client_id: "1234567890.1111111111",
      client_secret: REDACTED,
      redirect_uri: "https://oneuptime.com/api/slack/auth/project/user",
    });
  });

  it("redacts the oauth.v2.access response, bot and user tokens both", () => {
    const responseBody: Record<string, unknown> = {
      ok: true,
      access_token: "xoxb-1111-2222-" + SENTINEL,
      token_type: "bot",
      bot_user_id: "U0123BOT",
      team: { id: "T0123", name: "Acme" },
      authed_user: {
        id: "U0123USER",
        access_token: "xoxp-3333-4444-" + SENTINEL,
        refresh_token: "xoxe-1-" + SENTINEL,
      },
    };

    const output: string = serialize(responseBody);

    expect(output).not.toContain(SENTINEL);
    // Non-secret context survives, so the log line is still worth reading.
    expect(output).toContain("U0123BOT");
    expect(output).toContain("Acme");
    expect(JSON.parse(output).authed_user.access_token).toBe(REDACTED);
  });

  it("redacts a decoded Slack ID token", () => {
    const decoded: Record<string, unknown> = {
      sub: "U0123",
      email: "user@example.com",
      "https://slack.com/team_id": "T0123",
      at_hash: SENTINEL,
      nonce: "abcd",
    };

    // The id_token key itself is enough to redact the whole subtree.
    expect(serialize({ id_token: decoded })).not.toContain(SENTINEL);
  });
});

describe("redactLogValue - Microsoft Teams OAuth payloads (GHSA-3x69-fj58-3pc6)", () => {
  it("redacts the token request body", () => {
    const tokenRequestBody: Record<string, unknown> = {
      grant_type: "authorization_code",
      code: "0.AAAA" + SENTINEL,
      client_id: "00000000-0000-0000-0000-000000000000",
      client_secret: SENTINEL,
      redirect_uri: "https://oneuptime.com/api/microsoft-teams/auth",
      scope: "https://graph.microsoft.com/User.Read",
    };

    const output: string = serialize(tokenRequestBody);

    expect(output).not.toContain(SENTINEL);
    expect(output).toContain("authorization_code");
    expect(output).toContain("https://graph.microsoft.com/User.Read");
  });

  it("redacts the token response, including the application access token", () => {
    const tokenData: Record<string, unknown> = {
      token_type: "Bearer",
      expires_in: 3599,
      access_token: "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.ey" + SENTINEL,
      refresh_token: "0.AQ" + SENTINEL,
      id_token: "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.ey" + SENTINEL,
    };

    const output: string = serialize(tokenData);

    expect(output).not.toContain(SENTINEL);
    expect(output).toContain("3599");
  });
});

describe("redactLogValue - login payloads (GHSA-c4c2-r4hm-6pjj)", () => {
  it("redacts the password out of a login body", () => {
    const body: Record<string, unknown> = {
      data: {
        email: "user@example.com",
        password: SENTINEL,
      },
      miscDataProps: { captchaToken: "captcha-" + SENTINEL },
    };

    const output: string = serialize(body);

    expect(output).not.toContain(SENTINEL);
    expect(output).toContain("user@example.com");
  });

  it("redacts a TOTP code", () => {
    const body: Record<string, unknown> = {
      data: { code: "123456", twoFactorAuthId: "6543210987654321" },
    };

    const output: string = serialize(body);

    expect(output).not.toContain("123456");
    expect(output).toContain("6543210987654321");
  });

  it("redacts WebAuthn assertion material", () => {
    const body: Record<string, unknown> = {
      data: {
        credential: {
          id: "credential-id",
          rawId: SENTINEL,
          response: {
            clientDataJSON: SENTINEL,
            authenticatorData: SENTINEL,
            signature: SENTINEL,
            userHandle: SENTINEL,
          },
        },
      },
    };

    expect(serialize(body)).not.toContain(SENTINEL);
  });
});

describe("redactLogString", () => {
  it("redacts a stringified login body - the exact shape of the advisory", () => {
    const message: string =
      "Login request data: " +
      JSON.stringify(
        { data: { email: "user@example.com", password: SENTINEL } },
        null,
        2,
      );

    const output: string = redactLogString(message);

    expect(output).not.toContain(SENTINEL);
    expect(output).toContain("user@example.com");
  });

  it("redacts a password whose value contains an escaped quote", () => {
    const message: string = JSON.stringify({
      password: `${SENTINEL}"still-secret`,
    });

    expect(redactLogString(message)).not.toContain(SENTINEL);
    expect(redactLogString(message)).not.toContain("still-secret");
  });

  it("redacts a stringified WebAuthn assertion", () => {
    const message: string =
      "Login request data: " +
      JSON.stringify({
        data: {
          credential: {
            id: "credential-id",
            rawId: SENTINEL,
            response: {
              clientDataJSON: SENTINEL,
              authenticatorData: SENTINEL,
              signature: SENTINEL,
              userHandle: SENTINEL,
            },
          },
        },
      });

    expect(redactLogString(message)).not.toContain(SENTINEL);
  });

  it("redacts form-encoded and query-string credentials", () => {
    expect(
      redactLogString(`client_secret=${SENTINEL}&client_id=1234&grant_type=x`),
    ).toBe(`client_secret=${REDACTED}&client_id=1234&grant_type=x`);

    expect(
      redactLogString(
        `https://oneuptime.com/api/slack/auth/p/u?code=${SENTINEL}&state=abc`,
      ),
    ).toBe(
      `https://oneuptime.com/api/slack/auth/p/u?code=${REDACTED}&state=abc`,
    );
  });

  it("redacts the whole token after an authorization scheme, not just the scheme", () => {
    const output: string = redactLogString(
      `Authorization: Bearer ${SENTINEL}-1234567890`,
    );

    expect(output).not.toContain(SENTINEL);
  });

  it("redacts self-identifying secrets regardless of their key", () => {
    const jwt: string =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk";

    expect(redactLogString(`token is ${jwt}`)).not.toContain(jwt);
    expect(
      redactLogString("bot token xoxb-1111-2222-abcdefghijklmnop"),
    ).not.toContain("xoxb-1111-2222-abcdefghijklmnop");
    expect(
      redactLogString(
        "-----BEGIN RSA PRIVATE KEY-----\nMIIabc123\n-----END RSA PRIVATE KEY-----",
      ),
    ).not.toContain("MIIabc123");
    expect(
      redactLogString("postgres://oneuptime:hunter2@postgres:5432/oneuptimedb"),
    ).not.toContain("hunter2");
  });

  it("redacts Telegram bot credentials embedded in request paths", () => {
    const botToken: string = "1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi";
    const url: string = `https://api.telegram.org/bot${botToken}/sendMessage`;

    const output: string = redactLogString(
      `Request to ${url} failed with ECONNRESET`,
    );

    expect(output).not.toContain(botToken);
    expect(output).toContain(`/bot${REDACTED}/sendMessage`);
    expect(output).toContain("ECONNRESET");
  });

  it("redacts a Telegram bot URL nested inside an Error", () => {
    const botToken: string = "9876543210:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi";
    const error: Error = new Error(
      `POST https://api.telegram.org/bot${botToken}/sendMessage failed`,
    );

    expect(serialize(error)).not.toContain(botToken);
  });

  it("leaves ordinary log lines untouched", () => {
    for (const message of [
      "Slack token exchange completed. ok: true",
      "Token exchange completed",
      "Basic authentication failed for this request",
      "Exchanging Slack authorization code for an access token.",
      "Microsoft Teams token exchange completed.",
      "User logged in: user@example.com",
      "Monitor probe finished in 42ms",
      "GET https://oneuptime.com/api/status-page/1234 -> 200",
      "GET https://api.telegram.org/bot/status -> 200",
    ]) {
      expect(redactLogString(message)).toBe(message);
    }
  });
});

describe("redactLogValue - safety properties", () => {
  it("does not mutate the caller's object", () => {
    const body: Record<string, unknown> = { password: SENTINEL };

    redactLogValue(body);

    expect(body["password"]).toBe(SENTINEL);
  });

  it("survives circular references", () => {
    const body: Record<string, unknown> = { password: SENTINEL, name: "loop" };
    body["self"] = body;

    const output: string = serialize(body);

    expect(output).not.toContain(SENTINEL);
    expect(output).toContain("[Circular]");
  });

  it("redacts a value repeated in two branches, rather than calling it circular", () => {
    const shared: Record<string, unknown> = { access_token: SENTINEL };
    const output: string = serialize({ first: shared, second: shared });

    expect(output).not.toContain(SENTINEL);
    expect(output).not.toContain("[Circular]");
  });

  it("redacts secrets nested in arrays", () => {
    expect(
      serialize({ workspaces: [{ name: "a", authToken: SENTINEL }] }),
    ).not.toContain(SENTINEL);
  });

  it("redacts secrets carried on an Error", () => {
    const error: Error & { client_secret?: string } = new Error(
      `token exchange failed for client_secret=${SENTINEL}`,
    );
    error.client_secret = SENTINEL;

    expect(serialize(error)).not.toContain(SENTINEL);
  });

  it("honours toJSON so model logging keeps its shape", () => {
    const model: { toJSON: () => Record<string, unknown> } = {
      toJSON: (): Record<string, unknown> => {
        return { _id: "1234", password: SENTINEL };
      },
    };

    const output: string = serialize(model);

    expect(output).not.toContain(SENTINEL);
    expect(JSON.parse(output)._id).toBe("1234");
  });

  it("stops at a depth limit instead of recursing forever", () => {
    let deep: Record<string, unknown> = { password: SENTINEL };

    for (let i: number = 0; i < 40; i++) {
      deep = { nested: deep };
    }

    const output: string = serialize(deep);

    expect(output).not.toContain(SENTINEL);
    expect(output).toContain("[Truncated]");
  });
});
