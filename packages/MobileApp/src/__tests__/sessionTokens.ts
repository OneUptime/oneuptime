/*
 * Access tokens shaped as the server signs a session's
 * (Common/Server/Utils/JsonWebToken.ts signUserLoginToken): its session, when
 * it signed in and when its person was last active - in milliseconds - and
 * when it was issued and runs out - in seconds, as every JWT says them. The
 * app reads these claims and never verifies the signature, so none is made.
 *
 * Deliberately not named *.test.ts: a helper, not a suite.
 */

export interface SessionTokenClaims {
  sessionId?: string | undefined;
  signedInAtMs?: number | undefined;
  lastActiveAtMs?: number | undefined;
  issuedAtMs: number;
  expiresAtMs: number;
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/[=]+$/, "");
}

export function sessionAccessToken(claims: SessionTokenClaims): string {
  const payload: Record<string, unknown> = {
    userId: "5e550000-0000-4000-8000-0000000000a1",
    iat: Math.floor(claims.issuedAtMs / 1000),
    exp: Math.floor(claims.expiresAtMs / 1000),
  };

  if (claims.sessionId !== undefined) {
    payload["sessionId"] = claims.sessionId;
  }

  if (claims.signedInAtMs !== undefined) {
    payload["signedInAt"] = claims.signedInAtMs;
  }

  if (claims.lastActiveAtMs !== undefined) {
    payload["lastActiveAt"] = claims.lastActiveAtMs;
  }

  return [
    toBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    toBase64Url(JSON.stringify(payload)),
    "not-verified-by-the-app",
  ].join(".");
}
