import crypto from "crypto";
import {
  CLOUD_STREAM_MAX_BEARER_TOKEN_LENGTH,
  GOOGLE_OIDC_CERTS_URL,
  GOOGLE_OIDC_ISSUERS,
} from "../../../Types/CloudConnection/CloudStream";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import OldestKeyMap from "../../../Utils/OldestKeyMap";
import DataSourceHttpFetch, {
  DataSourceHttpResponse,
} from "../DataSource/HttpFetch";
import logger from "../Logger";

/*
 * THE OIDC TOKENS GOOGLE SIGNS FOR A PUB/SUB PUSH.
 *
 * A push subscription with authentication sends, with every push, an
 * OpenID Connect ID token Google signed for its push service account
 * ("Authenticate push subscriptions", Pub/Sub documentation):
 *
 *   Authorization: Bearer <header>.<payload>.<signature>
 *
 *   header   { "alg": "RS256", "kid": "<key id>", "typ": "JWT" }
 *   payload  { "aud": "<the subscription's audience>", "azp": "...",
 *              "email": "<push service account>", "email_verified": true,
 *              "exp": ..., "iat": ..., "iss": "https://accounts.google.com",
 *              "sub": "..." }
 *
 * A token is taken when it is signed with RS256 by one of the keys Google
 * publishes (GOOGLE_OIDC_CERTS_URL, a JSON Web Key Set), by Google
 * (GOOGLE_OIDC_ISSUERS), not expired - a minute's skew either way - and
 * for a verified email. Whose email, and which audience, the caller
 * decides: a stream's push service account, and its stream key.
 *
 * Google's keys are fetched once and kept as long as Google says to keep
 * them (Cache-Control max-age, between five minutes and a day), and again
 * at most once a minute when a token names a key not among them - Google
 * rotates its keys every few days. Pub/Sub sends the same token with every
 * push for an hour or so, so a token verified is remembered until it
 * expires (MAX_REMEMBERED_TOKENS, the oldest forgotten first): one RSA
 * check per token, not per push.
 *
 * Fails closed: while Google's keys cannot be fetched, no token is taken,
 * and the caller answers so that Pub/Sub pushes again.
 */

export const GOOGLE_OIDC_CLOCK_SKEW_SECONDS: number = 60;
// The longest a token may live: Google's live an hour.
export const GOOGLE_OIDC_MAX_LIFETIME_SECONDS: number = 2 * 60 * 60;
// How long Google's keys are kept, whatever Google says.
export const GOOGLE_OIDC_MIN_KEY_AGE_MS: number = 5 * 60 * 1000;
export const GOOGLE_OIDC_MAX_KEY_AGE_MS: number = 24 * 60 * 60 * 1000;
// Asked again at most this often for a key not among them.
export const GOOGLE_OIDC_MISS_REFRESH_MS: number = 60 * 1000;
/*
 * After a read of Google's keys failed, the next waits this long: while
 * Google cannot be reached, a push is refused at once rather than each
 * one asking Google again.
 */
export const GOOGLE_OIDC_FAILED_READ_RETRY_MS: number = 10 * 1000;
// A failure to read Google's keys is logged at most this often.
const WARNING_INTERVAL_MS: number = 60 * 1000;
export const MAX_REMEMBERED_TOKENS: number = 10_000;
// The most keys of Google's kept: it publishes two or three.
const MAX_KEYS: number = 20;
// A token's header and payload, decoded, are each at most this long.
const MAX_SEGMENT_BYTES: number = 4096;

export interface GoogleOidcClaims {
  audience: string;
  email: string;
  isEmailVerified: boolean;
  issuer: string;
  issuedAtSeconds: number;
  expiresAtSeconds: number;
  subject: string;
}

export type GoogleOidcVerdict =
  | { isValid: true; claims: GoogleOidcClaims }
  | { isValid: false; isUnavailable: boolean; reason: string };

export interface UnverifiedJwt {
  header: JSONObject;
  payload: JSONObject;
  signingInput: string;
  signature: Buffer;
}

function isBase64UrlCharacter(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 45 ||
    code === 95
  );
}

function isBase64Url(value: string): boolean {
  if (value.length === 0) {
    return false;
  }

  for (let index: number = 0; index < value.length; index++) {
    if (!isBase64UrlCharacter(value.charCodeAt(index))) {
      return false;
    }
  }

  return true;
}

