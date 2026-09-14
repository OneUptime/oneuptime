import MobilePasskeyLoginService, {
  MobilePasskeyContext,
} from "../../../Server/Services/MobilePasskeyLoginService";
import Redis from "../../../Server/Infrastructure/Redis";
import * as EnvironmentConfig from "../../../Server/EnvironmentConfig";
import ObjectID from "../../../Types/ObjectID";
import { createHash } from "crypto";
import { URL } from "url";
import { getJestSpyOn } from "../../Spy";

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    __esModule: true,
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    Host: "EXAMPLE.COM:443",
    HttpProtocol: "https://",
  };
});
jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: { getClient: jest.fn(), isConnected: jest.fn() },
  };
});

const verifier: string = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const challenge: string = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const state: string = "s".repeat(64);
const userId: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const context: MobilePasskeyContext = {
  codeChallenge: challenge,
  codeChallengeMethod: "S256",
  state,
  serverOrigin: "https://example.com",
};
const code: string = "a".repeat(43);
let client: { set: jest.Mock; eval: jest.Mock };

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  client = {
    set: jest.fn().mockResolvedValue("OK"),
    eval: jest.fn().mockResolvedValue(null),
  };
  getJestSpyOn(Redis, "getClient").mockReturnValue(client);
  getJestSpyOn(Redis, "isConnected").mockReturnValue(true);
});

describe("mobile passkey request validation", () => {
  it("normalizes the configured HTTPS origin and discards supplied destinations", () => {
    expect(
      MobilePasskeyLoginService.validateRequest({
        ...context,
        serverOrigin: "https://attacker.example",
        callbackUrl: "attacker://callback",
      }),
    ).toEqual(context);
  });

  it.each([undefined, null, [], "invalid", 1, true])(
    "rejects malformed mobile metadata %p",
    (value: unknown) => {
      expect(() => {
        return MobilePasskeyLoginService.validateRequest(value);
      }).toThrow();
    },
  );

  it.each([
    { codeChallenge: undefined },
    { codeChallenge: "short" },
    { codeChallenge: "a".repeat(44) },
    { codeChallenge: "=".repeat(43) },
    { codeChallengeMethod: "plain" },
    { codeChallengeMethod: undefined },
    { state: undefined },
    { state: "s".repeat(42) },
    { state: "s".repeat(129) },
    { state: "s".repeat(42) + "&" },
  ])(
    "rejects invalid PKCE or state fields %p",
    (override: Record<string, unknown>) => {
      expect(() => {
        return MobilePasskeyLoginService.validateRequest({
          ...context,
          ...override,
        });
      }).toThrow();
    },
  );

  it.each(["\n", "\r", "\r\n"])(
    "rejects a trailing line ending in mobile request fields: %p",
    (ending: string) => {
      for (const override of [
        { codeChallenge: challenge + ending },
        { state: state + ending },
      ]) {
        expect(() => {
          return MobilePasskeyLoginService.validateRequest({
            ...context,
            ...override,
          });
        }).toThrow();
      }
    },
  );

  it("refuses mobile sign-in on an insecure server", () => {
    const configuration: { HttpProtocol: string } =
      EnvironmentConfig as unknown as { HttpProtocol: string };
    const previous: string = configuration.HttpProtocol;
    configuration.HttpProtocol = "http://";
    try {
      expect(() => {
        return MobilePasskeyLoginService.validateRequest(context);
      }).toThrow();
    } finally {
      configuration.HttpProtocol = previous;
    }
  });
});

describe("mobile passkey challenge binding", () => {
  it("stores only validated handoff metadata with a five-minute TTL", async () => {
    await MobilePasskeyLoginService.storeChallengeContext(code, context);
    expect(client.set).toHaveBeenCalledWith(
      `mobile-passkey-challenge-${createHash("sha256").update(code).digest("base64url")}`,
      JSON.stringify(context),
      "EX",
      300,
      "NX",
    );
  });

  it("atomically consumes the exact browser challenge's context", async () => {
    client.eval.mockResolvedValue(JSON.stringify(context));
    await expect(
      MobilePasskeyLoginService.consumeChallengeContext(code),
    ).resolves.toEqual(context);
    expect(client.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('DEL', KEYS[1])"),
      1,
      `mobile-passkey-challenge-${createHash("sha256").update(code).digest("base64url")}`,
    );
  });

  it("returns no context for an ordinary browser challenge", async () => {
    await expect(
      MobilePasskeyLoginService.consumeChallengeContext(code),
    ).resolves.toBeNull();
  });

  it.each([
    1,
    "broken-json",
    "null",
    "{}",
    JSON.stringify({ ...context, serverOrigin: "https://other.example" }),
    JSON.stringify({ ...context, codeChallengeMethod: "plain" }),
  ])(
    "fails closed for malformed stored metadata %p",
    async (value: unknown) => {
      client.eval.mockResolvedValue(value);
      await expect(
        MobilePasskeyLoginService.consumeChallengeContext(code),
      ).rejects.toThrow();
    },
  );
});

