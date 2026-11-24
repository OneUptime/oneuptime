import Redis, { ClientType } from "../Infrastructure/Redis";
import BadDataException from "../../Types/Exception/BadDataException";
import DatabaseNotConnectedException from "../../Types/Exception/DatabaseNotConnectedException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  MOBILE_SSO_CALLBACK_URL,
  MOBILE_SSO_HAND_OFF_EXPIRED_MESSAGE,
  MobileSsoSignIn,
} from "../../Types/SSO/MobileSsoHandOff";
import {
  CipherGCM,
  DecipherGCM,
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";

/*
 * HANDING AN SSO SIGN-IN BACK TO THE MOBILE APP (#9989).
 *
 * The app signs in with single sign-on in the phone's own browser - an
 * ASWebAuthenticationSession on iOS, a Custom Tab on Android - and the
 * server ends the sign-in on the app's deep link, oneuptime://sso-callback.
 * That link is a custom scheme: on Android any app can say it handles it,
 * and a link anybody can open could carry somebody else's sign-in. It used
 * to carry the session itself (access, refresh and SSO tokens), so whoever
 * received the link held the person's session, and an app could be signed
 * in to an account a link chose.
 *
 * Now it carries a one-time code instead, the way the app's passkey sign-in
 * hands back (MobilePasskeyLoginService) and OAuth's PKCE does (RFC 7636,
 * RFC 8252):
 *
 *   1. the app makes a random state and a random code verifier, and opens
 *      the provider's sign-in with the state and the verifier's SHA-256
 *      (codeChallenge, S256);
 *   2. the server keeps that request under a random flow id for the
 *      identity provider's round trip (startFlow) - the id rides in SAML's
 *      RelayState, in OIDC's signed state cookie and in the mobile intent
 *      cookie (Identity/Utils/MobileSso) - and takes it back, once, when the
 *      provider answers (takeFlow);
 *   3. once the sign-in is through, the session's tokens are kept here, for
 *      two minutes, under a one-time code bound to the challenge and the
 *      state (createAuthorizationCode), and the deep link carries only the
 *      code and the state;
 *   4. the app checks the state is its own and posts the code with its
 *      verifier (POST /identity/mobile-sso-exchange): the code is matched
 *      and deleted in one operation, and only a verifier whose SHA-256 is
 *      the challenge gets the tokens (exchangeAuthorizationCode).
 *
 * What a deep link gives whoever intercepts it: a code that is worthless
 * without the verifier, which never left the app, and that works once,
 * within two minutes. What a link someone else made gets them: nothing - the
 * app takes only a link with the state of a sign-in it started, and a code
 * this server made for that state.
 *
 * Only a hash of each id and code is a key in Redis, and the sign-in a code
 * stands for is kept sealed (AES-256-GCM) with a key only the code itself
 * gives: a dump of Redis holds nothing to redeem and no session to read.
 */

const FLOW_PREFIX: string = "mobile-sso-flow-";
const CODE_PREFIX: string = "mobile-sso-code-";
const SEALING_KEY_LABEL: string = "oneuptime-mobile-sso-sealing-key:";

/*
 * How long a sign-in may take at the identity provider: as long as the
 * mobile intent cookie lives (MOBILE_SSO_INTENT_TTL_SECONDS) - MFA prompts,
 * a password manager, a push approval on another device.
 */
export const MOBILE_SSO_FLOW_TTL_SECONDS: number = 15 * 60;

// How long the app has to redeem the code once the browser hands it back.
export const MOBILE_SSO_CODE_TTL_SECONDS: number = 120;

/*
 * A flow, taken: the value under KEYS[1], deleted in the same step, or nil.
 * One step, so two callbacks of one sign-in cannot both take it. Works on a
 * Redis without GETDEL.
 */
export const MOBILE_SSO_TAKE_ONCE_SCRIPT: string =
  "local value = redis.call('GET', KEYS[1]); " +
  "if value then redis.call('DEL', KEYS[1]); end; return value";

/*
 * A code, redeemed: the value under KEYS[1] when its challenge is ARGV[1]
 * (the S256 of the verifier sent), its state ARGV[2] and its method S256 -
 * deleted in the same step - or nil, leaving it there. So two exchanges
 * cannot both have it, and a wrong verifier does not spend the code of the
 * app that holds the right one.
 */
export const MOBILE_SSO_EXCHANGE_SCRIPT: string =
  "local value = redis.call('GET', KEYS[1]); " +
  "if not value then return nil end; " +
  "local ok, data = pcall(cjson.decode, value); " +
  "if not ok or type(data) ~= 'table' then return nil end; " +
  "if data.codeChallenge ~= ARGV[1] or data.state ~= ARGV[2] " +
  "or data.codeChallengeMethod ~= 'S256' then return nil end; " +
  "redis.call('DEL', KEYS[1]); return value";

// 32 random bytes, base64url: the flow id, the code, and a S256 challenge.
const RANDOM_VALUE_PATTERN: RegExp = /^[A-Za-z0-9_-]{43}$/;

// RFC 7636's code verifier characters and lengths; the app's state too.
const PKCE_VALUE_PATTERN: RegExp = /^[A-Za-z0-9._~-]{43,128}$/;

export interface MobileSsoHandOffRequest {
  codeChallenge: string;
  codeChallengeMethod: "S256";
  state: string;
}

export default class MobileSsoHandOffService {
  /*
   * The hand-off an SSO sign-in's start was asked for, from its query
   * (?mobile=true&state=...&codeChallenge=...&codeChallengeMethod=S256): null
   * when it names none - an app from before this - and refused when it names
   * one that is not well formed, so a malformed request never falls back to
   * the deep link that carries the session.
   */
  public static readRequest(query: unknown): MobileSsoHandOffRequest | null {
    const values: JSONObject =
      query && typeof query === "object" && !Array.isArray(query)
        ? (query as JSONObject)
        : {};

    const state: unknown = values["state"];
    const codeChallenge: unknown = values["codeChallenge"];
    const codeChallengeMethod: unknown = values["codeChallengeMethod"];

    if (
      state === undefined &&
      codeChallenge === undefined &&
      codeChallengeMethod === undefined
    ) {
      return null;
    }

    return MobileSsoHandOffService.validateRequest({
      state,
      codeChallenge,
      codeChallengeMethod,
    });
  }

  public static validateRequest(value: unknown): MobileSsoHandOffRequest {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadDataException(MOBILE_SSO_HAND_OFF_EXPIRED_MESSAGE);
    }

    const data: Partial<Record<keyof MobileSsoHandOffRequest, unknown>> =
      value as Partial<Record<keyof MobileSsoHandOffRequest, unknown>>;

    if (
      typeof data.codeChallenge !== "string" ||
      RANDOM_VALUE_PATTERN.exec(data.codeChallenge)?.[0] !==
        data.codeChallenge ||
      data.codeChallengeMethod !== "S256" ||
      typeof data.state !== "string" ||
      PKCE_VALUE_PATTERN.exec(data.state)?.[0] !== data.state
    ) {
      throw new BadDataException(MOBILE_SSO_HAND_OFF_EXPIRED_MESSAGE);
    }

    return {
      codeChallenge: data.codeChallenge,
      codeChallengeMethod: "S256",
      state: data.state,
    };
  }

  // Keeps the request for the identity provider's round trip: the flow's id.
  public static async startFlow(
    request: MobileSsoHandOffRequest,
  ): Promise<string> {
    const flowId: string = randomBytes(32).toString("base64url");

    await MobileSsoHandOffService.store(
      `${FLOW_PREFIX}${MobileSsoHandOffService.hash(flowId)}`,
      JSON.stringify(MobileSsoHandOffService.validateRequest(request)),
      MOBILE_SSO_FLOW_TTL_SECONDS,
    );

    return flowId;
  }

  public static isFlowId(value: unknown): value is string {
    return (
      typeof value === "string" &&
      RANDOM_VALUE_PATTERN.exec(value)?.[0] === value
    );
  }

  /*
   * The request a flow was started with, read and deleted in one operation:
   * one sign-in per flow. Null for an id that is not one, has expired or was
   * taken already.
   */
  public static async takeFlow(
    flowId: unknown,
  ): Promise<MobileSsoHandOffRequest | null> {
    if (!MobileSsoHandOffService.isFlowId(flowId)) {
      return null;
    }

    const stored: unknown = await MobileSsoHandOffService.getStore().eval(
      MOBILE_SSO_TAKE_ONCE_SCRIPT,
      1,
      `${FLOW_PREFIX}${MobileSsoHandOffService.hash(flowId)}`,
    );

    if (typeof stored !== "string") {
      return null;
    }

    try {
      return MobileSsoHandOffService.validateRequest(JSON.parse(stored));
    } catch {
      return null;
    }
  }

  /*
   * Keeps a finished sign-in for the app under a one-time code bound to its
   * request, and answers the deep link that hands the app the code - never
   * a token.
   */
  public static async createAuthorizationCode(data: {
    request: MobileSsoHandOffRequest;
    signIn: MobileSsoSignIn;
  }): Promise<string> {
    const request: MobileSsoHandOffRequest =
      MobileSsoHandOffService.validateRequest(data.request);
    const code: string = randomBytes(32).toString("base64url");

    await MobileSsoHandOffService.store(
      `${CODE_PREFIX}${MobileSsoHandOffService.hash(code)}`,
      JSON.stringify({
        ...request,
        sealed: MobileSsoHandOffService.seal(code, data.signIn),
      }),
      MOBILE_SSO_CODE_TTL_SECONDS,
    );

    // The destination is fixed: no caller names where the code goes.
    const params: URLSearchParams = new URLSearchParams();
    params.set("code", code);
    params.set("state", request.state);

    return `${MOBILE_SSO_CALLBACK_URL}?${params.toString()}`;
  }

  /*
   * The sign-in a code stands for, for the app holding the verifier whose
   * SHA-256 is the code's challenge, and the state it was started with.
   * Matched and deleted in one Redis operation: two exchanges cannot both
   * have it, and a wrong verifier leaves the code for the app that holds the
   * right one. Refused alike for a code that is not one, has expired, was
   * redeemed already, or comes with another verifier or state.
   */
  public static async exchangeAuthorizationCode(
    value: unknown,
  ): Promise<MobileSsoSignIn> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadDataException(MOBILE_SSO_HAND_OFF_EXPIRED_MESSAGE);
    }

    const data: { code?: unknown; codeVerifier?: unknown; state?: unknown } =
      value as { code?: unknown; codeVerifier?: unknown; state?: unknown };

    if (
      typeof data.code !== "string" ||
      RANDOM_VALUE_PATTERN.exec(data.code)?.[0] !== data.code ||
      typeof data.codeVerifier !== "string" ||
      PKCE_VALUE_PATTERN.exec(data.codeVerifier)?.[0] !== data.codeVerifier ||
      typeof data.state !== "string" ||
      PKCE_VALUE_PATTERN.exec(data.state)?.[0] !== data.state
    ) {
      throw new BadDataException(MOBILE_SSO_HAND_OFF_EXPIRED_MESSAGE);
    }

    const stored: unknown = await MobileSsoHandOffService.getStore().eval(
      MOBILE_SSO_EXCHANGE_SCRIPT,
      1,
      `${CODE_PREFIX}${MobileSsoHandOffService.hash(data.code)}`,
      MobileSsoHandOffService.hash(data.codeVerifier),
      data.state,
    );

    if (typeof stored !== "string") {
      throw new BadDataException(MOBILE_SSO_HAND_OFF_EXPIRED_MESSAGE);
    }

    let signIn: unknown;

    try {
      signIn = MobileSsoHandOffService.unseal(
        data.code,
        (JSON.parse(stored) as { sealed?: unknown }).sealed,
      );
    } catch {
      throw new BadDataException(MOBILE_SSO_HAND_OFF_EXPIRED_MESSAGE);
    }

    if (!MobileSsoHandOffService.isSignIn(signIn)) {
      throw new BadDataException(MOBILE_SSO_HAND_OFF_EXPIRED_MESSAGE);
    }

    return signIn;
  }

  /*
   * The key a code seals its sign-in with: SHA-256 of the code under a label
   * of its own, so the Redis key - SHA-256 of the code alone - says nothing
   * of it.
   */
  private static sealingKey(code: string): Buffer {
    return createHash("sha256")
      .update(`${SEALING_KEY_LABEL}${code}`, "ascii")
      .digest();
  }

  // The sign-in, encrypted and authenticated: iv, tag and ciphertext.
  private static seal(code: string, signIn: MobileSsoSignIn): string {
    const iv: Buffer = randomBytes(12);
    const cipher: CipherGCM = createCipheriv(
      "aes-256-gcm",
      MobileSsoHandOffService.sealingKey(code),
      iv,
    );
    const ciphertext: Buffer = Buffer.concat([
      cipher.update(JSON.stringify(signIn), "utf8"),
      cipher.final(),
    ]);

    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
      "base64url",
    );
  }

  // Throws for anything that is not a sign-in this code sealed.
  private static unseal(code: string, sealed: unknown): unknown {
    if (typeof sealed !== "string") {
      throw new BadDataException(MOBILE_SSO_HAND_OFF_EXPIRED_MESSAGE);
    }

    const bytes: Buffer = Buffer.from(sealed, "base64url");

    if (bytes.length <= 28) {
      throw new BadDataException(MOBILE_SSO_HAND_OFF_EXPIRED_MESSAGE);
    }

    const decipher: DecipherGCM = createDecipheriv(
      "aes-256-gcm",
      MobileSsoHandOffService.sealingKey(code),
      bytes.subarray(0, 12),
    );
    decipher.setAuthTag(bytes.subarray(12, 28));

    return JSON.parse(
      Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]).toString("utf8"),
    );
  }

  private static isSignIn(value: unknown): value is MobileSsoSignIn {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    const signIn: Record<string, unknown> = value as Record<string, unknown>;

    return (
      typeof signIn["accessToken"] === "string" &&
      typeof signIn["refreshToken"] === "string" &&
      typeof signIn["refreshTokenExpiresAt"] === "string" &&
      typeof signIn["userId"] === "string" &&
      ObjectID.isValidUUID(signIn["userId"])
    );
  }

  // SHA-256, base64url: S256's challenge of a verifier, and every Redis key here.
  public static hash(value: string): string {
    return createHash("sha256").update(value, "ascii").digest("base64url");
  }

  private static getStore(): ClientType {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      throw new DatabaseNotConnectedException(
        "Signing in to the mobile app with single sign-on is unavailable right now. Try again in a minute.",
      );
    }

    return client;
  }

  private static async store(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<void> {
    const result: string | null = await MobileSsoHandOffService.getStore().set(
      key,
      value,
      "EX",
      ttlSeconds,
      "NX",
    );

    if (result !== "OK") {
      throw new BadDataException(MOBILE_SSO_HAND_OFF_EXPIRED_MESSAGE);
    }
  }
}
