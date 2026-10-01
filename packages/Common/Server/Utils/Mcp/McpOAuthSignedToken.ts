import crypto from "crypto";
import { EncryptionSecret } from "../../EnvironmentConfig";
import { JSONObject } from "../../../Types/JSON";

/*
 * Signed, self-contained, short-lived tokens the MCP authorization server
 * passes to ITSELF: the description of an authorization request that rides
 * through the browser to the consent screen, and the credential the MCP
 * server presents to the API on a member's behalf.
 *
 * WHY THESE ARE NOT JWTS
 *
 * JSONWebToken.decode accepts any JWT signed with EncryptionSecret that
 * carries a user id and an email as a full dashboard session. Both tokens
 * here name a user, so minted as such a JWT either one would BE a session -
 * for every project the user belongs to, with none of the limits an MCP grant
 * carries. So, like the verification-email resend token, they use a format no
 * JWT parser accepts ("v1.<payload>.<signature>") and a key that signs
 * nothing else: an HMAC key derived from EncryptionSecret under a label that
 * is different for each purpose. A token made for one purpose therefore does
 * not verify as the other, and neither verifies anywhere else.
 *
 * NOT ENCRYPTED
 *
 * The payload is readable by whoever holds the token. Nothing secret goes in
 * one: an authorization request is made of values the client chose and sent
 * through the browser in the first place, and a delegation token never leaves
 * the server.
 */

export interface McpOAuthSignedTokenPurpose {
  /*
   * The label the signing key is derived under. Changing it invalidates
   * every outstanding token of that purpose.
   */
  keyDerivationLabel: string;

  /*
   * Upper bound on the whole token, applied before any cryptography runs so
   * an oversized or oddly shaped value costs a length check and a regex.
   */
  maxLength: number;
}

const TOKEN_VERSION_PREFIX: string = "v1";

// "v1." + base64url payload + "." + base64url HMAC-SHA256 (always 43 chars).
const TOKEN_PATTERN: RegExp = /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/;

/*
 * How far in the future an issuance time may be: slack for clock disagreement
 * between the pods behind one hostname. Beyond it the token was not minted by
 * an honest clock.
 */
const MAX_ISSUED_AT_CLOCK_SKEW_IN_MS: number = 5 * 60 * 1000;

export default class McpOAuthSignedToken {
  /*
   * null when the result would not verify - a payload past the purpose's
   * length cap. Callers treat that as "this request is too large".
   */
  public static sign(data: {
    purpose: McpOAuthSignedTokenPurpose;
    claims: JSONObject;
    expiresInSeconds: number;
    now?: Date | undefined;
  }): string | null {
    const now: Date = data.now || new Date();
    const issuedAtMs: number = now.getTime();

    const payload: string = JSON.stringify({
      v: 1,
      c: data.claims,
      i: issuedAtMs,
      x: issuedAtMs + data.expiresInSeconds * 1000,
    });

    const payloadB64: string = Buffer.from(payload, "utf8").toString(
      "base64url",
    );

    const token: string = `${TOKEN_VERSION_PREFIX}.${payloadB64}.${McpOAuthSignedToken.signature(
      data.purpose,
      payloadB64,
    )}`;

    /*
     * Round-tripped through verify() so sign() can never hand out a token
     * that would then be refused.
     */
    return McpOAuthSignedToken.verify({
      purpose: data.purpose,
      token,
      now,
    })
      ? token
      : null;
  }

  /*
   * The claims, or null. NEVER throws: anything that is not a valid, current
   * token of this purpose is null.
   */
  public static verify(data: {
    purpose: McpOAuthSignedTokenPurpose;
    token: unknown;
    now?: Date | undefined;
  }): JSONObject | null {
    try {
      const token: unknown = data.token;

      if (typeof token !== "string") {
        return null;
      }

      if (token.length > data.purpose.maxLength || !TOKEN_PATTERN.test(token)) {
        return null;
      }

      const parts: Array<string> = token.split(".");

      if (parts.length !== 3) {
        return null;
      }

      const payloadB64: string = parts[1] || "";
      const suppliedSignature: string = parts[2] || "";
      const expectedSignature: string = McpOAuthSignedToken.signature(
        data.purpose,
        payloadB64,
      );

      /*
       * Uint8Arrays rather than Buffers: see McpOAuthSecret.isHashEqual. The
       * pattern above pinned the supplied signature to 43 characters, so the
       * length check only returns early on input that could never match.
       */
      const suppliedBytes: Uint8Array = new TextEncoder().encode(
        suppliedSignature,
      );
      const expectedBytes: Uint8Array = new TextEncoder().encode(
        expectedSignature,
      );

      if (
        suppliedBytes.length !== expectedBytes.length ||
        !crypto.timingSafeEqual(suppliedBytes, expectedBytes)
      ) {
        return null;
      }

      const envelope: unknown = JSON.parse(
        Buffer.from(payloadB64, "base64url").toString("utf8"),
      );

      if (
        !envelope ||
        typeof envelope !== "object" ||
        Array.isArray(envelope)
      ) {
        return null;
      }

      const version: unknown = (envelope as Record<string, unknown>)["v"];
      const claims: unknown = (envelope as Record<string, unknown>)["c"];
      const issuedAtMs: unknown = (envelope as Record<string, unknown>)["i"];
      const expiresAtMs: unknown = (envelope as Record<string, unknown>)["x"];

      if (version !== 1) {
        return null;
      }

      if (!claims || typeof claims !== "object" || Array.isArray(claims)) {
        return null;
      }

      if (
        typeof issuedAtMs !== "number" ||
        typeof expiresAtMs !== "number" ||
        !Number.isSafeInteger(issuedAtMs) ||
        !Number.isSafeInteger(expiresAtMs)
      ) {
        return null;
      }

      const nowMs: number = (data.now || new Date()).getTime();

      if (!(issuedAtMs <= nowMs + MAX_ISSUED_AT_CLOCK_SKEW_IN_MS)) {
        return null;
      }

      if (!(nowMs < expiresAtMs)) {
        return null;
      }

      return claims as JSONObject;
    } catch {
      /*
       * Every failure above is already a null; this makes "never throws" true
       * of anything not anticipated, because callers treat a throw (a server
       * fault) and a forgery (a refusal) very differently.
       */
      return null;
    }
  }

  /*
   * The key is derived per call rather than cached, so a process that has its
   * secret swapped under it (tests, above all) never signs with a stale one.
   */
  private static signature(
    purpose: McpOAuthSignedTokenPurpose,
    payloadB64: string,
  ): string {
    const key: Buffer = crypto
      .createHmac("sha256", EncryptionSecret.toString())
      .update(purpose.keyDerivationLabel)
      .digest();

    return crypto
      .createHmac("sha256", key)
      .update(`${TOKEN_VERSION_PREFIX}.${payloadB64}`)
      .digest("base64url");
  }
}
