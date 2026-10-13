import {
  OPERATOR_ENCRYPTION_SECRET,
  SHIPPED_ENCRYPTION_SECRETS,
  ShippedEncryptionSecret,
  restoreEncryptionSecret,
  setEncryptionSecret,
} from "../TestingUtils/ShippedEncryptionSecrets";
import { JSONObject } from "../../../Types/JSON";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import crypto from "crypto";
import jwt from "jsonwebtoken";

/*
 * TokenSigningKey: the key every token this server signs, and every signed
 * token it accepts, is made with.
 *
 *   - An installation whose operator set ENCRYPTION_SECRET signs with exactly
 *     that, as it always did, so nobody is signed out by the upgrade and the
 *     MCP and resend tokens it already handed out still verify.
 *   - An installation whose ENCRYPTION_SECRET is unset or a value this
 *     repository ships never signs with it, and a token signed with that
 *     public value does not verify there. It signs with a key of its own:
 *     the installation's, once loaded, and until then one made for the
 *     process alone.
 *   - The installation's key is 256 bits of hex, or it is not used.
 *
 * EnvironmentConfig reads ENCRYPTION_SECRET when it loads, so each
 * installation here is a fresh module registry.
 */

jest.mock("../../../Server/Utils/Logger");

type TokenSigningKeyClass =
  typeof import("../../../Server/Utils/TokenSigningKey").default;
type JSONWebTokenClass =
  typeof import("../../../Server/Utils/JsonWebToken").default;

interface Installation {
  TokenSigningKey: TokenSigningKeyClass;
  JSONWebToken: JSONWebTokenClass;
  // The value the server signed every token with before this change.
  encryptionSecret: string;
  insecureValues: Array<string>;
  insecurePrefix: string;
}

const HEX_KEY: RegExp = /^[0-9a-f]{64}$/;

const SESSION_CLAIMS: Record<string, unknown> = {
  userId: "11111111-1111-4111-8111-111111111111",
  email: "admin@example.com",
  name: "Admin",
  isMasterAdmin: true,
  isGlobalLogin: true,
  sessionId: "22222222-2222-4222-8222-222222222222",
};

async function installation(
  encryptionSecret: string | undefined,
): Promise<Installation> {
  setEncryptionSecret(encryptionSecret);
  jest.resetModules();

  const config: {
    EncryptionSecret: { toString: () => string };
    InsecureEncryptionSecretValues: Array<string>;
    InsecureEncryptionSecretPrefix: string;
  } = await import("../../../Server/EnvironmentConfig");

  return {
    TokenSigningKey: (await import("../../../Server/Utils/TokenSigningKey"))
      .default,
    JSONWebToken: (await import("../../../Server/Utils/JsonWebToken")).default,
    encryptionSecret: config.EncryptionSecret.toString(),
    insecureValues: config.InsecureEncryptionSecretValues,
    insecurePrefix: config.InsecureEncryptionSecretPrefix,
  };
}

function signSession(key: string): string {
  return jwt.sign(SESSION_CLAIMS, key, { expiresIn: 15 * 60 });
}

function verifies(server: Installation, token: string): boolean {
  try {
    server.JSONWebToken.decode(token);
    return true;
  } catch {
    return false;
  }
}

function derived(key: string, label: string): string {
  return crypto.createHmac("sha256", key).update(label).digest("hex");
}

afterEach(() => {
  restoreEncryptionSecret();
  jest.resetModules();
});

