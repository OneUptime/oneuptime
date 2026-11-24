import { describe, expect, jest, test } from "@jest/globals";
import crypto from "crypto";
import { EncryptionSecret } from "../../../../Server/EnvironmentConfig";
import ScrubHashToken from "../../../../Server/Utils/Telemetry/ScrubHashToken";
import ObjectID from "../../../../Types/ObjectID";
import {
  isScrubHashToken,
  LEGACY_SCRUB_HASH_TOKEN_PATTERN,
  SCRUB_HASH_TOKEN_HEX_LENGTH,
  SCRUB_HASH_TOKEN_PATTERN,
} from "../../../../Types/Telemetry/ScrubHashTokenFormat";

/*
 * ---------------------------------------------------------------------------
 * A HASH SCRUB RULE'S TOKEN IS KEYED PER PROJECT, AND NO ONE CAN WORK IT
 * BACK TO THE VALUE (#10394).
 *
 * The token used to be the first 8 hex characters of an unkeyed SHA-256:
 * anyone reading telemetry could hash every IPv4 address (or SSN, or phone
 * number) and look the token up, the same value hashed alike in every
 * project and install, and 32 bits shared a token among a few tens of
 * thousands of values. These tests hold the new token to what the issue
 * asks: the same in a project, different across projects and installs, 16
 * hex characters that are no prefix of the unkeyed SHA-256, a known vector
 * under a fixed secret - and they try to reverse it, and to collide it, the
 * way the old one could be.
 * ---------------------------------------------------------------------------
 */

type ScrubHashTokenClass = typeof ScrubHashToken;

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-0000000d5001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-0000000d5002",
);

// The secret the known vectors below were made with, and no install's.
const KNOWN_VECTOR_SECRET: string = "scrub-hash-known-vector-secret";

// The secrets that ship with OneUptime (EnvironmentConfig), as public as the source.
const PUBLIC_SECRETS: Array<string> = [
  "secret",
  "please-change-this-to-random-value",
];

// The old token's hex: the first 8 characters of an unkeyed SHA-256.
function oldHex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 8);
}

// The new token's hex, as an attacker would make it with a key it guesses.
function hexWithKey(
  secret: string,
  projectId: ObjectID,
  value: string,
): string {
  const key: Buffer = crypto
    .createHmac("sha256", secret)
    .update(`oneuptime-telemetry-scrub-hash:${projectId.toString()}`)
    .digest();

  return crypto
    .createHmac("sha256", key)
    .update(value)
    .digest("hex")
    .slice(0, SCRUB_HASH_TOKEN_HEX_LENGTH);
}

function hexOf(token: string): string {
  return token.slice("[HASHED:".length, -1);
}

// Loads a private copy of the module that hashes with another secret.
function loadWithEncryptionSecret(secret: string): ScrubHashTokenClass {
  let loaded: ScrubHashTokenClass | null = null;

  jest.isolateModules((): void => {
    jest.doMock("../../../../Server/EnvironmentConfig", (): unknown => {
      return {
        ...(jest.requireActual(
          "../../../../Server/EnvironmentConfig",
        ) as Record<string, unknown>),
        EncryptionSecret: new ObjectID(secret),
      };
    });

    loaded = (
      jest.requireActual(
        "../../../../Server/Utils/Telemetry/ScrubHashToken",
      ) as { default: ScrubHashTokenClass }
    ).default;
  });

  jest.dontMock("../../../../Server/EnvironmentConfig");

  if (!loaded) {
    throw new Error("module did not load");
  }

  return loaded;
}

// Every IPv4 address of a /16, as text: 65,536 of them.
function addressesOf16(first: number, second: number): Array<string> {
  const addresses: Array<string> = [];

  for (let third: number = 0; third < 256; third++) {
    for (let fourth: number = 0; fourth < 256; fourth++) {
      addresses.push(`${first}.${second}.${third}.${fourth}`);
    }
  }

  return addresses;
}