function readJsonSegment(segment: string): JSONObject | null {
  // Base64 is four characters to three bytes: a longer segment is refused before it is decoded.
  if (segment.length > Math.ceil((MAX_SEGMENT_BYTES * 4) / 3)) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(segment, "base64url").toString("utf8"),
    );

    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JSONObject)
      : null;
  } catch {
    return null;
  }
}

/*
 * A compact JWT's parts, not yet trusted - or null for anything that is
 * not one. Never throws; reads at most CLOUD_STREAM_MAX_BEARER_TOKEN_LENGTH
 * characters.
 */
export function readUnverifiedJwt(token: unknown): UnverifiedJwt | null {
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > CLOUD_STREAM_MAX_BEARER_TOKEN_LENGTH
  ) {
    return null;
  }

  const parts: Array<string> = token.split(".");

  if (parts.length !== 3 || !parts.every(isBase64Url)) {
    return null;
  }

  const header: JSONObject | null = readJsonSegment(parts[0]!);
  const payload: JSONObject | null = readJsonSegment(parts[1]!);

  if (!header || !payload) {
    return null;
  }

  return {
    header,
    payload,
    signingInput: `${parts[0]}.${parts[1]}`,
    signature: Buffer.from(parts[2]!, "base64url"),
  };
}

// The token of an Authorization header, "Bearer <token>", or "".
export function readBearerToken(value: unknown): string {
  const text: string = Array.isArray(value)
    ? String(value[0] ?? "")
    : typeof value === "string"
      ? value
      : "";

  if (text.length > CLOUD_STREAM_MAX_BEARER_TOKEN_LENGTH + 16) {
    return "";
  }

  const trimmed: string = text.trim();
  const space: number = trimmed.indexOf(" ");

  if (space <= 0 || trimmed.slice(0, space).toLowerCase() !== "bearer") {
    return "";
  }

  return trimmed.slice(space + 1).trim();
}

