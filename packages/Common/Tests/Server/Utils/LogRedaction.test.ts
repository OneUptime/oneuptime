import {
  REDACTED,
  isSensitiveLogKey,
  redactLogString,
  redactLogValue,
} from "../../../Server/Utils/LogRedaction";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, it } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

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
      "codeVerifier",
      "code_verifier",
      "CODE-VERIFIER",
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

describe("mobile passkey PKCE exchange redaction", () => {
  it("redacts both the authorization code and the verifier in a structured body", () => {
    const output: string = serialize({
      code: SENTINEL,
      codeVerifier: SENTINEL,
      state: "public-correlation-value",
    });
    expect(output).not.toContain(SENTINEL);
    expect(JSON.parse(output)).toEqual({
      code: REDACTED,
      codeVerifier: REDACTED,
      state: "public-correlation-value",
    });
  });

  it.each(["codeVerifier", "code_verifier", "code-verifier"])(
    "redacts %s after a request body or URL has already been stringified",
    (key: string) => {
      for (const value of [
        JSON.stringify({ [key]: SENTINEL }),
        `${key}=${SENTINEL}&state=public`,
        `https://example.com/identity/mobile-passkey-exchange?${key}=${SENTINEL}`,
      ]) {
        expect(redactLogString(value)).not.toContain(SENTINEL);
        expect(redactLogString(value)).toContain(REDACTED);
      }
    },
  );
});

/*
 * The key OneUptime's own services present to each other travels in the
 * clusterkey request header (x-clusterkey as KEDA sends it), and Runners of
 * earlier releases put it in the clusterKey field of their registration. A
 * failed internal call logs the request the client was making - its
 * headers, its body, the raw request it had started writing - so each of
 * those shapes is redacted, like any other credential.
 */
describe("the cluster key OneUptime's services present", () => {
  const KEY: string = "Q7dVk2LmX9pR4tWz8NcB1sHf6JyG3uAe";
  const ENCODED_KEY: string = encodeURIComponent("p@ss/w0rd?&=+%#;: spaces");

  it("is a sensitive key in every spelling of its name", () => {
    for (const key of [
      "clusterkey",
      "clusterKey",
      "ClusterKey",
      "x-clusterkey",
      "X-ClusterKey",
      "cluster_key",
      "CLUSTER-KEY",
    ]) {
      expect({ key, sensitive: isSensitiveLogKey(key, KEY) }).toEqual({
        key,
        sensitive: true,
      });
    }
  });

  it("is redacted from a request's headers, its body and an error carrying them, structurally", () => {
    for (const value of [KEY, ENCODED_KEY]) {
      const output: string = serialize({
        config: {
          url: "http://app:3002/api/notification/email/send",
          headers: {
            Accept: "application/json",
            clusterkey: value,
            "x-clusterkey": value,
          },
          data: { aiAgentKey: "public-agent-name", clusterKey: value },
        },
      });

      expect(output).not.toContain(value);
      expect(output).toContain("/api/notification/email/send");
      expect(JSON.parse(output).config.headers.Accept).toBe("application/json");
    }
  });

  it("is redacted from a body that was already stringified", () => {
    for (const value of [KEY, ENCODED_KEY]) {
      const message: string = JSON.stringify({
        aiAgentKey: "the-runner-key",
        runnerName: "in-cluster",
        clusterKey: value,
      });

      expect(redactLogString(message)).not.toContain(value);
      expect(redactLogString(message)).toContain('"runnerName":"in-cluster"');
    }
  });

  it("is redacted from a raw request a client had started writing, and from a URL", () => {
    for (const value of [KEY, ENCODED_KEY]) {
      for (const text of [
        `POST /api/ai-agent/register HTTP/1.1\r\nAccept: application/json\r\nclusterkey: ${value}\r\nHost: oneuptime-app:3002\r\n\r\n`,
        `POST /api/notification/sms/send HTTP/1.1\r\nX-ClusterKey: ${value}\r\n`,
        `http://oneuptime-app:3002/api/notification/email/send?clusterKey=${value}&start=0`,
        `cluster_key=${value}`,
      ]) {
        const output: string = redactLogString(text);

        expect({ text, holdsTheKey: output.includes(value) }).toEqual({
          text,
          holdsTheKey: false,
        });
        expect(output).toContain(REDACTED);
      }
    }
  });

  it("leaves prose about the key, and words that merely contain it, alone", () => {
    for (const text of [
      "Cluster key not found.",
      "Invalid cluster key provided",
      "Cluster keys rotate with ONEUPTIME_SECRET.",
    ]) {
      expect(redactLogString(text)).toBe(text);
    }
  });
});