describe("a project's token for a value", () => {
  test("is the same within a project every time", () => {
    const first: string = ScrubHashToken.ofValue({
      projectId: PROJECT_ID,
      value: "ada@example.com",
    });

    expect(
      ScrubHashToken.ofValue({
        projectId: PROJECT_ID,
        value: "ada@example.com",
      }),
    ).toBe(first);
    // However the project's id is handed over.
    expect(
      ScrubHashToken.ofValue({
        projectId: PROJECT_ID.toString().toUpperCase(),
        value: "ada@example.com",
      }),
    ).toBe(first);
  });

  test("is another in another project", () => {
    expect(
      ScrubHashToken.ofValue({ projectId: PROJECT_ID, value: "203.0.113.7" }),
    ).not.toBe(
      ScrubHashToken.ofValue({
        projectId: OTHER_PROJECT_ID,
        value: "203.0.113.7",
      }),
    );
  });

  test("is another in another install: the key is derived from ENCRYPTION_SECRET", () => {
    const sameSecret: ScrubHashTokenClass = loadWithEncryptionSecret(
      EncryptionSecret.toString(),
    );
    const otherSecret: ScrubHashTokenClass = loadWithEncryptionSecret(
      `${EncryptionSecret.toString()}-another-install`,
    );
    const data: { projectId: ObjectID; value: string } = {
      projectId: PROJECT_ID,
      value: "123-45-6789",
    };

    expect(sameSecret.ofValue(data)).toBe(ScrubHashToken.ofValue(data));
    expect(otherSecret.ofValue(data)).toMatch(SCRUB_HASH_TOKEN_PATTERN);
    expect(otherSecret.ofValue(data)).not.toBe(ScrubHashToken.ofValue(data));
  });

  test("is '[HASHED:' and 16 lowercase hex characters, a value no shorter than before", () => {
    for (const value of [
      "",
      "a",
      "ada@example.com",
      "8.8.8.8",
      "x".repeat(10_000),
    ]) {
      const token: string = ScrubHashToken.ofValue({
        projectId: PROJECT_ID,
        value: value,
      });

      expect(token).toMatch(/^\[HASHED:[0-9a-f]{16}\]$/);
      expect(token).toHaveLength(25);
      expect(isScrubHashToken(token)).toBe(true);
    }
  });

  test("is no prefix of the value's unkeyed SHA-256, nor holds its old token", () => {
    for (const value of [
      "8.8.8.8",
      "123-45-6789",
      "555-123-4567",
      "ada@example.com",
    ]) {
      const hex: string = hexOf(
        ScrubHashToken.ofValue({ projectId: PROJECT_ID, value: value }),
      );
      const unkeyed: string = crypto
        .createHash("sha256")
        .update(value)
        .digest("hex");

      expect(unkeyed.startsWith(hex)).toBe(false);
      expect(hex).not.toContain(oldHex(value));
    }
  });

  test("is never sixteen digits, a card number's shape, and reads on along the HMAC when it would be", () => {
    const known: ScrubHashTokenClass =
      loadWithEncryptionSecret(KNOWN_VECTOR_SECRET);

    /*
     * Under the known vector's secret, the HMAC of "value-956" starts with
     * 0190102306841297: the token is its next 16 hex characters.
     */
    expect(known.ofValue({ projectId: PROJECT_ID, value: "value-956" })).toBe(
      "[HASHED:1d9eeeda7a795f44]",
    );

    for (let index: number = 0; index < 5000; index++) {
      expect(
        hexOf(
          ScrubHashToken.ofValue({
            projectId: PROJECT_ID,
            value: `value-${index}`,
          }),
        ),
      ).toMatch(/[a-f]/);
    }
  });

  test("is made for a project: no project is no key", () => {
    expect(() => {
      return ScrubHashToken.ofValue({ projectId: "", value: "8.8.8.8" });
    }).toThrow();
    expect(() => {
      return ScrubHashToken.ofValue({ projectId: "  ", value: "8.8.8.8" });
    }).toThrow();
  });
});

