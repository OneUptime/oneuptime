import Redis, { ClientType } from "../Infrastructure/Redis";
import { Host, HttpProtocol } from "../EnvironmentConfig";
import BadDataException from "../../Types/Exception/BadDataException";
import DatabaseNotConnectedException from "../../Types/Exception/DatabaseNotConnectedException";
import ObjectID from "../../Types/ObjectID";
import { createHash, randomBytes } from "crypto";
import { URL } from "url";

export interface MobilePasskeyRequest {
  codeChallenge: string;
  codeChallengeMethod: "S256";
  state: string;
}

export interface MobilePasskeyContext extends MobilePasskeyRequest {
  serverOrigin: string;
}

const HANDOFF_ERROR: string =
  "Unable to complete mobile passkey sign-in. Please start again in the app.";
const CHALLENGE_PREFIX: string = "mobile-passkey-challenge-";
const CODE_PREFIX: string = "mobile-passkey-code-";
const CODE_TTL_SECONDS: number = 120;
const CHALLENGE_TTL_SECONDS: number = 300;
const RANDOM_VALUE_PATTERN: RegExp = /^[A-Za-z0-9_-]{43}$/;
const PKCE_VALUE_PATTERN: RegExp = /^[A-Za-z0-9._~-]{43,128}$/;

/*
 * Keep the authorization code separate from the eventual session. A callback
 * intercepted by another app contains no access or refresh token and cannot be
 * redeemed without the verifier held by the app that started this sign-in.
 */
export default class MobilePasskeyLoginService {
  public static validateRequest(value: unknown): MobilePasskeyContext {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadDataException(HANDOFF_ERROR);
    }

    const data: Partial<MobilePasskeyRequest> = value;
    if (
      typeof data.codeChallenge !== "string" ||
      data.codeChallenge.length !== 43 ||
      !RANDOM_VALUE_PATTERN.test(data.codeChallenge) ||
      data.codeChallengeMethod !== "S256" ||
      typeof data.state !== "string" ||
      PKCE_VALUE_PATTERN.exec(data.state)?.[0] !== data.state
    ) {
      throw new BadDataException(HANDOFF_ERROR);
    }

    return {
      codeChallenge: data.codeChallenge,
      codeChallengeMethod: "S256",
      state: data.state,
      serverOrigin: this.getServerOrigin(),
    };
  }

  public static async storeChallengeContext(
    challengeId: string,
    context: MobilePasskeyContext,
  ): Promise<void> {
    await this.store(
      `${CHALLENGE_PREFIX}${this.hash(challengeId)}`,
      JSON.stringify(context),
      CHALLENGE_TTL_SECONDS,
    );
  }

  public static async consumeChallengeContext(
    challengeId: string,
  ): Promise<MobilePasskeyContext | null> {
    const result: unknown = await this.getStore().eval(
      "local value = redis.call('GET', KEYS[1]); " +
        "if value then redis.call('DEL', KEYS[1]); end; return value",
      1,
      `${CHALLENGE_PREFIX}${this.hash(challengeId)}`,
    );

    if (result === null) {
      return null;
    }

    if (typeof result !== "string") {
      throw new BadDataException(HANDOFF_ERROR);
    }

    let stored: MobilePasskeyContext;
    try {
      stored = JSON.parse(result) as MobilePasskeyContext;
    } catch {
      throw new BadDataException(HANDOFF_ERROR);
    }

    const context: MobilePasskeyContext = this.validateRequest(stored);
    if (stored.serverOrigin !== context.serverOrigin) {
      throw new BadDataException(HANDOFF_ERROR);
    }

    return context;
  }

  public static async createAuthorizationCode(data: {
    userId: ObjectID;
    context: MobilePasskeyContext;
  }): Promise<string> {
    if (data.context.serverOrigin !== this.getServerOrigin()) {
      throw new BadDataException(HANDOFF_ERROR);
    }

    const code: string = randomBytes(32).toString("base64url");
    await this.store(
      `${CODE_PREFIX}${this.hash(code)}`,
      JSON.stringify({
        ...data.context,
        userId: data.userId.toString(),
      }),
      CODE_TTL_SECONDS,
    );

    // The callback destination is fixed; no caller-controlled redirect URL.
    const callback: URL = new URL("oneuptime://passkey");
    callback.searchParams.set("code", code);
    callback.searchParams.set("state", data.context.state);
    callback.searchParams.set("serverOrigin", data.context.serverOrigin);
    return callback.toString();
  }

  public static async exchangeAuthorizationCode(
    value: unknown,
  ): Promise<ObjectID> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadDataException(HANDOFF_ERROR);
    }

    const data: { code?: unknown; codeVerifier?: unknown; state?: unknown } =
      value;
    if (
      typeof data.code !== "string" ||
      data.code.length !== 43 ||
      !RANDOM_VALUE_PATTERN.test(data.code) ||
      typeof data.codeVerifier !== "string" ||
      PKCE_VALUE_PATTERN.exec(data.codeVerifier)?.[0] !== data.codeVerifier ||
      typeof data.state !== "string" ||
      PKCE_VALUE_PATTERN.exec(data.state)?.[0] !== data.state
    ) {
      throw new BadDataException(HANDOFF_ERROR);
    }

    /*
     * Match and delete in one Redis operation. Concurrent exchanges cannot
     * issue two sessions, and a wrong verifier cannot burn the legitimate
     * app's code. This also works on Redis versions without GETDEL.
     */
    const userId: unknown = await this.getStore().eval(
      "local value = redis.call('GET', KEYS[1]); " +
        "if not value then return nil end; " +
        "local ok, data = pcall(cjson.decode, value); " +
        "if not ok or type(data) ~= 'table' then return nil end; " +
        "if data.codeChallenge ~= ARGV[1] or data.state ~= ARGV[2] " +
        "or data.serverOrigin ~= ARGV[3] or data.codeChallengeMethod ~= 'S256' " +
        "or type(data.userId) ~= 'string' then return nil end; " +
        "redis.call('DEL', KEYS[1]); return data.userId",
      1,
      `${CODE_PREFIX}${this.hash(data.code)}`,
      this.hash(data.codeVerifier),
      data.state,
      this.getServerOrigin(),
    );

    if (typeof userId !== "string" || !ObjectID.isValidUUID(userId)) {
      throw new BadDataException(HANDOFF_ERROR);
    }

    return new ObjectID(userId);
  }

  private static getServerOrigin(): string {
    const origin: URL = new URL(`${HttpProtocol}${Host.toString()}`);
    if (origin.protocol !== "https:") {
      throw new BadDataException(HANDOFF_ERROR);
    }
    return origin.origin;
  }

  private static hash(value: string): string {
    return createHash("sha256").update(value, "ascii").digest("base64url");
  }

  private static getStore(): ClientType {
    const client: ClientType | null = Redis.getClient();
    if (!client || !Redis.isConnected()) {
      throw new DatabaseNotConnectedException(
        "Mobile passkey sign-in is temporarily unavailable",
      );
    }
    return client;
  }

  private static async store(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<void> {
    const result: string | null = await this.getStore().set(
      key,
      value,
      "EX",
      ttlSeconds,
      "NX",
    );
    if (result !== "OK") {
      throw new BadDataException(HANDOFF_ERROR);
    }
  }
}