/*
 * The key travels URI-encoded (ClusterKeyAuthorization.getClusterKey), and
 * encodeURIComponent leaves ' ( ) ! * ~ as they are - characters that end a
 * value in prose. However the key's value is written after its name, none of
 * it stays: not the part before such a character, and not the part after.
 */
describe("the cluster key's value, with the characters it travels with", () => {
  const RAW_KEYS: Array<string> = [
    "it's-(my)-key!*~Q7dVk2LmX9pR4tWz8NcB1sHf",
    "a)Q7dVk2LmX9pR4tWz8NcB1sHf6JyG3uAe",
    "(Q7dVk2LmX9pR4tWz8NcB1sHf6JyG3uAe)",
    "Q7dVk2LmX9pR4tWz8N'cB1sHf6JyG3uAe",
    "p@ss/w0rd?&=+%#;: with (spaces)",
  ];

  // Every run of 12 characters of the value: none may survive.
  function keptParts(output: string, value: string): Array<string> {
    const kept: Set<string> = new Set<string>();

    for (let start: number = 0; start + 12 <= value.length; start++) {
      const part: string = value.slice(start, start + 12);

      if (output.includes(part)) {
        kept.add(part);
      }
    }

    return Array.from(kept);
  }

  it("leaves none of it in a header line, a field, a quoted value or a raw request stringified again", () => {
    for (const raw of RAW_KEYS) {
      const value: string = encodeURIComponent(raw);

      for (const text of [
        `POST /api/ai-agent/register HTTP/1.1\r\nAccept: application/json\r\nclusterkey: ${value}\r\nHost: oneuptime-app:3002\r\n\r\n`,
        `POST /api/notification/sms/send HTTP/1.1\r\nX-ClusterKey: ${value}\r\n`,
        JSON.stringify({
          _header: `POST /workflow/update/1 HTTP/1.1\r\nclusterkey: ${value}\r\nHost: oneuptime-app:3002\r\n`,
        }),
        `http://oneuptime-app:3002/workflow/update/1?clusterKey=${value}&start=0`,
        `cluster_key=${value}`,
        `{ clusterkey: '${value}', accept: 'application/json' }`,
        `{ "x-clusterkey": "${value}" }`,
        `clusterKey: ${value}`,
      ]) {
        const output: string = redactLogString(text);

        expect({ text, kept: keptParts(output, value) }).toEqual({
          text,
          kept: [],
        });
        expect(output).toContain(REDACTED);
      }
    }
  });

  it("keeps what follows the value", () => {
    const value: string = encodeURIComponent(RAW_KEYS[0]!);

    expect(
      redactLogString(
        `POST /x HTTP/1.1\r\nclusterkey: ${value}\r\nHost: oneuptime-app:3002\r\n`,
      ),
    ).toBe(
      `POST /x HTTP/1.1\r\nclusterkey: ${REDACTED}\r\nHost: oneuptime-app:3002\r\n`,
    );
    expect(redactLogString(`clusterKey=${value}&start=0&end=100`)).toBe(
      `clusterKey=${REDACTED}&start=0&end=100`,
    );
    expect(
      redactLogString(`{ clusterkey: '${value}', accept: 'application/json' }`),
    ).toBe(`{ clusterkey: ${REDACTED}, accept: 'application/json' }`);
  });

  it("is left to the JSON rules inside JSON, which keep the member's shape", () => {
    const value: string = encodeURIComponent(RAW_KEYS[0]!);

    expect(
      redactLogString(JSON.stringify({ clusterKey: value, runnerName: "a" })),
    ).toBe(`{"clusterKey":"${REDACTED}","runnerName":"a"}`);
  });
});

/*
 * Log lines are text anybody can put a header or a field into, so the
 * cluster key's spellings must keep every rule's time in line with the
 * text's length: about 400,000 characters of each worst case, each read in
 * well under 2 seconds.
 */
