import MobileSsoHandOffService, {
  MOBILE_SSO_CODE_TTL_SECONDS,
  MOBILE_SSO_FLOW_TTL_SECONDS,
  MobileSsoHandOffRequest,
} from "../../../Server/Services/MobileSsoHandOffService";
import Redis from "../../../Server/Infrastructure/Redis";
import BadDataException from "../../../Types/Exception/BadDataException";
import DatabaseNotConnectedException from "../../../Types/Exception/DatabaseNotConnectedException";
import {
  MOBILE_SSO_CALLBACK_URL,
  MOBILE_SSO_HAND_OFF_EXPIRED_MESSAGE,
  MobileSsoSignIn,
} from "../../../Types/SSO/MobileSsoHandOff";
import FakeMobileSsoHandOffRedis, {
  FakeMobileSsoHandOffEntry,
} from "../TestingUtils/Redis/FakeMobileSsoHandOffRedis";
import { createHash } from "crypto";
import { getJestSpyOn } from "../../Spy";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: { getClient: jest.fn(), isConnected: jest.fn() },
  };
});

/*
 * THE MOBILE APP'S SSO HAND-OFF (#9989): what a deep link that ends an SSO
 * sign-in in the app may carry, and what redeeming it takes.
 *
 * The threat is the deep link itself: oneuptime://sso-callback is a custom
 * scheme any Android app can say it handles, and anybody can open. So these
 * tests hold the service to what an interceptor or a forger gets from it:
 *
 *   - the link carries a one-time code and the app's own state - never a
 *     token, never anything about the person;
 *   - the code is worthless without the PKCE verifier that never left the
 *     app, works once, and a wrong verifier or state neither redeems it nor
 *     burns it for the app that holds the right one;
 *   - Redis holds nothing to redeem: only hashes as keys, and the sign-in
 *     sealed with a key only the code gives.
 *
 * The Redis here is a fake that runs the service's two Lua scripts as Redis
 * does - read and delete in one step; match the challenge and the state,
 * then delete - refuses any other, and records every key, value and expiry
 * it was handed (TestingUtils/Redis/FakeMobileSsoHandOffRedis).
 */

// RFC 7636, appendix B: a verifier and its S256 challenge.
const VERIFIER: string = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE: string = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const STATE: string = "app-state-" + "s".repeat(54);

const REQUEST: MobileSsoHandOffRequest = {
  codeChallenge: CHALLENGE,
  codeChallengeMethod: "S256",
  state: STATE,
};

const SIGN_IN: MobileSsoSignIn = {
  accessToken: "access-token-for-the-session",
  refreshToken: "refresh-token-for-the-session",
  refreshTokenExpiresAt: "2026-12-31T23:59:59.000Z",
  userId: "11111111-1111-4111-8111-111111111111",
  email: "responder@acme.com",
  name: "Ada Responder",
  isMasterAdmin: false,
  ssoToken: "project-sso-token",
  projectId: "22222222-2222-4222-8222-222222222222",
};

type StoredEntry = FakeMobileSsoHandOffEntry;

let redis: FakeMobileSsoHandOffRedis;

const hashOf: (value: string) => string = (value: string): string => {
  return createHash("sha256").update(value, "ascii").digest("base64url");
};

const codeOf: (callbackUrl: string) => { code: string; state: string } = (
  callbackUrl: string,
): { code: string; state: string } => {
  const query: URLSearchParams = new URLSearchParams(
    callbackUrl.slice(callbackUrl.indexOf("?") + 1),
  );

  return { code: query.get("code") || "", state: query.get("state") || "" };
};

const issueCode: () => Promise<string> = async (): Promise<string> => {
  const callbackUrl: string =
    await MobileSsoHandOffService.createAuthorizationCode({
      request: REQUEST,
      signIn: SIGN_IN,
    });

  return codeOf(callbackUrl).code;
};