describe("an installation whose operator set ENCRYPTION_SECRET", () => {
  test("signs with exactly that secret", async () => {
    const server: Installation = await installation(OPERATOR_ENCRYPTION_SECRET);

    expect(server.TokenSigningKey.isEncryptionSecretUsed()).toBe(true);
    expect(server.TokenSigningKey.get()).toBe(OPERATOR_ENCRYPTION_SECRET);
  });

  test("still accepts a session it signed before the upgrade, so nobody is signed out", async () => {
    const server: Installation = await installation(OPERATOR_ENCRYPTION_SECRET);

    const issuedBeforeTheUpgrade: string = signSession(
      OPERATOR_ENCRYPTION_SECRET,
    );

    expect(
      server.JSONWebToken.decode(issuedBeforeTheUpgrade).isMasterAdmin,
    ).toBe(true);
  });

  test("derives the per-purpose keys exactly as before, so MCP and resend tokens already handed out still verify", async () => {
    const server: Installation = await installation(OPERATOR_ENCRYPTION_SECRET);

    for (const label of [
      "oneuptime:mcp:oauth:authorization-request:v1",
      "oneuptime:mcp:oauth:api-delegation-token:v1",
      "oneuptime:identity:verification-email-resend-token:v1",
    ]) {
      expect(server.TokenSigningKey.deriveKey(label).toString("hex")).toBe(
        derived(OPERATOR_ENCRYPTION_SECRET, label),
      );
    }
  });

  test("keeps signing with the operator's secret even if an installation key is offered", async () => {
    const server: Installation = await installation(OPERATOR_ENCRYPTION_SECRET);

    server.TokenSigningKey.useInstallationKey(
      server.TokenSigningKey.generateInstallationKey(),
    );

    expect(server.TokenSigningKey.get()).toBe(OPERATOR_ENCRYPTION_SECRET);
  });

  test("refuses a token signed with a value this repository ships", async () => {
    const server: Installation = await installation(OPERATOR_ENCRYPTION_SECRET);

    for (const shipped of server.insecureValues) {
      expect({ shipped, verifies: verifies(server, signSession(shipped)) }).toEqual(
        { shipped, verifies: false },
      );
    }
  });
});

describe.each(SHIPPED_ENCRYPTION_SECRETS)(
  "an installation whose ENCRYPTION_SECRET is $label",
  ({ value }: ShippedEncryptionSecret) => {
    test("does not sign with ENCRYPTION_SECRET", async () => {
      const server: Installation = await installation(value);

      expect(server.TokenSigningKey.isEncryptionSecretUsed()).toBe(false);
    });

    test("signs with a 256-bit key that is no value the repository ships", async () => {
      const server: Installation = await installation(value);
      const key: string = server.TokenSigningKey.get();

      expect(key).toMatch(HEX_KEY);
      expect(key).not.toBe(server.encryptionSecret);
      expect(key).not.toBe(server.encryptionSecret.trim());
      expect(key).not.toBe(value);
      expect(server.insecureValues).not.toContain(key);
      expect(key.startsWith(server.insecurePrefix)).toBe(false);
    });

    test("keeps signing with the same key for as long as the process runs", async () => {
      const server: Installation = await installation(value);
      const first: string = server.TokenSigningKey.get();

      for (let call: number = 0; call < 5; call++) {
        expect(server.TokenSigningKey.get()).toBe(first);
      }
    });

    test("refuses a session signed with the value it is configured with", async () => {
      const server: Installation = await installation(value);

      // As the server read it, and as an operator would read it.
      const configured: Array<string> = [
        server.encryptionSecret,
        server.encryptionSecret.trim(),
      ].filter((key: string) => {
        return key.length > 0;
      });

      expect(configured.length).toBeGreaterThan(0);

      for (const key of configured) {
        expect({ key, verifies: verifies(server, signSession(key)) }).toEqual({
          key,
          verifies: false,
        });
      }
    });

    test("refuses a session signed with any value this repository ships", async () => {
      const server: Installation = await installation(value);

      for (const shipped of server.insecureValues) {
        expect({
          shipped,
          verifies: verifies(server, signSession(shipped)),
        }).toEqual({ shipped, verifies: false });
      }
    });

    test("still accepts the sessions it signs itself", async () => {
      const server: Installation = await installation(value);

      const token: string = server.JSONWebToken.signJsonPayload(
        SESSION_CLAIMS as JSONObject,
        15 * 60,
      );

      expect(server.JSONWebToken.decode(token).isMasterAdmin).toBe(true);
    });

    test("derives no per-purpose key from the configured value", async () => {
      const server: Installation = await installation(value);
      const label: string = "oneuptime:mcp:oauth:api-delegation-token:v1";

      expect(server.TokenSigningKey.deriveKey(label).toString("hex")).not.toBe(
        derived(server.encryptionSecret, label),
      );
      expect(server.TokenSigningKey.deriveKey(label).toString("hex")).toBe(
        derived(server.TokenSigningKey.get(), label),
      );
    });

    test("signs with the installation's key once it is loaded", async () => {
      const server: Installation = await installation(value);
      const installationKey: string =
        server.TokenSigningKey.generateInstallationKey();

      const signedBeforeLoading: string = server.JSONWebToken.signJsonPayload(
        { userId: "u", email: "a@example.com" },
        60,
      );

      server.TokenSigningKey.useInstallationKey(installationKey);

      expect(server.TokenSigningKey.isInstallationKeyLoaded()).toBe(true);
      expect(server.TokenSigningKey.get()).toBe(installationKey);
      expect(verifies(server, signSession(installationKey))).toBe(true);
      // The process's own key was a stand-in: nothing it signed outlives it.
      expect(verifies(server, signedBeforeLoading)).toBe(false);
    });
  },
);

