/**
 * PKCE (RFC 7636), S256 only.
 *
 * Every MCP client is treated as unable to keep a secret, so the thing that
 * ties an authorization code to the client that asked for it is this: the
 * client sends the SHA-256 of a random verifier when it starts, and the
 * verifier itself when it comes back with the code. Whoever intercepts the
 * code on its way through the browser has the hash and not the verifier.
 *
 * `plain` (the verifier sent as its own challenge) is not accepted anywhere:
 * it protects against nothing that can read the authorization request, and
 * OAuth 2.1 and the MCP specification both require S256.
 */

import crypto from "crypto";

export const PKCE_CODE_CHALLENGE_METHOD: string = "S256";

/*
 * An S256 challenge is base64url(SHA-256(verifier)): 32 bytes, so always
 * exactly 43 characters with no padding.
 */
const CODE_CHALLENGE_PATTERN: RegExp = /^[A-Za-z0-9_-]{43}$/;

/*
 * RFC 7636 section 4.1: 43 to 128 characters from the unreserved set. The
 * bounds matter - the lower one is what guarantees the verifier carries
 * enough entropy to be worth hashing, and the upper one caps what gets
 * hashed on an unauthenticated request.
 */
const CODE_VERIFIER_PATTERN: RegExp = /^[A-Za-z0-9\-._~]{43,128}$/;

export default class Pkce {
  public static isValidCodeChallenge(value: unknown): value is string {
    return typeof value === "string" && CODE_CHALLENGE_PATTERN.test(value);
  }

  public static isValidCodeVerifier(value: unknown): value is string {
    return typeof value === "string" && CODE_VERIFIER_PATTERN.test(value);
  }

  public static computeChallenge(codeVerifier: string): string {
    return crypto
      .createHash("sha256")
      .update(codeVerifier, "ascii")
      .digest("base64url");
  }

  /*
   * Whether the verifier is the one the stored challenge was made from.
   * False for anything that is not a well-formed verifier or challenge, and
   * constant time in the content of two well-formed values.
   */
  public static verify(data: {
    codeVerifier: unknown;
    codeChallenge: unknown;
  }): boolean {
    if (
      !Pkce.isValidCodeVerifier(data.codeVerifier) ||
      !Pkce.isValidCodeChallenge(data.codeChallenge)
    ) {
      return false;
    }

    const expected: Uint8Array = new TextEncoder().encode(data.codeChallenge);
    const actual: Uint8Array = new TextEncoder().encode(
      Pkce.computeChallenge(data.codeVerifier),
    );

    if (expected.length !== actual.length) {
      return false;
    }

    return crypto.timingSafeEqual(expected, actual);
  }
}