describe("the cluster key's spellings keep redaction linear", () => {
  const LENGTH: number = 400000;

  it.each([
    ["the name run together", "clusterkey".repeat(LENGTH / 10)],
    ["the name's start over and over", "cluster_".repeat(LENGTH / 8)],
    ["names and separators with no value", "x-clusterkey=".repeat(LENGTH / 13)],
    ["an unterminated JSON member", `"clusterKey":"${"a".repeat(LENGTH)}`],
    ["a header line with a long value", `clusterkey: ${"k".repeat(LENGTH)}`],
    ["a header line of spaces", `clusterkey:${" ".repeat(LENGTH)}`],
    [
      "a value of the characters the key travels with",
      `clusterkey: ${"'()!*~".repeat(LENGTH / 6)}`,
    ],
    ["an unterminated quoted value", `clusterkey: "${"a".repeat(LENGTH)}`],
    [
      "an unterminated quoted value of escapes",
      `clusterkey: "${'\\"'.repeat(LENGTH / 2)}`,
    ],
    ["names and quotes over and over", 'clusterkey:"'.repeat(LENGTH / 12)],
    ["names and escaped quotes", 'clusterkey: \\"'.repeat(LENGTH / 14)],
    ["names with no separator", "x-clusterkey ".repeat(LENGTH / 13)],
    [
      "names run together with what a name may start and end with",
      `${"UCLUSTERKEY-".repeat(LENGTH / 12)}\u0000`,
    ],
  ])("%s", (_label: string, text: string) => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        redactLogString(text);
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });
});

/*
 * Credentials in a URL (scheme://user:password@host) are found wherever a
 * scheme can start, and a scheme can start at every word. Log text that
 * names a credential (and so goes through every rule) can be one long run of
 * words joined by - or . with no :// in it: it must still be read in time in
 * line with its length.
 */
describe("credentials in a URL", () => {
  const LENGTH: number = 400000;

  it("are redacted, whatever the scheme", () => {
    for (const [url, password] of [
      ["postgres://oneuptime:hunter2@postgres:5432/oneuptimedb", "hunter2"],
      ["mongodb+srv://admin:p4ss-w0rd@cluster0.example.net/db", "p4ss-w0rd"],
      ["amqps://guest:guest-secret@rabbit/vhost", "guest-secret"],
      ["see https://user:pa55@example.com/path and more", "pa55"],
      [`${"s".repeat(64)}://user:long-scheme-pass@host`, "long-scheme-pass"],
    ] as Array<[string, string]>) {
      const output: string = redactLogString(url);

      expect({ url, holdsThePassword: output.includes(password) }).toEqual({
        url,
        holdsThePassword: false,
      });
    }
  });

  it.each([
    ["words joined by hyphens", "secret-".repeat(LENGTH / 7)],
    ["words joined by dots", "token.".repeat(LENGTH / 6)],
    [
      "the cluster key's name joined by hyphens",
      "UCLUSTERKEY-".repeat(LENGTH / 12),
    ],
    ["one letter and dotted capitals", `secret a${".C".repeat(LENGTH / 2)}`],
    ["capitals joined by plus signs", `secret ${"A+".repeat(LENGTH / 2)}`],
  ])(
    "are looked for in time in line with the text: %s",
    (_label: string, text: string) => {
      const timed: FastestRun<void> = fastestRun({
        run: (): void => {
          redactLogString(text);
        },
        limitInMs: 2000,
      });

      expect(timed.inMs).toBeLessThan(2000);
    },
  );
});

/*
 * Every run of 12 characters of a value (the whole value when it is
 * shorter) that a text still holds. Redaction that stopped at a character
 * it took for the end of the value would leave the rest of the value in
 * the clear, and the whole value would no longer be found.
 */
function keptRunsOf(output: string, value: string): Array<string> {
  if (value.length <= 12) {
    return output.includes(value) ? [value] : [];
  }

  const kept: Set<string> = new Set<string>();

  for (let start: number = 0; start + 12 <= value.length; start++) {
    const run: string = value.slice(start, start + 12);

    if (output.includes(run)) {
      kept.add(run);
    }
  }

  return Array.from(kept);
}

/*
 * The keys OneUptime's own components present when they call the server: a
 * Runner's key (aiAgentKey on the code-fix protocol and its registration,
 * agentKey on the runbook mount, previousRunnerKey when a Kubernetes agent
 * Runner registers again, the x-agent-key header, ONEUPTIME_RUNNER_KEY), a
 * probe's key (probeKey, PROBE_KEY), the key that registers a global probe
 * (registerProbeKey, REGISTER_PROBE_KEY), a telemetry ingestion key in the
 * x-oneuptime-ingestion-key header and an enterprise licence key. A call
 * that gets no answer is logged with the request it was making - its body
 * as the JSON text the client sent, its headers, the raw request it had
 * started writing - and every log record reaches the console, the
 * recent-log buffer a support bundle reads and the log exporter. Each key
 * is redacted there like the cluster key: by its name, and in text, the
 * whole value.
 */