describe("a known vector", () => {
  /*
   * Made with KNOWN_VECTOR_SECRET, the derivation the module's header writes
   * out: a change to how the key is derived, or to how much of the HMAC is
   * kept, changes these, and every token a project has stored.
   */
  test("under a fixed secret, an address and an email make the tokens they always made", () => {
    const known: ScrubHashTokenClass =
      loadWithEncryptionSecret(KNOWN_VECTOR_SECRET);

    expect(known.ofValue({ projectId: PROJECT_ID, value: "203.0.113.7" })).toBe(
      "[HASHED:01580765cb52614a]",
    );
    expect(
      known.ofValue({ projectId: PROJECT_ID, value: "jane@example.com" }),
    ).toBe("[HASHED:5e29db14e508e09a]");
  });

  test("is the derivation written out: an HMAC of the value under an HMAC of the project's id", () => {
    const known: ScrubHashTokenClass =
      loadWithEncryptionSecret(KNOWN_VECTOR_SECRET);

    expect(
      hexOf(known.ofValue({ projectId: PROJECT_ID, value: "203.0.113.7" })),
    ).toBe(hexWithKey(KNOWN_VECTOR_SECRET, PROJECT_ID, "203.0.113.7"));
  });
});

describe("an IP address's token", () => {
  test.each([
    ["::ffff:203.0.113.7", "203.0.113.7"],
    ["::FFFF:cb00:7107", "203.0.113.7"],
    ["0:0:0:0:0:ffff:cb00:7107", "203.0.113.7"],
    ["2001:DB8::1", "2001:db8::1"],
    ["2001:0db8:0:0:0:0:0:0001", "2001:db8::1"],
  ])(
    "%s makes the token %s makes: one address, one token",
    (spelling: string, address: string) => {
      expect(
        ScrubHashToken.ofIpAddress({
          projectId: PROJECT_ID,
          address: spelling,
        }),
      ).toBe(ScrubHashToken.ofIpAddress({ projectId: PROJECT_ID, address }));
      expect(
        ScrubHashToken.ofIpAddress({ projectId: PROJECT_ID, address }),
      ).toBe(ScrubHashToken.ofValue({ projectId: PROJECT_ID, value: address }));
    },
  );

  test("of two addresses are two tokens", () => {
    expect(
      ScrubHashToken.ofIpAddress({ projectId: PROJECT_ID, address: "8.8.8.8" }),
    ).not.toBe(
      ScrubHashToken.ofIpAddress({ projectId: PROJECT_ID, address: "8.8.4.4" }),
    );
  });
});