describe("mobile authorization codes", () => {
  it("returns only a random code, state and server on the fixed app callback", async () => {
    const callback: URL = new URL(
      await MobilePasskeyLoginService.createAuthorizationCode({
        userId,
        context,
      }),
    );
    expect(callback.protocol).toBe("oneuptime:");
    expect(callback.hostname).toBe("passkey");
    expect(callback.pathname).toBe("");
    expect(callback.searchParams.get("code")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(callback.searchParams.get("state")).toBe(state);
    expect(callback.searchParams.get("serverOrigin")).toBe(
      context.serverOrigin,
    );
    expect(Array.from(callback.searchParams.keys())).toEqual([
      "code",
      "state",
      "serverOrigin",
    ]);
    expect(client.set).toHaveBeenCalledWith(
      expect.stringMatching(/^mobile-passkey-code-[A-Za-z0-9_-]{43}$/),
      JSON.stringify({ ...context, userId: userId.toString() }),
      "EX",
      120,
      "NX",
    );
    expect(client.set.mock.calls[0]?.[0]).not.toContain(
      callback.searchParams.get("code"),
    );
  });

  it("refuses a context issued for another server", async () => {
    await expect(
      MobilePasskeyLoginService.createAuthorizationCode({
        userId,
        context: { ...context, serverOrigin: "https://other.example" },
      }),
    ).rejects.toThrow();
    expect(client.set).not.toHaveBeenCalled();
  });

  it("uses the RFC 7636 S256 challenge, never sends the verifier to Redis", async () => {
    client.eval.mockResolvedValue(userId.toString());
    await expect(
      MobilePasskeyLoginService.exchangeAuthorizationCode({
        code,
        codeVerifier: verifier,
        state,
      }),
    ).resolves.toEqual(userId);
    expect(client.eval).toHaveBeenCalledWith(
      expect.stringContaining("data.codeChallenge ~= ARGV[1]"),
      1,
      expect.stringMatching(/^mobile-passkey-code-/),
      challenge,
      state,
      context.serverOrigin,
    );
    expect(JSON.stringify(client.eval.mock.calls)).not.toContain(verifier);
  });

  it.each([
    null,
    undefined,
    [],
    { code, codeVerifier: verifier },
    { code, codeVerifier: verifier, state: "short" },
    { code: "short", codeVerifier: verifier, state },
    { code: "a".repeat(44), codeVerifier: verifier, state },
    { code, codeVerifier: "short", state },
    { code, codeVerifier: "v".repeat(129), state },
    { code, codeVerifier: "v".repeat(42) + "/", state },
    { code, codeVerifier: {}, state },
  ])(
    "rejects malformed exchanges before touching Redis: %p",
    async (value: unknown) => {
      await expect(
        MobilePasskeyLoginService.exchangeAuthorizationCode(value),
      ).rejects.toThrow();
      expect(client.eval).not.toHaveBeenCalled();
    },
  );

  it.each(["\n", "\r", "\r\n"])(
    "rejects a trailing line ending in code, verifier or state before Redis: %p",
    async (ending: string) => {
      for (const override of [
        { code: code + ending },
        { codeVerifier: verifier + ending },
        { state: state + ending },
      ]) {
        await expect(
          MobilePasskeyLoginService.exchangeAuthorizationCode({
            code,
            codeVerifier: verifier,
            state,
            ...override,
          }),
        ).rejects.toThrow();
      }
      expect(client.eval).not.toHaveBeenCalled();
    },
  );

  it.each([null, 1, "", "not-a-user-id"])(
    "rejects a missing, expired, mismatched or malformed code result %p",
    async (value: unknown) => {
      client.eval.mockResolvedValue(value);
      await expect(
        MobilePasskeyLoginService.exchangeAuthorizationCode({
          code,
          codeVerifier: verifier,
          state,
        }),
      ).rejects.toThrow();
    },
  );

  it("fails closed when the store is unavailable", async () => {
    getJestSpyOn(Redis, "isConnected").mockReturnValue(false);
    await expect(
      MobilePasskeyLoginService.createAuthorizationCode({ userId, context }),
    ).rejects.toThrow("temporarily unavailable");
    await expect(
      MobilePasskeyLoginService.exchangeAuthorizationCode({
        code,
        codeVerifier: verifier,
        state,
      }),
    ).rejects.toThrow("temporarily unavailable");
    expect(client.set).not.toHaveBeenCalled();
    expect(client.eval).not.toHaveBeenCalled();
  });

  it("fails closed on a refused code write", async () => {
    client.set.mockResolvedValue(null);
    await expect(
      MobilePasskeyLoginService.createAuthorizationCode({ userId, context }),
    ).rejects.toThrow();
  });
});