describe("the keys OneUptime's own components present", () => {
  // Keys an operator sets can hold any character; the dashboard issues uuids.
  const RUNNER_KEY: string = "it's-(runner)-key!*~R7dVk2LmX9pR4tWz8NcB1sHf";
  const ISSUED_KEY: string = "5f2c1e9a-7b3d-4c8e-9f1a-2b3c4d5e6f70";
  const PROBE_KEY: string = "pr0be-(key)!*~Zq9Lm2Xv8Nc4Bt6Hj1Kp";
  const REGISTER_PROBE_KEY: string = "global-probes-(registration)!~3Xc9Vb2Nm8";
  const INGESTION_KEY: string = "8f7e6d5c-4b3a-4291-8a7b-6c5d4e3f2a10";
  const LICENSE_KEY: string = "ACME-1234-ABCD-5678-EFGH-9XYZ";
  const AGENT_ID: string = "2b3c4d5e-6f70-4a81-9b2c-3d4e5f607182";

  it("are sensitive keys in every spelling of their names", () => {
    for (const key of [
      "aiAgentKey",
      "agentKey",
      "AgentKey",
      "agent_key",
      "x-agent-key",
      "X-Agent-Key",
      "previousAgentKey",
      "runnerKey",
      "previousRunnerKey",
      "ONEUPTIME_RUNNER_KEY",
      "RUNNER_KEY",
      "probeKey",
      "ProbeKey",
      "probe_key",
      "PROBE_KEY",
      "registerProbeKey",
      "REGISTER_PROBE_KEY",
      "x-oneuptime-ingestion-key",
      "ONEUPTIME_INGESTION_KEY",
      "ONEUPTIME_TELEMETRY_INGESTION_KEY",
      "ingestionKey",
      "licenseKey",
      "enterpriseLicenseKey",
      "LICENSE_KEY",
    ]) {
      expect({ key, sensitive: isSensitiveLogKey(key, ISSUED_KEY) }).toEqual({
        key,
        sensitive: true,
      });
    }
  });

  it("leave the names that only identify a component, and the ids of keys, alone", () => {
    for (const key of [
      "agentId",
      "aiAgentId",
      "runnerId",
      "probeId",
      "runnerName",
      "probeName",
      "clusterName",
      "agentVersion",
      "probeCapabilities",
      "ingestionKeyId",
      "telemetryIngestionKeyId",
      "registeredWithIngestionKeyId",
    ]) {
      expect({ key, sensitive: isSensitiveLogKey(key, AGENT_ID) }).toEqual({
        key,
        sensitive: false,
      });
    }
  });

  it("are redacted from the request a failed call was making, structurally", () => {
    const output: string = serialize({
      config: {
        url: "https://oneuptime.example.com/runner-ingest/heartbeat",
        headers: {
          Accept: "application/json",
          "x-agent-key": RUNNER_KEY,
          "x-oneuptime-ingestion-key": INGESTION_KEY,
        },
        data: {
          agentId: AGENT_ID,
          agentKey: RUNNER_KEY,
          aiAgentKey: ISSUED_KEY,
          previousRunnerKey: ISSUED_KEY,
          probeKey: PROBE_KEY,
          registerProbeKey: REGISTER_PROBE_KEY,
          licenseKey: LICENSE_KEY,
        },
      },
    });

    for (const value of [
      RUNNER_KEY,
      ISSUED_KEY,
      PROBE_KEY,
      REGISTER_PROBE_KEY,
      INGESTION_KEY,
      LICENSE_KEY,
    ]) {
      expect({ value, kept: keptRunsOf(output, value) }).toEqual({
        value,
        kept: [],
      });
    }

    expect(JSON.parse(output).config.data.agentId).toBe(AGENT_ID);
    expect(output).toContain("/runner-ingest/heartbeat");
  });

  it("leave none of the value in the JSON a client sent, a header line, a field or a console print", () => {
    for (const value of [
      RUNNER_KEY,
      ISSUED_KEY,
      PROBE_KEY,
      REGISTER_PROBE_KEY,
      INGESTION_KEY,
      LICENSE_KEY,
    ]) {
      const encoded: string = encodeURIComponent(value);

      for (const text of [
        // The bodies the Runner and the probe send, as a client keeps them.
        JSON.stringify({ aiAgentKey: value, aiAgentId: AGENT_ID }),
        JSON.stringify({
          agentId: AGENT_ID,
          agentKey: value,
          agentVersion: "14.0.72",
        }),
        JSON.stringify({ clusterName: "prod", previousRunnerKey: value }),
        JSON.stringify({
          probeKey: value,
          probeId: AGENT_ID,
          probeCapabilities: ["networkDevicePing"],
        }),
        JSON.stringify({
          probeKey: value,
          probeName: null,
          registerProbeKey: value,
        }),
        JSON.stringify({ licenseKey: value }),
        // Raw requests a client had started writing.
        `POST /runner-ingest/heartbeat HTTP/1.1\r\nx-agent-key: ${encoded}\r\nHost: oneuptime\r\n\r\n`,
        `POST /otlp/v1/logs HTTP/1.1\r\nx-oneuptime-ingestion-key: ${encoded}\r\nHost: oneuptime\r\n`,
        // Fields, as a form, a query or an environment writes them.
        `agentId=${AGENT_ID}&agentKey=${encoded}&agentVersion=14.0.72`,
        `https://oneuptime.example.com/probe-ingest/alive?probeKey=${encoded}`,
        `PROBE_KEY=${encoded}`,
        `REGISTER_PROBE_KEY=${encoded}`,
        `ONEUPTIME_RUNNER_KEY=${encoded}`,
        // A console's print of the body, quoted the way it quotes the value.
        value.includes("'")
          ? `{ agentKey: "${value}", agentId: '${AGENT_ID}' }`
          : `{ agentKey: '${value}', agentId: '${AGENT_ID}' }`,
        `{ probeKey: '${encoded}', probeId: '${AGENT_ID}' }`,
      ]) {
        const output: string = redactLogString(text);

        for (const form of [value, encoded]) {
          expect({ text, kept: keptRunsOf(output, form) }).toEqual({
            text,
            kept: [],
          });
        }

        expect(output).toContain(REDACTED);
      }
    }
  });

  it("leave none of a value with spaces and delimiters in a console's quoted print", () => {
    const value: string = "a key, with spaces; & ] } delimiters";

    expect(
      keptRunsOf(
        redactLogString(`{ agentKey: '${value}', agentId: '${AGENT_ID}' }`),
        value,
      ),
    ).toEqual([]);
    expect(
      keptRunsOf(redactLogString(JSON.stringify({ probeKey: value })), value),
    ).toEqual([]);
  });

  it("keep what follows the value", () => {
    expect(
      redactLogString(
        `agentId=${AGENT_ID}&agentKey=${encodeURIComponent(RUNNER_KEY)}&agentVersion=14.0.72`,
      ),
    ).toBe(`agentId=${AGENT_ID}&agentKey=${REDACTED}&agentVersion=14.0.72`);
    expect(
      redactLogString(
        `POST /x HTTP/1.1\r\nx-agent-key: ${ISSUED_KEY}\r\nHost: oneuptime\r\n`,
      ),
    ).toBe(
      `POST /x HTTP/1.1\r\nx-agent-key: ${REDACTED}\r\nHost: oneuptime\r\n`,
    );
    expect(
      redactLogString(
        JSON.stringify({ probeKey: PROBE_KEY, probeId: AGENT_ID }),
      ),
    ).toBe(`{"probeKey":"${REDACTED}","probeId":"${AGENT_ID}"}`);
    expect(
      redactLogString(`{ agentKey: '${ISSUED_KEY}', agentId: '${AGENT_ID}' }`),
    ).toBe(`{ agentKey: ${REDACTED}, agentId: '${AGENT_ID}' }`);
  });

  it("leave the messages that name a key without its value alone", () => {
    for (const text of [
      "agentId or agentKey is missing",
      "Invalid agentId or agentKey",
      "ProbeId or ProbeKey is missing",
      "Invalid or missing registerProbeKey. Please check REGISTER_PROBE_KEY environment variable.",
      "Unable to register probe after 10 attempts. Check PROBE_KEY / REGISTER_PROBE_KEY / connectivity to https://oneuptime.com/probe-ingest.",
      "ONEUPTIME_RUNNER_KEY is not set. Create a Runner in your OneUptime dashboard (Runbooks > Runners) and copy its id and key into this container.",
      "Runner key not found - the Runner has not finished registering yet.",
      "The ingestion key was rotated by a project admin.",
      "A license key is required to turn this on.",
    ]) {
      expect(redactLogString(text)).toBe(text);
    }
  });
});