const expectRefused: (work: Promise<unknown>) => Promise<void> = async (
  work: Promise<unknown>,
): Promise<void> => {
  await expect(work).rejects.toThrow(BadDataException);
  await expect(work).rejects.toThrow(MOBILE_SSO_HAND_OFF_EXPIRED_MESSAGE);
};

beforeEach(() => {
  jest.restoreAllMocks();
  redis = new FakeMobileSsoHandOffRedis();
  getJestSpyOn(Redis, "getClient").mockReturnValue(redis);
  getJestSpyOn(Redis, "isConnected").mockReturnValue(true);
});

describe("the S256 challenge", () => {
  it("is SHA-256 of the verifier in base64url, as RFC 7636 computes it", () => {
    expect(MobileSsoHandOffService.hash(VERIFIER)).toBe(CHALLENGE);
  });
});

describe("what a start may ask for", () => {
  it("is a state, a 43-character S256 challenge and S256, and nothing else", () => {
    expect(
      MobileSsoHandOffService.validateRequest({
        ...REQUEST,
        callbackUrl: "evil://steal",
        userId: SIGN_IN.userId,
      }),
    ).toEqual(REQUEST);
  });

  it.each([undefined, null, [], "state", 1, true])(
    "refuses %p",
    (value: unknown) => {
      expect(() => {
        return MobileSsoHandOffService.validateRequest(value);
      }).toThrow(MOBILE_SSO_HAND_OFF_EXPIRED_MESSAGE);
    },
  );

  it.each([
    { codeChallenge: undefined },
    { codeChallenge: "short" },
    { codeChallenge: CHALLENGE + "A" },
    { codeChallenge: "=".repeat(43) },
    { codeChallenge: CHALLENGE + "\n" },
    { codeChallengeMethod: "plain" },
    { codeChallengeMethod: "s256" },
    { codeChallengeMethod: undefined },
    { state: undefined },
    { state: "s".repeat(42) },
    { state: "s".repeat(129) },
    { state: STATE + "&code=x" },
    { state: STATE + "\n" },
    { state: 12345 },
  ])("refuses a malformed field %p", (override: Record<string, unknown>) => {
    expect(() => {
      return MobileSsoHandOffService.validateRequest({
        ...REQUEST,
        ...override,
      });
    }).toThrow(MOBILE_SSO_HAND_OFF_EXPIRED_MESSAGE);
  });

  it("is none for a start that names none of it: an app from before the hand-off", () => {
    expect(MobileSsoHandOffService.readRequest({ mobile: "true" })).toBeNull();
    expect(MobileSsoHandOffService.readRequest(undefined)).toBeNull();
  });

  it("is read from a start's query", () => {
    expect(
      MobileSsoHandOffService.readRequest({ mobile: "true", ...REQUEST }),
    ).toEqual(REQUEST);
  });

  /*
   * A start that names part of a hand-off is refused, never read as none:
   * none ends on the deep link that carries the session.
   */
  it.each([
    { state: STATE },
    { codeChallenge: CHALLENGE },
    { codeChallengeMethod: "S256" },
    { state: STATE, codeChallenge: CHALLENGE },
    { state: STATE, codeChallenge: CHALLENGE, codeChallengeMethod: "plain" },
    {
      state: [STATE, STATE],
      codeChallenge: CHALLENGE,
      codeChallengeMethod: "S256",
    },
  ])(
    "refuses a start that names part of one, or names it twice: %p",
    (query: Record<string, unknown>) => {
      expect(() => {
        return MobileSsoHandOffService.readRequest({
          mobile: "true",
          ...query,
        });
      }).toThrow(MOBILE_SSO_HAND_OFF_EXPIRED_MESSAGE);
    },
  );
});

