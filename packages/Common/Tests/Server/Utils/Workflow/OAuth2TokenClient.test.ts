import OAuth2TokenClient, {
  OAUTH2_TOKEN_REQUEST_TIMEOUT_IN_MS,
  OAuth2TokenHttpRequest,
  OAuth2TokenHttpResponse,
  OAuth2TokenRequestConfig,
  OAuth2TokenRequestException,
  OAuth2TokenResult,
} from "../../../../Server/Utils/Workflow/OAuth2TokenClient";
import {
  OAuth2ClientAuthenticationMethod,
  OAuth2GrantType,
} from "../../../../Types/Workflow/WorkflowVariableOAuth";
import { AxiosError } from "axios";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The OAuth 2.0 token request an OAuth workflow variable makes, and how its
 * answer is read. Everything here runs against a fake transport; the HTTP
 * integration suite next to this one runs the same client over real sockets.
 */

const NOW: Date = new Date("2026-09-22T12:00:00.000Z");

/*
 * Structurally typed: @jest/globals and the ambient jest types disagree about
 * spy types, and only `mock.calls` is read.
 */
interface RecordedSpy {
  mock: { calls: Array<Array<unknown>> };
}
const TOKEN_URL: string = "https://login.example.com/oauth2/token";
const CLIENT_SECRET: string = "s3cr3t-value-~._";
const REFRESH_TOKEN: string = "1//refresh-token-value";

function clientCredentials(
  overrides?: Partial<OAuth2TokenRequestConfig>,
): OAuth2TokenRequestConfig {
  return {
    grantType: OAuth2GrantType.ClientCredentials,
    tokenUrl: TOKEN_URL,
    clientId: "client-123",
    clientSecret: CLIENT_SECRET,
    ...overrides,
  };
}

function refreshTokenGrant(
  overrides?: Partial<OAuth2TokenRequestConfig>,
): OAuth2TokenRequestConfig {
  return {
    grantType: OAuth2GrantType.RefreshToken,
    tokenUrl: TOKEN_URL,
    clientId: "client-123",
    clientSecret: CLIENT_SECRET,
    refreshToken: REFRESH_TOKEN,
    ...overrides,
  };
}

function jsonResponse(
  statusCode: number,
  body: unknown,
  headers?: Record<string, string>,
): OAuth2TokenHttpResponse {
  return {
    statusCode,
    bodyText: JSON.stringify(body),
    headers: { "content-type": "application/json", ...(headers || {}) },
  };
}

function decodeBasic(header: string | undefined): string {
  expect(header).toMatch(/^Basic /);
  return Buffer.from(
    (header as string).substring("Basic ".length),
    "base64",
  ).toString("utf8");
}