/*
 * Log lines are text anybody can put a header or a field into, so the
 * names of these keys must keep every rule's time in line with the text's
 * length: about 400,000 characters of each worst case, each read in well
 * under 2 seconds.
 */
describe("the keys' names keep redaction linear", () => {
  const LENGTH: number = 400000;

  it.each([
    ["names run together", "registerProbeKey".repeat(LENGTH / 16)],
    ["a name's start over and over", "agent_".repeat(LENGTH / 6)],
    ["names and separators with no value", "x-agent-key=".repeat(LENGTH / 12)],
    ["an unterminated JSON member", `"probeKey":"${"a".repeat(LENGTH)}`],
    ["a header line with a long value", `x-agent-key: ${"k".repeat(LENGTH)}`],
    ["an unterminated single-quoted value", `agentKey: '${"a".repeat(LENGTH)}`],
    [
      "an unterminated single-quoted value of escapes",
      `agentKey: '${"\\'".repeat(LENGTH / 2)}`,
    ],
    ["names and single quotes over and over", "probeKey:'".repeat(LENGTH / 10)],
    [
      "names and closed quotes no delimiter follows",
      "runnerKey: 'a'b".repeat(LENGTH / 15),
    ],
    [
      "names run together with what a name may start and end with",
      `${"UPROBEKEY-".repeat(LENGTH / 10)}\u{0}`,
    ],
    [
      "every name of the rule, joined by hyphens",
      "ingestion-key-license-key-runner-key-agent-key-probe-key-cluster-key-".repeat(
        LENGTH / 69,
      ),
    ],
  ])("%s", (_label: string, text: string) => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        redactLogString(text);
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });
});