describe("a flow, kept for the identity provider's round trip", () => {
  it("is kept under a hash of its id, for fifteen minutes, holding only the request", async () => {
    const flowId: string = await MobileSsoHandOffService.startFlow(REQUEST);

    expect(MobileSsoHandOffService.isFlowId(flowId)).toBe(true);
    expect([...redis.entries.keys()]).toEqual([
      `mobile-sso-flow-${hashOf(flowId)}`,
    ]);

    const entry: StoredEntry = [...redis.entries.values()][0]!;

    expect(entry.ttlSeconds).toBe(MOBILE_SSO_FLOW_TTL_SECONDS);
    expect(MOBILE_SSO_FLOW_TTL_SECONDS).toBe(15 * 60);
    expect(JSON.parse(entry.value)).toEqual(REQUEST);
    expect(entry.value).not.toContain(flowId);
  });

  it("has an id of its own each time", async () => {
    const first: string = await MobileSsoHandOffService.startFlow(REQUEST);
    const second: string = await MobileSsoHandOffService.startFlow(REQUEST);

    expect(first).not.toBe(second);
    expect(redis.entries.size).toBe(2);
  });

  it("is taken once: one sign-in per flow", async () => {
    const flowId: string = await MobileSsoHandOffService.startFlow(REQUEST);

    await expect(MobileSsoHandOffService.takeFlow(flowId)).resolves.toEqual(
      REQUEST,
    );
    await expect(MobileSsoHandOffService.takeFlow(flowId)).resolves.toBeNull();
    expect(redis.entries.size).toBe(0);
  });

  it("is none for an id that was never one, without asking Redis", async () => {
    for (const value of [
      undefined,
      null,
      "",
      "true",
      "mobile",
      "a".repeat(42),
      "a".repeat(44),
      "a".repeat(42) + "=",
      ["a".repeat(43)],
    ]) {
      await expect(MobileSsoHandOffService.takeFlow(value)).resolves.toBeNull();
    }

    expect(redis.evals).toEqual([]);
  });

  it("is none for an id nobody started, or one that has expired", async () => {
    await expect(
      MobileSsoHandOffService.takeFlow("b".repeat(43)),
    ).resolves.toBeNull();
  });
});

describe("the deep link a finished sign-in hands the app", () => {
  it("carries the one-time code and the app's own state, and nothing else", async () => {
    const callbackUrl: string =
      await MobileSsoHandOffService.createAuthorizationCode({
        request: REQUEST,
        signIn: SIGN_IN,
      });

    expect(callbackUrl.startsWith(`${MOBILE_SSO_CALLBACK_URL}?`)).toBe(true);

    const query: URLSearchParams = new URLSearchParams(
      callbackUrl.slice(callbackUrl.indexOf("?") + 1),
    );

    expect([...query.keys()].sort()).toEqual(["code", "state"]);
    expect(query.get("state")).toBe(STATE);
    expect(MobileSsoHandOffService.isFlowId(query.get("code"))).toBe(true);

    for (const secret of [
      SIGN_IN.accessToken,
      SIGN_IN.refreshToken,
      SIGN_IN.ssoToken!,
      SIGN_IN.email,
      SIGN_IN.userId,
      CHALLENGE,
    ]) {
      expect(callbackUrl).not.toContain(secret);
    }
  });

  it("goes only to the app: the destination is fixed", async () => {
    const callbackUrl: string =
      await MobileSsoHandOffService.createAuthorizationCode({
        request: {
          ...REQUEST,
          callbackUrl: "https://evil.example/steal",
        } as unknown as MobileSsoHandOffRequest,
        signIn: SIGN_IN,
      });

    expect(callbackUrl.startsWith("oneuptime://sso-callback?code=")).toBe(true);
    expect(callbackUrl).not.toContain("evil");
  });

  it("keeps nothing in Redis that redeems it or reads the session: a hashed key, a sealed sign-in, two minutes", async () => {
    const code: string = await issueCode();

    expect([...redis.entries.keys()]).toEqual([
      `mobile-sso-code-${hashOf(code)}`,
    ]);

    const entry: StoredEntry = [...redis.entries.values()][0]!;

    expect(entry.ttlSeconds).toBe(MOBILE_SSO_CODE_TTL_SECONDS);
    expect(MOBILE_SSO_CODE_TTL_SECONDS).toBe(120);

    for (const secret of [
      code,
      SIGN_IN.accessToken,
      SIGN_IN.refreshToken,
      SIGN_IN.ssoToken!,
      SIGN_IN.email,
      SIGN_IN.name,
    ]) {
      expect(entry.value).not.toContain(secret);
    }

    const stored: Record<string, unknown> = JSON.parse(entry.value) as Record<
      string,
      unknown
    >;

    expect(Object.keys(stored).sort()).toEqual([
      "codeChallenge",
      "codeChallengeMethod",
      "sealed",
      "state",
    ]);
  });

  it("refuses a request that is not one, and keeps nothing", async () => {
    await expect(
      MobileSsoHandOffService.createAuthorizationCode({
        request: {
          ...REQUEST,
          codeChallengeMethod: "plain",
        } as unknown as MobileSsoHandOffRequest,
        signIn: SIGN_IN,
      }),
    ).rejects.toThrow(MOBILE_SSO_HAND_OFF_EXPIRED_MESSAGE);
    expect(redis.entries.size).toBe(0);
  });
});

