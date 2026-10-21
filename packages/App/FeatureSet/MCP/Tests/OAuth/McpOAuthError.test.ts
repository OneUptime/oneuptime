/**
 * OAuth error tests.
 *
 * The error codes are a wire contract: clients switch on these exact strings
 * (the MCP SDK signs a user out on `invalid_client` and discards its tokens
 * on `invalid_grant`), and on the HTTP status that comes with them. Both are
 * pinned for every code there is.
 */

import { describe, it, expect } from "@jest/globals";
import McpOAuthError, {
  McpOAuthErrorBody,
  McpOAuthErrorCode,
} from "../../OAuth/McpOAuthError";

// Every code, with its wire string and the status it is answered with.
const EXPECTED: Array<[McpOAuthErrorCode, string, number]> = [
  [McpOAuthErrorCode.InvalidRequest, "invalid_request", 400],
  [McpOAuthErrorCode.InvalidClient, "invalid_client", 401],
  [McpOAuthErrorCode.InvalidGrant, "invalid_grant", 400],
  [McpOAuthErrorCode.UnauthorizedClient, "unauthorized_client", 400],
  [McpOAuthErrorCode.UnsupportedGrantType, "unsupported_grant_type", 400],
  [McpOAuthErrorCode.UnsupportedResponseType, "unsupported_response_type", 400],
  [McpOAuthErrorCode.InvalidScope, "invalid_scope", 400],
  [McpOAuthErrorCode.AccessDenied, "access_denied", 400],
  [McpOAuthErrorCode.ServerError, "server_error", 500],
  [McpOAuthErrorCode.TemporarilyUnavailable, "temporarily_unavailable", 503],
  [McpOAuthErrorCode.InvalidTarget, "invalid_target", 400],
  [McpOAuthErrorCode.InvalidRedirectUri, "invalid_redirect_uri", 400],
  [McpOAuthErrorCode.InvalidClientMetadata, "invalid_client_metadata", 400],
  [McpOAuthErrorCode.InvalidToken, "invalid_token", 400],
  [McpOAuthErrorCode.InsufficientScope, "insufficient_scope", 400],
  [McpOAuthErrorCode.UnsupportedTokenType, "unsupported_token_type", 400],
  [McpOAuthErrorCode.TooManyRequests, "too_many_requests", 429],
];

describe("McpOAuthError", () => {
  it("has a pinned wire string and status for every code", () => {
    const pinned: Array<string> = EXPECTED.map(
      (entry: [McpOAuthErrorCode, string, number]): string => {
        return entry[0];
      },
    );

    // A code added without a decision here fails this.
    expect([...pinned].sort()).toEqual(
      [...Object.values(McpOAuthErrorCode)].sort(),
    );
    expect(new Set(pinned).size).toBe(pinned.length);
  });

  it.each(EXPECTED)(
    "%s is the string %s and is answered %i",
    (code: McpOAuthErrorCode, wire: string, statusCode: number) => {
      const error: McpOAuthError = new McpOAuthError(code, "A description.");

      expect(code).toBe(wire);
      expect(error.getStatusCode()).toBe(statusCode);
      expect(error.toResponseBody()).toEqual({
        error: wire,
        error_description: "A description.",
      });
    },
  );

  it("answers 400 for everything a client got wrong, as RFC 6749 section 5.2 says", () => {
    const other: Array<number> = EXPECTED.filter(
      (entry: [McpOAuthErrorCode, string, number]): boolean => {
        return ![
          McpOAuthErrorCode.InvalidClient,
          McpOAuthErrorCode.ServerError,
          McpOAuthErrorCode.TemporarilyUnavailable,
          McpOAuthErrorCode.TooManyRequests,
        ].includes(entry[0]);
      },
    ).map((entry: [McpOAuthErrorCode, string, number]): number => {
      return entry[2];
    });

    expect(other).toHaveLength(13);
    expect(new Set(other)).toEqual(new Set([400]));
  });

  it("answers invalid_grant with 400, not 401", () => {
    /*
     * A dead refresh token is the client's cue to start again, not a failure
     * to authenticate: 401 here would read as "wrong client secret".
     */
    expect(
      new McpOAuthError(McpOAuthErrorCode.InvalidGrant, "x").getStatusCode(),
    ).toBe(400);
  });

  it("is an Error that says what happened", () => {
    const error: McpOAuthError = new McpOAuthError(
      McpOAuthErrorCode.InvalidGrant,
      "The refresh token is invalid, expired or has been revoked.",
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(McpOAuthError);
    expect(error.name).toBe("McpOAuthError");
    expect(error.code).toBe("invalid_grant");
    expect(error.description).toBe(
      "The refresh token is invalid, expired or has been revoked.",
    );
    expect(error.message).toBe(
      "invalid_grant: The refresh token is invalid, expired or has been revoked.",
    );
    expect(typeof error.stack).toBe("string");
  });

  it("has a body of exactly two fields", () => {
    const body: McpOAuthErrorBody = new McpOAuthError(
      McpOAuthErrorCode.InvalidRequest,
      "grant_type is required.",
    ).toResponseBody();

    expect(Object.keys(body).sort()).toEqual(["error", "error_description"]);
  });

  describe("challenge", () => {
    it("has none unless it is given one", () => {
      expect(
        new McpOAuthError(McpOAuthErrorCode.InvalidClient, "x").challenge,
      ).toBeUndefined();
      expect(
        new McpOAuthError(McpOAuthErrorCode.InvalidClient, "x", undefined)
          .challenge,
      ).toBeUndefined();
      expect(
        new McpOAuthError(McpOAuthErrorCode.InvalidClient, "x", {}).challenge,
      ).toBeUndefined();
      expect(
        new McpOAuthError(McpOAuthErrorCode.InvalidClient, "x", {
          challenge: undefined,
        }).challenge,
      ).toBeUndefined();
    });

    it("carries the WWW-Authenticate value it was given", () => {
      const error: McpOAuthError = new McpOAuthError(
        McpOAuthErrorCode.InvalidClient,
        "Client authentication failed.",
        { challenge: 'Basic realm="OneUptime MCP", charset="UTF-8"' },
      );

      expect(error.challenge).toBe(
        'Basic realm="OneUptime MCP", charset="UTF-8"',
      );
    });

    it("is a header, never part of the body or the status", () => {
      const withChallenge: McpOAuthError = new McpOAuthError(
        McpOAuthErrorCode.InvalidClient,
        "Client authentication failed.",
        { challenge: 'Basic realm="OneUptime MCP"' },
      );
      const without: McpOAuthError = new McpOAuthError(
        McpOAuthErrorCode.InvalidClient,
        "Client authentication failed.",
      );

      expect(withChallenge.toResponseBody()).toEqual(without.toResponseBody());
      expect(withChallenge.getStatusCode()).toBe(without.getStatusCode());
      expect(withChallenge.message).toBe(without.message);
      expect(JSON.stringify(withChallenge.toResponseBody())).not.toContain(
        "Basic",
      );
    });
  });
});