/*
 * A client keeps a request's body as the JSON text it sent, and an error
 * that carries the request can be written out as JSON text in its turn -
 * JSON.stringify(error), as the probe's monitoring jobs log a failed fetch.
 * The body is then a JSON string inside JSON text, its quotes escaped, and
 * escaped again each time the text is stringified once more. A key in it
 * is redacted there too, the whole value, and the members around it are
 * kept.
 */
describe("a request body stringified again", () => {
  const ISSUED_KEY: string = "5f2c1e9a-7b3d-4c8e-9f1a-2b3c4d5e6f70";
  const OPERATOR_KEY: string = "it's-(runner)-key!*~R7dVk2LmX9pR4tWz8NcB1sHf";
  const QUOTED_KEY: string = 'a "quoted" key\\with a backslash, and more';
  const AGENT_ID: string = "2b3c4d5e-6f70-4a81-9b2c-3d4e5f607182";

  // A request that got no answer, as JSON.stringify writes out its error.
  function failedRequestText(body: JSONObject, space?: number): string {
    return JSON.stringify(
      {
        message: "connect ECONNREFUSED 127.0.0.1:3000",
        name: "AxiosError",
        config: {
          url: "https://oneuptime.example.com/probe-ingest/monitor/list",
          method: "post",
          headers: { "Content-Type": "application/json" },
          data: JSON.stringify(body),
        },
        code: "ECONNREFUSED",
      },
      null,
      space,
    );
  }

  // The body a failed request's text holds, read back.
  function bodyIn(text: string): JSONObject {
    const failure: JSONObject = JSON.parse(text) as JSONObject;

    return JSON.parse(
      (failure["config"] as JSONObject)["data"] as string,
    ) as JSONObject;
  }

  // A text, stringified again this many more times.
  function stringifiedAgain(text: string, times: number): string {
    let again: string = text;

    for (let time: number = 0; time < times; time++) {
      again = JSON.stringify(again);
    }

    return again;
  }

  // The same text, read back from that many more stringifications.
  function parsedBack(text: string, times: number): string {
    let back: string = text;

    for (let time: number = 0; time < times; time++) {
      back = JSON.parse(back) as string;
    }

    return back;
  }

  const BODIES: Array<[string, (value: string) => JSONObject]> = [
    [
      "a probe's",
      (value: string): JSONObject => {
        return { probeKey: value, probeId: AGENT_ID, limit: 100 };
      },
    ],
    [
      "a global probe's registration",
      (value: string): JSONObject => {
        return { probeKey: value, registerProbeKey: value, probeName: null };
      },
    ],
    [
      "a Runner's code-fix call",
      (value: string): JSONObject => {
        return { aiAgentKey: value, aiAgentId: AGENT_ID };
      },
    ],
    [
      "a Runner's runbook call",
      (value: string): JSONObject => {
        return { agentId: AGENT_ID, agentKey: value };
      },
    ],
    [
      "a Kubernetes agent Runner's registration",
      (value: string): JSONObject => {
        return { clusterName: "prod", previousRunnerKey: value };
      },
    ],
    [
      "a licence check",
      (value: string): JSONObject => {
        return { licenseKey: value, instanceId: AGENT_ID };
      },
    ],
    [
      "a sign-in",
      (value: string): JSONObject => {
        return { email: "a@example.com", password: value };
      },
    ],
  ];

  it.each(BODIES)(
    "leaves none of the key in %s body, however many times it was stringified",
    (_label: string, bodyWith: (value: string) => JSONObject) => {
      for (const value of [ISSUED_KEY, OPERATOR_KEY, QUOTED_KEY]) {
        const body: JSONObject = bodyWith(value);

        for (const times of [0, 1, 2]) {
          for (const space of [undefined, 2]) {
            const text: string = stringifiedAgain(
              failedRequestText(body, space),
              times,
            );
            const output: string = redactLogString(text);

            // What the body says once read back: the key is gone, the rest is there.
            const kept: JSONObject = bodyIn(parsedBack(output, times));

            expect({ times, space, kept }).toEqual({
              times,
              space,
              kept: Object.fromEntries(
                Object.entries(body).map(
                  ([name, member]: [string, unknown]): [string, unknown] => {
                    return [name, member === value ? REDACTED : member];
                  },
                ),
              ),
            });

            // And no run of the value is left in the text as it was written.
            expect(keptRunsOf(output, value)).toEqual([]);
          }
        }
      }
    },
  );

  it("redacts a number the same way", () => {
    expect(
      redactLogString(
        JSON.stringify({ data: JSON.stringify({ password: 123456 }) }),
      ),
    ).toBe(`{"data":"{\\"password\\":\\"${REDACTED}\\"}"}`);
  });

  it("takes a value whose last character is a backslash whole, the members after it with it", () => {
    const value: string = `${ISSUED_KEY}\\`;
    const output: string = redactLogString(
      failedRequestText({ probeKey: value, probeId: AGENT_ID }),
    );

    expect(keptRunsOf(output, ISSUED_KEY)).toEqual([]);
    expect(output).toContain(REDACTED);
  });

  it("takes a value with no closing quote to the end of the text", () => {
    expect(redactLogString(`{"data":"{\\"probeKey\\":\\"${ISSUED_KEY}`)).toBe(
      `{"data":"{\\"probeKey\\":\\"${REDACTED}\\"`,
    );
  });

  it("leaves a body stringified again that names no key alone", () => {
    const text: string = JSON.stringify({
      config: {
        url: "https://oneuptime.example.com/probe-ingest/monitor/list",
        data: JSON.stringify({
          probeId: AGENT_ID,
          limit: 100,
          probeCapabilities: ["networkDevicePing", "snmpTables"],
        }),
      },
    });

    expect(redactLogString(text)).toBe(text);
  });
});