describe("redeeming a code", () => {
  it("answers the sign-in to the app holding the verifier and the state", async () => {
    const code: string = await issueCode();

    await expect(
      MobileSsoHandOffService.exchangeAuthorizationCode({
        code: code,
        codeVerifier: VERIFIER,
        state: STATE,
      }),
    ).resolves.toEqual(SIGN_IN);
  });

  it("works once", async () => {
    const code: string = await issueCode();

    await MobileSsoHandOffService.exchangeAuthorizationCode({
      code: code,
      codeVerifier: VERIFIER,
      state: STATE,
    });

    await expectRefused(
      MobileSsoHandOffService.exchangeAuthorizationCode({
        code: code,
        codeVerifier: VERIFIER,
        state: STATE,
      }),
    );
    expect(redis.entries.size).toBe(0);
  });

  /*
   * What an app that intercepted the deep link holds: the code and the
   * state, not the verifier. Its guess neither redeems the code nor spends
   * it, so the app that started the sign-in still can.
   */
  it("refuses another verifier, and leaves the code for the app that holds the right one", async () => {
    const code: string = await issueCode();

    for (const codeVerifier of [
      "x".repeat(43),
      VERIFIER.slice(0, -1) + "Y",
      CHALLENGE,
    ]) {
      await expectRefused(
        MobileSsoHandOffService.exchangeAuthorizationCode({
          code: code,
          codeVerifier: codeVerifier,
          state: STATE,
        }),
      );
    }

    expect(redis.entries.size).toBe(1);

    await expect(
      MobileSsoHandOffService.exchangeAuthorizationCode({
        code: code,
        codeVerifier: VERIFIER,
        state: STATE,
      }),
    ).resolves.toEqual(SIGN_IN);
  });

  it("refuses another state, and leaves the code", async () => {
    const code: string = await issueCode();

    await expectRefused(
      MobileSsoHandOffService.exchangeAuthorizationCode({
        code: code,
        codeVerifier: VERIFIER,
        state: "another-state-" + "t".repeat(50),
      }),
    );

    expect(redis.entries.size).toBe(1);
  });

  it("refuses a code nobody was handed, or one that has expired", async () => {
    await expectRefused(
      MobileSsoHandOffService.exchangeAuthorizationCode({
        code: "c".repeat(43),
        codeVerifier: VERIFIER,
        state: STATE,
      }),
    );
  });

  it.each([
    undefined,
    null,
    [],
    "code",
    {},
    { codeVerifier: VERIFIER, state: STATE },
    { code: "c".repeat(42), codeVerifier: VERIFIER, state: STATE },
    { code: "c".repeat(43) + "\n", codeVerifier: VERIFIER, state: STATE },
    { code: "c".repeat(43), codeVerifier: "short", state: STATE },
    { code: "c".repeat(43), codeVerifier: VERIFIER + "%", state: STATE },
    { code: "c".repeat(43), codeVerifier: VERIFIER },
    { code: "c".repeat(43), codeVerifier: VERIFIER, state: "s" },
    { code: ["c".repeat(43)], codeVerifier: VERIFIER, state: STATE },
  ])("refuses %p without asking Redis", async (value: unknown) => {
    await expectRefused(
      MobileSsoHandOffService.exchangeAuthorizationCode(value),
    );
    expect(redis.evals).toEqual([]);
  });

  it("asks Redis with the verifier's challenge, never the verifier", async () => {
    const code: string = await issueCode();

    await MobileSsoHandOffService.exchangeAuthorizationCode({
      code: code,
      codeVerifier: VERIFIER,
      state: STATE,
    });

    const args: Array<unknown> = redis.evals[0]!;

    expect(args).toContain(CHALLENGE);
    expect(args).not.toContain(VERIFIER);
    expect(args).not.toContain(code);
  });

  it("refuses a sealed sign-in that was tampered with", async () => {
    const code: string = await issueCode();
    const key: string = `mobile-sso-code-${hashOf(code)}`;
    const entry: StoredEntry = redis.entries.get(key)!;
    const stored: Record<string, string> = JSON.parse(entry.value) as Record<
      string,
      string
    >;
    const sealed: Buffer = Buffer.from(stored["sealed"]!, "base64url");

    sealed[sealed.length - 1] = sealed[sealed.length - 1]! ^ 0x01;
    redis.entries.set(key, {
      ...entry,
      value: JSON.stringify({
        ...stored,
        sealed: sealed.toString("base64url"),
      }),
    });

    await expectRefused(
      MobileSsoHandOffService.exchangeAuthorizationCode({
        code: code,
        codeVerifier: VERIFIER,
        state: STATE,
      }),
    );
  });

  /*
   * The sealing key comes from the code, not from what Redis keeps: an
   * entry moved under another code's key does not open with that code.
   */
  it("opens a sealed sign-in only with the code that sealed it", async () => {
    const first: string = await issueCode();
    const second: string = await issueCode();
    const firstKey: string = `mobile-sso-code-${hashOf(first)}`;
    const secondKey: string = `mobile-sso-code-${hashOf(second)}`;

    redis.entries.set(secondKey, redis.entries.get(firstKey)!);

    await expectRefused(
      MobileSsoHandOffService.exchangeAuthorizationCode({
        code: second,
        codeVerifier: VERIFIER,
        state: STATE,
      }),
    );
  });

  it("answers every refusal with the same words", async () => {
    const code: string = await issueCode();
    const messages: Set<string> = new Set<string>();

    for (const value of [
      { code: code, codeVerifier: "x".repeat(43), state: STATE },
      { code: code, codeVerifier: VERIFIER, state: "u".repeat(43) },
      { code: "d".repeat(43), codeVerifier: VERIFIER, state: STATE },
      { code: "short", codeVerifier: VERIFIER, state: STATE },
    ]) {
      try {
        await MobileSsoHandOffService.exchangeAuthorizationCode(value);
      } catch (err: unknown) {
        messages.add((err as Error).message);
      }
    }

    expect([...messages]).toEqual([MOBILE_SSO_HAND_OFF_EXPIRED_MESSAGE]);
  });
});

describe("while Redis cannot be reached", () => {
  it("starts no flow, hands back no code and redeems none - and says so", async () => {
    getJestSpyOn(Redis, "isConnected").mockReturnValue(false);

    await expect(MobileSsoHandOffService.startFlow(REQUEST)).rejects.toThrow(
      DatabaseNotConnectedException,
    );
    await expect(
      MobileSsoHandOffService.createAuthorizationCode({
        request: REQUEST,
        signIn: SIGN_IN,
      }),
    ).rejects.toThrow(DatabaseNotConnectedException);
    await expect(
      MobileSsoHandOffService.exchangeAuthorizationCode({
        code: "c".repeat(43),
        codeVerifier: VERIFIER,
        state: STATE,
      }),
    ).rejects.toThrow(DatabaseNotConnectedException);
  });
});