describe("processes of an installation whose ENCRYPTION_SECRET is shipped", () => {
  test("sign with keys of their own until they load the installation's, so nothing one signs verifies in another", async () => {
    const first: Installation = await installation(
      "please-change-this-to-random-value",
    );
    const second: Installation = await installation(
      "please-change-this-to-random-value",
    );

    expect(first.TokenSigningKey.get()).not.toBe(second.TokenSigningKey.get());

    const token: string = first.JSONWebToken.signJsonPayload(
      { userId: "u", email: "a@example.com" },
      60,
    );

    expect(verifies(first, token)).toBe(true);
    expect(verifies(second, token)).toBe(false);
  });

  test("accept each other's tokens once they have loaded the same installation key", async () => {
    const first: Installation = await installation(
      "please-change-this-to-random-value",
    );
    const second: Installation = await installation(
      "please-change-this-to-random-value",
    );
    const installationKey: string =
      first.TokenSigningKey.generateInstallationKey();

    first.TokenSigningKey.useInstallationKey(installationKey);
    second.TokenSigningKey.useInstallationKey(installationKey);

    const fromFirst: string = first.JSONWebToken.signJsonPayload(
      { userId: "u", email: "a@example.com" },
      60,
    );
    const fromSecond: string = second.JSONWebToken.signJsonPayload(
      { userId: "u", email: "a@example.com" },
      60,
    );

    expect(verifies(second, fromFirst)).toBe(true);
    expect(verifies(first, fromSecond)).toBe(true);
  });
});

describe("the installation's key", () => {
  const MALFORMED: Array<[string, unknown]> = [
    ["an empty string", ""],
    ["the code's fallback", "secret"],
    ["the shipped placeholder", "please-change-this-to-random-value"],
    ["63 hex characters", "a".repeat(63)],
    ["65 hex characters", "a".repeat(65)],
    ["upper-case hex", "A".repeat(64)],
    ["64 characters that are not hex", "g".repeat(64)],
    ["hex with a newline after it", `${"a".repeat(64)}\n`],
    ["hex with a space in it", `${"a".repeat(32)} ${"a".repeat(31)}`],
    ["null", null],
    ["undefined", undefined],
    ["a number", 42],
  ];

  test.each(MALFORMED)(
    "is refused when it is %s, and the key in use does not change",
    async (_label: string, malformed: unknown) => {
      const server: Installation = await installation(undefined);
      const before: string = server.TokenSigningKey.get();

      expect(() => {
        server.TokenSigningKey.useInstallationKey(malformed as string);
      }).toThrow("not 64 hexadecimal characters");

      expect(server.TokenSigningKey.isInstallationKeyLoaded()).toBe(false);
      expect(server.TokenSigningKey.get()).toBe(before);
      expect(
        server.TokenSigningKey.isWellFormedInstallationKey(malformed),
      ).toBe(false);
    },
  );

  test("is generated as 256 bits from the CSPRNG, and never twice the same", async () => {
    const server: Installation = await installation(undefined);
    const keys: Set<string> = new Set();

    for (let index: number = 0; index < 200; index++) {
      const key: string = server.TokenSigningKey.generateInstallationKey();

      expect(key).toMatch(HEX_KEY);
      expect(server.TokenSigningKey.isWellFormedInstallationKey(key)).toBe(
        true,
      );
      keys.add(key);
    }

    expect(keys.size).toBe(200);
  });
});