/*
 * Escaped quotes are text anybody can put into a header or a field too: the
 * rules that read them stay in line with the text's length, about 400,000
 * characters of each worst case read in well under 2 seconds.
 */
describe("a request body stringified again keeps redaction linear", () => {
  const LENGTH: number = 400000;

  const EVERY_RUN: string = Array.from(
    { length: 16 },
    (_unused: unknown, index: number): string => {
      const run: string = "\\".repeat(index + 1);

      return `${run}"probeKey${run}":${run}"`;
    },
  ).join("");

  it.each([
    ["members over and over", '\\"probeKey\\":\\"'.repeat(LENGTH / 16)],
    [
      "a member whose value never closes",
      `\\"probeKey\\":\\"${"a".repeat(LENGTH)}`,
    ],
    [
      "a member whose value holds only quotes escaped deeper",
      `\\"probeKey\\":\\"${'\\\\\\"'.repeat(LENGTH / 4)}`,
    ],
    ["backslashes", "\\".repeat(LENGTH)],
    ["backslashes and quotes", '\\\\\\"'.repeat(LENGTH / 4)],
    ["names with no colon", '\\"probeKey\\"'.repeat(LENGTH / 12)],
    ["a name and a long run of spaces", `\\"probeKey\\"${" ".repeat(LENGTH)}`],
    [
      "members escaped every number of times",
      EVERY_RUN.repeat(LENGTH / EVERY_RUN.length),
    ],
    ["numbers' members over and over", '\\"password\\":1'.repeat(LENGTH / 15)],
  ])("%s", (_label: string, text: string) => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        redactLogString(text);
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });
});