function readNumber(value: JSONValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readString(value: JSONValue | undefined): string {
  return typeof value === "string" ? value : "";
}

// Seconds a Cache-Control header says to keep a response, or null.
export function readMaxAgeSeconds(
  cacheControl: string | undefined,
): number | null {
  for (const directive of (cacheControl || "").split(",")) {
    const pieces: Array<string> = directive.trim().split("=");
    const name: string = (pieces[0] || "").trim().toLowerCase();
    const value: string = (pieces[1] || "").trim();

    if (name === "max-age" && value) {
      const seconds: number = Number(value);

      if (Number.isFinite(seconds) && seconds >= 0) {
        return seconds;
      }
    }
  }

  return null;
}

export interface GoogleKeysResponse {
  status: number;
  body: unknown;
  cacheControl?: string | undefined;
}

export default class GoogleOidcTokens {
  private static keys: Map<string, crypto.KeyObject> = new Map();
  private static keysExpireAt: number = 0;
  private static keysReadAt: number = 0;
  private static reading: Promise<boolean> | null = null;
  private static lastFailureAt: number = 0;
  private static lastFailure: string = "Google's keys could not be read.";
  private static lastWarnedAt: number = 0;
  private static verified: OldestKeyMap<string, GoogleOidcClaims> =
    new OldestKeyMap<string, GoogleOidcClaims>();

  // Test seam: the fetch of Google's key set.
  public static fetchKeys: () => Promise<GoogleKeysResponse> =
    async (): Promise<GoogleKeysResponse> => {
      const response: DataSourceHttpResponse = await DataSourceHttpFetch.fetch({
        method: "GET",
        url: GOOGLE_OIDC_CERTS_URL,
        headers: { Accept: "application/json" },
        timeoutInMs: 10_000,
        acceptAnyStatus: true,
        egressOptions: { targetLabel: "Google's token keys" },
      });

      return {
        status: response.statusCode,
        body: response.bodyJson,
        cacheControl: response.headers?.["cache-control"],
      };
    };

  public static reset(): void {
    GoogleOidcTokens.keys = new Map();
    GoogleOidcTokens.keysExpireAt = 0;
    GoogleOidcTokens.keysReadAt = 0;
    GoogleOidcTokens.reading = null;
    GoogleOidcTokens.lastFailureAt = 0;
    GoogleOidcTokens.lastFailure = "Google's keys could not be read.";
    GoogleOidcTokens.lastWarnedAt = 0;
    GoogleOidcTokens.verified.clear();
  }

  /*
   * Whether a token is one Google signed, and what it says - never whose
   * it may be: the caller holds the email and the audience to what it
   * expects. Never throws.
   */
  public static async verify(
    token: string,
    now: Date,
  ): Promise<GoogleOidcVerdict> {
    const nowSeconds: number = now.getTime() / 1000;
    const tokenKey: string = crypto
      .createHash("sha256")
      .update(token, "utf8")
      .digest("hex");
    const remembered: GoogleOidcClaims | undefined =
      GoogleOidcTokens.verified.get(tokenKey);

    if (remembered) {
      if (
        remembered.expiresAtSeconds + GOOGLE_OIDC_CLOCK_SKEW_SECONDS >
        nowSeconds
      ) {
        return { isValid: true, claims: remembered };
      }

      GoogleOidcTokens.verified.delete(tokenKey);
    }

    const jwt: UnverifiedJwt | null = readUnverifiedJwt(token);

    if (!jwt) {
      return GoogleOidcTokens.invalid("not a token");
    }

    const algorithm: string = readString(jwt.header["alg"]);
    const keyId: string = readString(jwt.header["kid"]);

    // RS256 alone: never "none", never a shared-secret algorithm.
    if (algorithm !== "RS256" || !keyId || keyId.length > 128) {
      return GoogleOidcTokens.invalid("not signed with RS256 by a named key");
    }

    let key: crypto.KeyObject | undefined;

    try {
      key = await GoogleOidcTokens.getKey(keyId, now);
    } catch (error) {
      if (
        now.getTime() - GoogleOidcTokens.lastWarnedAt >=
        WARNING_INTERVAL_MS
      ) {
        GoogleOidcTokens.lastWarnedAt = now.getTime();
        logger.warn(
          `Google's token keys could not be read, so no Pub/Sub push is taken until they are: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      return {
        isValid: false,
        isUnavailable: true,
        reason: "Google's keys could not be read",
      };
    }

    if (!key) {
      return GoogleOidcTokens.invalid(
        "signed by a key Google does not publish",
      );
    }

    let isSigned: boolean = false;

    try {
      isSigned = crypto.verify(
        "RSA-SHA256",
        Buffer.from(jwt.signingInput, "utf8"),
        key,
        jwt.signature,
      );
    } catch {
      isSigned = false;
    }

    if (!isSigned) {
      return GoogleOidcTokens.invalid("its signature is not Google's");
    }

    const claims: GoogleOidcClaims = {
      audience: readString(jwt.payload["aud"]),
      email: readString(jwt.payload["email"]),
      isEmailVerified: jwt.payload["email_verified"] === true,
      issuer: readString(jwt.payload["iss"]),
      issuedAtSeconds: readNumber(jwt.payload["iat"]) ?? NaN,
      expiresAtSeconds: readNumber(jwt.payload["exp"]) ?? NaN,
      subject: readString(jwt.payload["sub"]),
    };

    if (!GOOGLE_OIDC_ISSUERS.includes(claims.issuer)) {
      return GoogleOidcTokens.invalid("not issued by Google");
    }

    if (
      !Number.isFinite(claims.expiresAtSeconds) ||
      !Number.isFinite(claims.issuedAtSeconds) ||
      claims.expiresAtSeconds + GOOGLE_OIDC_CLOCK_SKEW_SECONDS <= nowSeconds ||
      claims.issuedAtSeconds - GOOGLE_OIDC_CLOCK_SKEW_SECONDS > nowSeconds ||
      claims.expiresAtSeconds - claims.issuedAtSeconds >
        GOOGLE_OIDC_MAX_LIFETIME_SECONDS
    ) {
      return GoogleOidcTokens.invalid("expired, or not yet valid");
    }

    if (!claims.audience || !claims.email || !claims.isEmailVerified) {
      return GoogleOidcTokens.invalid("for no verified email and audience");
    }

    while (GoogleOidcTokens.verified.size >= MAX_REMEMBERED_TOKENS) {
      const oldest: string | undefined = GoogleOidcTokens.verified.oldestKey();

      if (oldest === undefined) {
        break;
      }

      GoogleOidcTokens.verified.delete(oldest);
    }

    GoogleOidcTokens.verified.set(tokenKey, claims);

    return { isValid: true, claims };
  }

  private static invalid(reason: string): GoogleOidcVerdict {
    return { isValid: false, isUnavailable: false, reason };
  }

  /*
   * Google's key of this id: from the kept ones while they last, else read
   * again - for an id not among them at most once a minute. Throws when the
   * keys cannot be read and none are kept.
   */
  private static async getKey(
    keyId: string,
    now: Date,
  ): Promise<crypto.KeyObject | undefined> {
    const time: number = now.getTime();
    const hasKeys: boolean =
      GoogleOidcTokens.keys.size > 0 && time < GoogleOidcTokens.keysExpireAt;

    if (!hasKeys) {
      if (
        GoogleOidcTokens.keys.size === 0 &&
        time - GoogleOidcTokens.lastFailureAt < GOOGLE_OIDC_FAILED_READ_RETRY_MS
      ) {
        throw new Error("Google's keys could not be read moments ago.");
      }

      if (!(await GoogleOidcTokens.refresh(now))) {
        throw new Error(GoogleOidcTokens.lastFailure);
      }
    } else if (
      !GoogleOidcTokens.keys.has(keyId) &&
      time - GoogleOidcTokens.keysReadAt >= GOOGLE_OIDC_MISS_REFRESH_MS
    ) {
      await GoogleOidcTokens.refresh(now);
    }

    return GoogleOidcTokens.keys.get(keyId);
  }

  // One read at a time, however many pushes ask at once.
  private static async refresh(now: Date): Promise<boolean> {
    if (!GoogleOidcTokens.reading) {
      GoogleOidcTokens.reading = GoogleOidcTokens.read(now).finally(
        (): void => {
          GoogleOidcTokens.reading = null;
        },
      );
    }

    return await GoogleOidcTokens.reading;
  }

  private static async read(now: Date): Promise<boolean> {
    GoogleOidcTokens.keysReadAt = now.getTime();

    let response: GoogleKeysResponse;

    try {
      response = await GoogleOidcTokens.fetchKeys();
    } catch (error) {
      return GoogleOidcTokens.failed(
        now,
        error instanceof Error ? error.message : String(error),
      );
    }

    const body: JSONObject =
      response.body &&
      typeof response.body === "object" &&
      !Array.isArray(response.body)
        ? (response.body as JSONObject)
        : {};
    const entries: JSONValue | undefined = body["keys"];

    if (response.status !== 200 || !Array.isArray(entries)) {
      return GoogleOidcTokens.failed(
        now,
        `Google answered ${response.status} without a key set.`,
      );
    }

    const keys: Map<string, crypto.KeyObject> = new Map();

    for (const entry of entries.slice(0, MAX_KEYS)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }

      const jwk: JSONObject = entry as JSONObject;
      const keyId: string = readString(jwk["kid"]);

      if (
        !keyId ||
        readString(jwk["kty"]) !== "RSA" ||
        (jwk["alg"] !== undefined && jwk["alg"] !== "RS256") ||
        (jwk["use"] !== undefined && jwk["use"] !== "sig")
      ) {
        continue;
      }

      try {
        keys.set(
          keyId,
          crypto.createPublicKey({
            key: {
              kty: "RSA",
              n: readString(jwk["n"]),
              e: readString(jwk["e"]),
            },
            format: "jwk",
          }),
        );
      } catch {
        // A key Node cannot read is no key.
      }
    }

    if (keys.size === 0) {
      return GoogleOidcTokens.failed(
        now,
        "Google's key set held no RSA signing key.",
      );
    }

    const maxAgeMs: number =
      (readMaxAgeSeconds(response.cacheControl) ?? 0) * 1000;

    GoogleOidcTokens.keys = keys;
    GoogleOidcTokens.lastFailureAt = 0;
    GoogleOidcTokens.keysExpireAt =
      now.getTime() +
      Math.min(
        GOOGLE_OIDC_MAX_KEY_AGE_MS,
        Math.max(GOOGLE_OIDC_MIN_KEY_AGE_MS, maxAgeMs),
      );

    return true;
  }

  /*
   * A read that failed: keys kept go on working a little longer - asked
   * again only after GOOGLE_OIDC_FAILED_READ_RETRY_MS - and with none, the
   * pushes of that while are refused at once. Whether any key is kept.
   */
  private static failed(now: Date, why: string): boolean {
    GoogleOidcTokens.lastFailureAt = now.getTime();
    GoogleOidcTokens.lastFailure = why;

    if (GoogleOidcTokens.keys.size > 0) {
      GoogleOidcTokens.keysExpireAt = Math.max(
        GoogleOidcTokens.keysExpireAt,
        now.getTime() + GOOGLE_OIDC_FAILED_READ_RETRY_MS,
      );
      return true;
    }

    return false;
  }
}