describe("working a token back to its address", () => {
  /*
   * The attack the issue describes, on a /16 so the test runs in a moment:
   * hash every candidate address and look the token up. Every IPv4 address
   * there is is 65,536 times this, which a laptop hashes in minutes.
   */
  const TARGET: string = "203.0.113.7";
  const CANDIDATES: Array<string> = addressesOf16(203, 0);

  // An install's own secret, as Home/Scripts/Install.sh and the Helm chart make one.
  const INSTALL_SECRET: string = "4d1f7c2e-9b8a-4e6f-a1c3-5e7d9b2f0a64";

  // Who among the candidates has the stolen token, for a way of hashing them.
  function recover(
    stolen: string,
    hash: (candidate: string) => string,
  ): Array<string> {
    return CANDIDATES.filter((candidate: string): boolean => {
      return hash(candidate) === stolen;
    });
  }

  test("worked for the old token: hashing every address finds it", () => {
    expect(recover(oldHex(TARGET), oldHex)).toEqual([TARGET]);
  });

  test("finds nothing for the new token: not unkeyed, not with the secrets that ship, not from another project's tokens", () => {
    const install: ScrubHashTokenClass =
      loadWithEncryptionSecret(INSTALL_SECRET);
    const stolen: string = hexOf(
      install.ofIpAddress({ projectId: PROJECT_ID, address: TARGET }),
    );

    // The unkeyed SHA-256, cut to the token's length.
    expect(
      recover(stolen, (candidate: string): string => {
        return crypto
          .createHash("sha256")
          .update(candidate)
          .digest("hex")
          .slice(0, SCRUB_HASH_TOKEN_HEX_LENGTH);
      }),
    ).toEqual([]);

    // The derivation guessed with every secret that ships with OneUptime.
    for (const secret of PUBLIC_SECRETS) {
      expect(
        recover(stolen, (candidate: string): string => {
          return hexWithKey(secret, PROJECT_ID, candidate);
        }),
      ).toEqual([]);
    }

    // Another project's tokens of every address, which its members can read.
    expect(
      recover(stolen, (candidate: string): string => {
        return hexOf(
          install.ofIpAddress({
            projectId: OTHER_PROJECT_ID,
            address: candidate,
          }),
        );
      }),
    ).toEqual([]);
  });

  test("the install itself can, as Security Events' address vault will: it holds the key", () => {
    const install: ScrubHashTokenClass =
      loadWithEncryptionSecret(INSTALL_SECRET);
    const stolen: string = install.ofIpAddress({
      projectId: PROJECT_ID,
      address: TARGET,
    });

    expect(
      recover(stolen, (candidate: string): string => {
        return install.ofIpAddress({
          projectId: PROJECT_ID,
          address: candidate,
        });
      }),
    ).toEqual([TARGET]);
  });

  /*
   * The token is only as secret as ENCRYPTION_SECRET. An install still on a
   * secret that ships with OneUptime - which the server warns about at start
   * (EnvironmentConfig's EncryptionSecretWarning) - has a key anyone can
   * derive for a project whose id they know.
   */
  test("an install still on a secret that ships with OneUptime is no better off than before", () => {
    const shipped: ScrubHashTokenClass = loadWithEncryptionSecret(
      PUBLIC_SECRETS[1]!,
    );
    const stolen: string = hexOf(
      shipped.ofIpAddress({ projectId: PROJECT_ID, address: TARGET }),
    );

    expect(
      recover(stolen, (candidate: string): string => {
        return hexWithKey(PUBLIC_SECRETS[1]!, PROJECT_ID, candidate);
      }),
    ).toEqual([TARGET]);
  });
});

describe("two values sharing a token", () => {
  test("happened with the old token: two addresses of one /15 shared one", () => {
    // Found by hashing 198.18.0.0/15 address by address: 32 bits run out.
    expect(oldHex("198.18.242.0")).toBe("6f984f05");
    expect(oldHex("198.19.130.8")).toBe("6f984f05");

    expect(
      ScrubHashToken.ofIpAddress({
        projectId: PROJECT_ID,
        address: "198.18.242.0",
      }),
    ).not.toBe(
      ScrubHashToken.ofIpAddress({
        projectId: PROJECT_ID,
        address: "198.19.130.8",
      }),
    );
  });

  test("does not happen among the 131,072 addresses of a /15", () => {
    const tokens: Set<string> = new Set<string>();
    const addresses: Array<string> = [
      ...addressesOf16(198, 18),
      ...addressesOf16(198, 19),
    ];

    for (const address of addresses) {
      tokens.add(
        ScrubHashToken.ofIpAddress({ projectId: PROJECT_ID, address: address }),
      );
    }

    expect(tokens.size).toBe(addresses.length);
  });
});

describe("the format the code that reads a token knows it by", () => {
  test("is the new token and the old one, whole, and nothing else", () => {
    expect(isScrubHashToken("[HASHED:01580765cb52614a]")).toBe(true);
    expect(isScrubHashToken("[HASHED:8c87b489]")).toBe(true);
    expect(LEGACY_SCRUB_HASH_TOKEN_PATTERN.test("[HASHED:8c87b489]")).toBe(
      true,
    );
    expect(SCRUB_HASH_TOKEN_PATTERN.test("[HASHED:8c87b489]")).toBe(false);

    for (const text of [
      "[HASHED:01580765CB52614A]",
      "[HASHED:01580765cb52614]",
      "[HASHED:01580765cb52614a0]",
      "from [HASHED:01580765cb52614a]",
      "[HASHED:not-hex]",
      "[REDACTED]",
      "",
    ]) {
      expect({ text, token: isScrubHashToken(text) }).toEqual({
        text,
        token: false,
      });
    }
  });
});