/*
 * A PEM private key block is redacted whole, from its BEGIN line to the
 * first END line after it - and found in time in line with the text's
 * length, however many BEGIN lines it holds with no END after them.
 */
describe("private key blocks", () => {
  const BODY: string = "MIIEpAIBAAKCAQEA1234567890abcdefZmFrZSBrZXk";

  it("are redacted from their BEGIN line to their END line, whatever the key's kind", () => {
    for (const kind of ["", "RSA ", "EC ", "OPENSSH ", "ENCRYPTED ", "DSA "]) {
      const block: string = [
        `-----BEGIN ${kind}PRIVATE KEY-----`,
        "Proc-Type: 4,ENCRYPTED",
        BODY,
        `-----END ${kind}PRIVATE KEY-----`,
      ].join("\n");

      expect(redactLogString(`key:\n${block}\nafter`)).toBe(
        `key:\n${REDACTED}\nafter`,
      );
    }
  });

  it("are each redacted when a text holds several, and what lies between them is kept", () => {
    const block: string = `-----BEGIN PRIVATE KEY-----\n${BODY}\n-----END PRIVATE KEY-----`;

    expect(redactLogString(`one ${block} two ${block} three`)).toBe(
      `one ${REDACTED} two ${REDACTED} three`,
    );
  });

  it("run to the first END after a BEGIN, BEGIN lines between them included", () => {
    expect(
      redactLogString(
        `-----BEGIN RSA PRIVATE KEY-----\n${BODY}\n-----BEGIN RSA PRIVATE KEY-----\n${BODY}\n-----END RSA PRIVATE KEY-----\ntail`,
      ),
    ).toBe(`${REDACTED}\ntail`);
  });

  it("are left as they are with no END after them, and so is a certificate", () => {
    for (const text of [
      `-----BEGIN RSA PRIVATE KEY-----\n${BODY}`,
      `-----BEGIN CERTIFICATE-----\n${BODY}\n-----END CERTIFICATE-----`,
      `-----END RSA PRIVATE KEY-----\n${BODY}\n-----BEGIN RSA PRIVATE KEY-----`,
    ]) {
      expect(redactLogString(text)).toBe(text);
    }
  });

  /*
   * The pattern this rule used to be: one lazy body between the BEGIN and
   * END lines. It reads the rest of the text from every BEGIN line with no
   * END after it, so it is only ever run here on short texts.
   */
  const PREVIOUS_PATTERN: RegExp =
    /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----/g;

  it("are found exactly where the pattern they replace found them, on 20,000 generated texts", () => {
    const pieces: Array<string> = [
      "-----BEGIN ",
      "-----END ",
      "PRIVATE KEY-----",
      "PRIVATE ",
      "KEY-----",
      "RSA ",
      "EC ",
      "OPENSSH ",
      "-----",
      "MIIE",
      "\n",
      " ",
      "a",
      "-",
    ];

    const differences: Array<string> = [];

    for (const text of generatedTexts(20000, 1729, pieces)) {
      // Only texts the rule reaches; the other rules leave these alone.
      const expected: string = text.replace(PREVIOUS_PATTERN, REDACTED);

      if (redactLogString(text) !== expected) {
        differences.push(text);
      }
    }

    expect(differences.slice(0, 5)).toEqual([]);
  });

  /*
   * A million characters, not 400,000: the pattern this rule used to be
   * read 400,000 characters of its worst case in just under two seconds,
   * and twice that in four times as long.
   */
  it.each([
    [
      "BEGIN lines with no END",
      "-----BEGIN RSA PRIVATE KEY-----".repeat(1000000 / 31),
    ],
    [
      "BEGIN lines on lines of their own",
      "-----BEGIN PRIVATE KEY-----\n".repeat(1000000 / 28),
    ],
    [
      "BEGIN lines with END lines that never close",
      "-----BEGIN RSA PRIVATE KEY----------END RSA ".repeat(1000000 / 45),
    ],
    [
      "BEGIN lines of many words",
      "-----BEGIN A B C D E F G H I J K PRIVATE KEY-----".repeat(1000000 / 49),
    ],
    [
      "one BEGIN and a label that never ends",
      `-----BEGIN ${"A ".repeat(500000)}`,
    ],
    ["dashes", "-".repeat(1000000)],
  ])(
    "are looked for in time in line with the text: %s",
    (_label: string, text: string) => {
      const timed: FastestRun<void> = fastestRun({
        run: (): void => {
          redactLogString(text);
        },
        limitInMs: 2000,
      });

      expect(timed.inMs).toBeLessThan(2000);
    },
  );
});