// A JWT with the given payload; the signature is irrelevant to the client.
function jwt(payload: Record<string, unknown>): string {
  const encode: (value: unknown) => string = (value: unknown): string => {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
  };

  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode(payload)}.signature`;
}

function parse(
  response: OAuth2TokenHttpResponse,
  grantType: OAuth2GrantType = OAuth2GrantType.ClientCredentials,
  secrets?: Array<string>,
): OAuth2TokenResult {
  return OAuth2TokenClient.parseTokenResponse(response, {
    grantType,
    now: NOW,
    secrets,
  });
}

function parseError(
  response: OAuth2TokenHttpResponse,
  grantType: OAuth2GrantType = OAuth2GrantType.ClientCredentials,
  secrets?: Array<string>,
): OAuth2TokenRequestException {
  try {
    parse(response, grantType, secrets);
  } catch (err) {
    expect(err).toBeInstanceOf(OAuth2TokenRequestException);
    return err as OAuth2TokenRequestException;
  }

  throw new Error("Expected parseTokenResponse to throw.");
}

describe("OAuth2TokenClient.buildTokenRequest", () => {
  test("client credentials with the default Basic header", () => {
    const request: OAuth2TokenHttpRequest =
      OAuth2TokenClient.buildTokenRequest(clientCredentials());

    expect(request.url).toBe(TOKEN_URL);
    expect(request.body).toEqual({ grant_type: "client_credentials" });
    expect(decodeBasic(request.headers["Authorization"])).toBe(
      `client-123:${encodeURIComponent(CLIENT_SECRET)}`,
    );
    expect(request.headers["Accept"]).toBe("application/json");
    expect(request.headers["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(request.timeoutInMs).toBe(OAUTH2_TOKEN_REQUEST_TIMEOUT_IN_MS);
  });

  /*
   * The secret must travel exactly once: in the header for
   * client_secret_basic, in the body for client_secret_post. RFC 6749 section
   * 2.3 forbids both at once.
   */
  test("never puts the secret in the body when it is in the header", () => {
    const request: OAuth2TokenHttpRequest =
      OAuth2TokenClient.buildTokenRequest(clientCredentials());

    expect(request.body).not.toHaveProperty("client_secret");
    expect(request.body).not.toHaveProperty("client_id");
  });

  test("client credentials sent in the request body", () => {
    const request: OAuth2TokenHttpRequest = OAuth2TokenClient.buildTokenRequest(
      clientCredentials({
        clientAuthenticationMethod:
          OAuth2ClientAuthenticationMethod.RequestBody,
      }),
    );

    expect(request.headers["Authorization"]).toBeUndefined();
    expect(request.body).toEqual({
      grant_type: "client_credentials",
      client_id: "client-123",
      client_secret: CLIENT_SECRET,
    });
  });

  /*
   * RFC 6749 section 2.3.1 form-encodes the id and secret before joining them,
   * so a colon in the id cannot be read as the separator. Unreserved
   * characters (- . _ ~) are left alone, which keeps the common secret byte for
   * byte as typed.
   */
  test("encodes reserved characters in the Basic credentials", () => {
    const request: OAuth2TokenHttpRequest = OAuth2TokenClient.buildTokenRequest(
      clientCredentials({
        clientId: "tenant:app",
        clientSecret: "a+b/c=d e%~._-",
      }),
    );

    expect(decodeBasic(request.headers["Authorization"])).toBe(
      "tenant%3Aapp:a%2Bb%2Fc%3Dd%20e%25~._-",
    );
  });

  test("refresh token grant sends the refresh token", () => {
    const request: OAuth2TokenHttpRequest =
      OAuth2TokenClient.buildTokenRequest(refreshTokenGrant());

    expect(request.body).toEqual({
      grant_type: "refresh_token",
      refresh_token: REFRESH_TOKEN,
    });
    expect(decodeBasic(request.headers["Authorization"])).toContain(
      "client-123:",
    );
  });

  /*
   * A public client (a native or single-page app registration) has no secret.
   * It identifies itself with client_id in the body and nothing else.
   */
  test("a public client sends client_id in the body and no Authorization header", () => {
    const request: OAuth2TokenHttpRequest = OAuth2TokenClient.buildTokenRequest(
      refreshTokenGrant({ clientSecret: undefined }),
    );

    expect(request.headers["Authorization"]).toBeUndefined();
    expect(request.body).toEqual({
      grant_type: "refresh_token",
      refresh_token: REFRESH_TOKEN,
      client_id: "client-123",
    });
  });

  test("sends a trimmed scope and leaves an empty one out", () => {
    expect(
      OAuth2TokenClient.buildTokenRequest(
        clientCredentials({ scope: "  api.read api.write  " }),
      ).body["scope"],
    ).toBe("api.read api.write");

    expect(
      OAuth2TokenClient.buildTokenRequest(clientCredentials({ scope: "   " }))
        .body,
    ).not.toHaveProperty("scope");
  });

  test("adds provider extras but never lets one overwrite a reserved field", () => {
    const request: OAuth2TokenHttpRequest = OAuth2TokenClient.buildTokenRequest(
      clientCredentials({
        clientAuthenticationMethod:
          OAuth2ClientAuthenticationMethod.RequestBody,
        scope: "real-scope",
        additionalParameters: {
          audience: "https://api.example.com",
          grant_type: "password",
          CLIENT_SECRET: "attacker",
          scope: "admin",
          "": "blank",
        },
      }),
    );

    expect(request.body).toEqual({
      audience: "https://api.example.com",
      grant_type: "client_credentials",
      client_id: "client-123",
      client_secret: CLIENT_SECRET,
      scope: "real-scope",
    });
  });

  test("trims the client id and the token URL", () => {
    const request: OAuth2TokenHttpRequest = OAuth2TokenClient.buildTokenRequest(
      clientCredentials({
        clientId: "  client-123  ",
        tokenUrl: `  ${TOKEN_URL}  `,
        clientAuthenticationMethod:
          OAuth2ClientAuthenticationMethod.RequestBody,
      }),
    );

    expect(request.url).toBe(TOKEN_URL);
    expect(request.body["client_id"]).toBe("client-123");
  });

  test("honours a custom timeout", () => {
    expect(
      OAuth2TokenClient.buildTokenRequest(clientCredentials(), 1234)
        .timeoutInMs,
    ).toBe(1234);
  });

  test.each([
    [
      "no token URL",
      clientCredentials({ tokenUrl: " " }),
      "The token URL is not set.",
    ],
    [
      "no client ID",
      clientCredentials({ clientId: "" }),
      "The client ID is not set.",
    ],
    [
      "client credentials without a secret",
      clientCredentials({ clientSecret: "" }),
      "The client secret is not set.",
    ],
    [
      "a refresh token grant without a refresh token",
      refreshTokenGrant({ refreshToken: undefined }),
      "The refresh token is not set.",
    ],
    [
      "an unknown grant type",
      clientCredentials({ grantType: "Password" as OAuth2GrantType }),
      "Unsupported OAuth grant type: Password.",
    ],
  ])(
    "refuses a config with %s before sending anything",
    (
      _label: string,
      config: OAuth2TokenRequestConfig,
      expectedMessage: string,
    ) => {
      expect(() => {
        return OAuth2TokenClient.buildTokenRequest(config);
      }).toThrow(expectedMessage);
    },
  );
});

describe("OAuth2TokenClient.parseTokenResponse", () => {
  test("reads a standard token response", () => {
    const result: OAuth2TokenResult = parse(
      jsonResponse(200, {
        access_token: "access-1",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "api.read",
      }),
    );

    expect(result).toEqual({
      accessToken: "access-1",
      tokenType: "Bearer",
      expiresAt: new Date(NOW.getTime() + 3600 * 1000),
      refreshToken: null,
      scope: "api.read",
    });
  });

  // Azure AD v1 endpoints send expires_in as a string.
  test("reads expires_in sent as a string", () => {
    expect(
      parse(jsonResponse(200, { access_token: "a", expires_in: "3599" }))
        .expiresAt,
    ).toEqual(new Date(NOW.getTime() + 3599 * 1000));
  });

  /*
   * A provider that rotates refresh tokens invalidates the one just used; the
   * caller must store the new one, so it has to come back out of here.
   */
  test("returns a rotated refresh token", () => {
    expect(
      parse(
        jsonResponse(200, {
          access_token: "a",
          expires_in: 60,
          refresh_token: "rotated-refresh",
        }),
        OAuth2GrantType.RefreshToken,
      ).refreshToken,
    ).toBe("rotated-refresh");
  });

  test("falls back to the JWT exp claim when expires_in is missing", () => {
    const exp: number = Math.floor(NOW.getTime() / 1000) + 900;

    expect(
      parse(jsonResponse(200, { access_token: jwt({ exp, sub: "x" }) }))
        .expiresAt,
    ).toEqual(new Date(exp * 1000));
  });

  test("prefers expires_in over the JWT exp claim", () => {
    const exp: number = Math.floor(NOW.getTime() / 1000) + 900;

    expect(
      parse(jsonResponse(200, { access_token: jwt({ exp }), expires_in: 60 }))
        .expiresAt,
    ).toEqual(new Date(NOW.getTime() + 60 * 1000));
  });

  test("reports an unknown expiry when neither says", () => {
    expect(
      parse(jsonResponse(200, { access_token: "opaque-token" })).expiresAt,
    ).toBeNull();
  });

  test.each([[0], [-5], ["soon"], [""], [null]])(
    "ignores an unusable expires_in of %p",
    (expiresIn: unknown) => {
      expect(
        parse(
          jsonResponse(200, { access_token: "opaque", expires_in: expiresIn }),
        ).expiresAt,
      ).toBeNull();
    },
  );

  // Older GitHub-style endpoints answer form-encoded whatever Accept says.
  test("reads a form-encoded token response", () => {
    const result: OAuth2TokenResult = parse({
      statusCode: 200,
      bodyText: "access_token=form-token&token_type=bearer&expires_in=120",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });

    expect(result.accessToken).toBe("form-token");
    expect(result.expiresAt).toEqual(new Date(NOW.getTime() + 120 * 1000));
  });

  test("names the OAuth error, the provider's description and what to do", () => {
    const error: OAuth2TokenRequestException = parseError(
      jsonResponse(401, {
        error: "invalid_client",
        error_description: "Client authentication failed.",
      }),
    );

    expect(error.oauthErrorCode).toBe("invalid_client");
    expect(error.message).toContain(
      "The token endpoint refused the request (HTTP 401): invalid_client - Client authentication failed.",
    );
    expect(error.message).toContain("HTTP Basic Header and Request Body");
  });

  /*
   * invalid_grant means different things per grant. For a refresh token it is
   * the case people most need told plainly: the refresh token is dead, and only
   * a new one fixes it.
   */
  test("tells a Refresh Token variable its refresh token is dead", () => {
    const error: OAuth2TokenRequestException = parseError(
      jsonResponse(400, {
        error: "invalid_grant",
        error_description: "Token has been expired or revoked.",
      }),
      OAuth2GrantType.RefreshToken,
    );

    expect(error.oauthErrorCode).toBe("invalid_grant");
    expect(error.message).toContain("Token has been expired or revoked.");
    expect(error.message).toContain("Update Credentials");
  });

  test("does not blame a refresh token on a client credentials variable", () => {
    const error: OAuth2TokenRequestException = parseError(
      jsonResponse(400, { error: "invalid_grant" }),
      OAuth2GrantType.ClientCredentials,
    );

    expect(error.message).not.toContain("refresh token");
    expect(error.message).toContain("client credentials grant");
  });

  test.each([
    ["invalid_scope", "Check the scope"],
    ["unauthorized_client", "not allowed to use the Client Credentials grant"],
    ["unsupported_grant_type", "does not support the Client Credentials grant"],
    ["invalid_request", "missing or repeats a parameter"],
  ])("gives a hint for %s", (errorCode: string, hint: string) => {
    expect(
      parseError(jsonResponse(400, { error: errorCode })).message,
    ).toContain(hint);
  });

  test("passes an unknown error code through without a made-up hint", () => {
    const error: OAuth2TokenRequestException = parseError(
      jsonResponse(400, { error: "temporarily_unavailable" }),
    );

    expect(error.message).toBe(
      "The token endpoint refused the request (HTTP 400): temporarily_unavailable.",
    );
  });

  // GitHub answers 200 with an error object.
  test("treats a 200 carrying an OAuth error as a failure", () => {
    const error: OAuth2TokenRequestException = parseError(
      jsonResponse(200, {
        error: "bad_verification_code",
        error_description: "The code passed is incorrect or expired.",
      }),
    );

    expect(error.message).toContain("HTTP 200");
    expect(error.message).toContain("bad_verification_code");
  });

  test("a 200 with no access_token points at the wrong endpoint", () => {
    expect(
      parseError(
        jsonResponse(200, {
          issuer: "https://login.example.com",
          token_endpoint: "https://login.example.com/token",
        }),
      ).message,
    ).toContain("answered without an access_token");
  });

  test("a 200 that is not JSON says so and quotes it", () => {
    expect(
      parseError({
        statusCode: 200,
        bodyText: "<html><body><h1>Sign in</h1></body></html>",
        headers: { "content-type": "text/html" },
      }).message,
    ).toBe(
      "The token endpoint did not answer with JSON: Sign in. Check the Token URL.",
    );
  });

  test("an empty 200 says the body was empty", () => {
    expect(
      parseError({ statusCode: 200, bodyText: "", headers: {} }).message,
    ).toContain("the body was empty");
  });

  test("quotes an HTML error page as readable text, bounded", () => {
    const page: string = `<html><head><style>body{color:red}</style><script>var x=1;</script><title>404 Not Found</title></head><body><h1>Not Found</h1><p>${"x".repeat(
      1000,
    )}</p></body></html>`;

    const message: string = parseError({
      statusCode: 404,
      bodyText: page,
      headers: { "content-type": "text/html" },
    }).message;

    expect(message).toMatch(
      /^The token endpoint answered HTTP 404: 404 Not Found Not Found x+…\. Check the Token URL\.$/,
    );
    expect(message).not.toContain("<");
    expect(message).not.toContain("color:red");
    expect(message).not.toContain("var x");
    expect(message.length).toBeLessThan(420);
  });

  test("says an error response had an empty body", () => {
    expect(
      parseError({ statusCode: 503, bodyText: "", headers: {} }).message,
    ).toBe(
      "The token endpoint answered HTTP 503 with an empty body. Check the Token URL.",
    );
  });

  /*
   * Redirects are never followed - a validated host could otherwise bounce the
   * client secret to one nobody validated - so the 3xx itself is the answer,
   * and it should say where the endpoint moved.
   */
  test("reports a redirect with its destination instead of following it", () => {
    const message: string = parseError({
      statusCode: 302,
      bodyText: "",
      headers: { location: "https://login.example.com/v2/token" },
    }).message;

    expect(message).toContain("redirect (HTTP 302)");
    expect(message).toContain("https://login.example.com/v2/token");
    expect(message).toContain("does not follow redirects");
  });

  test("never echoes a secret the provider put in its error", () => {
    const error: OAuth2TokenRequestException = parseError(
      jsonResponse(400, {
        error: "invalid_grant",
        error_description: `Refresh token ${REFRESH_TOKEN} is invalid for client secret ${encodeURIComponent(
          CLIENT_SECRET,
        )}`,
      }),
      OAuth2GrantType.RefreshToken,
      [CLIENT_SECRET, REFRESH_TOKEN],
    );

    expect(error.message).not.toContain(REFRESH_TOKEN);
    expect(error.message).not.toContain(CLIENT_SECRET);
    expect(error.message).not.toContain(encodeURIComponent(CLIENT_SECRET));
    expect(error.message).toContain("[REDACTED]");
  });

  test("strips control characters from quoted provider text", () => {
    const message: string = parseError(
      jsonResponse(400, {
        error: "invalid_request",
        error_description: "line one\r\nline two\u0000",
      }),
    ).message;

    expect(message).toContain("line one line two");
    expect(message.includes("\r")).toBe(false);
    expect(message.includes("\n")).toBe(false);
    expect(message.includes("\u0000")).toBe(false);
  });
});

describe("OAuth2TokenClient.getJwtExpiry", () => {
  test("reads exp from a JWT", () => {
    expect(OAuth2TokenClient.getJwtExpiry(jwt({ exp: 1790000000 }))).toEqual(
      new Date(1790000000 * 1000),
    );
  });

  test.each([
    ["an opaque token", "opaque"],
    ["two segments", "a.b"],
    ["a payload that is not JSON", "a.bm90IGpzb24.c"],
    [
      "a payload that is an array",
      `a.${Buffer.from("[1]").toString("base64url")}.c`,
    ],
    ["no exp", jwt({ sub: "x" })],
    ["a string exp", jwt({ exp: "1790000000" })],
    ["a negative exp", jwt({ exp: -1 })],
    ["an empty string", ""],
  ])("returns null for %s", (_label: string, token: string) => {
    expect(OAuth2TokenClient.getJwtExpiry(token)).toBeNull();
  });
});

describe("OAuth2TokenClient.requestToken", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("sends the built request through the transport and parses the answer", async () => {
    const transport: RecordedSpy = jest
      .spyOn(OAuth2TokenClient, "transport")
      .mockResolvedValue(
        jsonResponse(200, { access_token: "access-1", expires_in: 60 }),
      ) as unknown as RecordedSpy;

    const result: OAuth2TokenResult = await OAuth2TokenClient.requestToken(
      clientCredentials({ scope: "api.read" }),
      { now: NOW, timeoutInMs: 5000 },
    );

    expect(result.accessToken).toBe("access-1");
    expect(result.expiresAt).toEqual(new Date(NOW.getTime() + 60 * 1000));
    expect(transport).toHaveBeenCalledTimes(1);

    const request: OAuth2TokenHttpRequest = transport.mock
      .calls[0]![0] as OAuth2TokenHttpRequest;

    expect(request.body).toEqual({
      grant_type: "client_credentials",
      scope: "api.read",
    });
    expect(request.timeoutInMs).toBe(5000);
  });

  test("does not call the transport for a config that cannot work", async () => {
    const transport: RecordedSpy = jest.spyOn(
      OAuth2TokenClient,
      "transport",
    ) as unknown as RecordedSpy;

    await expect(
      OAuth2TokenClient.requestToken(clientCredentials({ clientSecret: "" })),
    ).rejects.toThrow("The client secret is not set.");

    expect(transport).not.toHaveBeenCalled();
  });

  test("turns a transport failure into a readable message", async () => {
    jest
      .spyOn(OAuth2TokenClient, "transport")
      .mockRejectedValue(
        new Error("OAuth token URL host 169.254.169.254 is not allowed."),
      );

    await expect(
      OAuth2TokenClient.requestToken(clientCredentials()),
    ).rejects.toThrow(
      "Could not reach the token endpoint: OAuth token URL host 169.254.169.254 is not allowed.",
    );
  });

  test("says how long it waited when the endpoint timed out", async () => {
    const timeout: AxiosError = new AxiosError(
      "timeout of 20000ms exceeded",
      "ECONNABORTED",
    );

    jest.spyOn(OAuth2TokenClient, "transport").mockRejectedValue(timeout);

    await expect(
      OAuth2TokenClient.requestToken(clientCredentials(), {
        timeoutInMs: 20000,
      }),
    ).rejects.toThrow(
      "Could not reach the token endpoint: it did not answer within 20 seconds.",
    );
  });

  test("scrubs the secrets out of a transport error", async () => {
    jest
      .spyOn(OAuth2TokenClient, "transport")
      .mockRejectedValue(
        new Error(`socket hang up while sending ${CLIENT_SECRET}`),
      );

    const error: unknown = await OAuth2TokenClient.requestToken(
      clientCredentials(),
    ).catch((err: unknown) => {
      return err;
    });

    expect(error).toBeInstanceOf(OAuth2TokenRequestException);
    expect((error as Error).message).not.toContain(CLIENT_SECRET);
  });
});
