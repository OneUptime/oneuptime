import McpOAuthSignedToken, {
  McpOAuthSignedTokenPurpose,
} from "../../../../Server/Utils/Mcp/McpOAuthSignedToken";
import { EncryptionSecret } from "../../../../Server/EnvironmentConfig";
import JSONWebToken from "../../../../Server/Utils/JsonWebToken";
import Email from "../../../../Types/Email";
import { JSONObject } from "../../../../Types/JSON";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * JSONWebToken.decode logs every token it refuses; several tests below hand it
 * one on purpose.
 */
jest.mock("../../../../Server/Utils/Logger");

/*
 * The signed tokens the MCP authorization server passes to itself: the
 * authorization-request ticket that rides through the browser, and the
 * delegation token the MCP server presents to the API.
 *
 * Both NAME A USER. So the properties that matter are the ones that keep such
 * a token from being worth more than it was minted for:
 *
 *   - nobody without EncryptionSecret can make or alter one;
 *   - a token minted for one purpose is not accepted as another;
 *   - it is never a JWT, in either direction - JSONWebToken.decode accepts
 *     any JWT signed with EncryptionSecret that carries a user id and an email
 *     as a full dashboard session;
 *   - it stops working when it says it does;
 *   - verify() answers null for everything else, and never throws.
 */

type SignedTokenClass =
  typeof import("../../../../Server/Utils/Mcp/McpOAuthSignedToken").default;

const PURPOSE_A: McpOAuthSignedTokenPurpose = {
  keyDerivationLabel: "test:signed-token:purpose-a",
  maxLength: 4096,
};

const PURPOSE_B: McpOAuthSignedTokenPurpose = {
  keyDerivationLabel: "test:signed-token:purpose-b",
  maxLength: 4096,
};

// The two labels the feature actually uses.
const TICKET_PURPOSE: McpOAuthSignedTokenPurpose = {
  keyDerivationLabel: "oneuptime:mcp:oauth:authorization-request:v1",
  maxLength: 6000,
};

const DELEGATION_PURPOSE: McpOAuthSignedTokenPurpose = {
  keyDerivationLabel: "oneuptime:mcp:oauth:api-delegation-token:v1",
  maxLength: 4096,
};

const ALL_PURPOSES: Array<McpOAuthSignedTokenPurpose> = [
  PURPOSE_A,
  PURPOSE_B,
  TICKET_PURPOSE,
  DELEGATION_PURPOSE,
];

const TOKEN_PATTERN: RegExp = /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/;

const NOW: Date = new Date("2026-10-01T12:00:00.000Z");
const ONE_MINUTE_MS: number = 60 * 1000;
const FIVE_MINUTES_MS: number = 5 * ONE_MINUTE_MS;

const CLAIMS: JSONObject = {
  userId: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
  email: "member@example.com",
  note: "hello",
};

function at(offsetMs: number): Date {
  return new Date(NOW.getTime() + offsetMs);
}

function signOrFail(
  purpose: McpOAuthSignedTokenPurpose,
  claims: JSONObject = CLAIMS,
  expiresInSeconds: number = 60,
  now: Date = NOW,
): string {
  const token: string | null = McpOAuthSignedToken.sign({
    purpose,
    claims,
    expiresInSeconds,
    now,
  });

  if (!token) {
    throw new Error("expected a token to be minted");
  }

  return token;
}

/*
 * The signature the implementation is expected to compute, written out
 * independently: an HMAC key derived from EncryptionSecret under the
 * purpose's label, then an HMAC of "v1.<payload>" with that key.
 */
function expectedSignature(
  purpose: McpOAuthSignedTokenPurpose,
  payloadB64: string,
  secret: string = EncryptionSecret.toString(),
): string {
  const key: Buffer = crypto
    .createHmac("sha256", secret)
    .update(purpose.keyDerivationLabel)
    .digest();

  return crypto
    .createHmac("sha256", key)
    .update(`v1.${payloadB64}`)
    .digest("base64url");
}

// A correctly signed token around ANY payload text: what a forger with the key could build.
function forgeRaw(
  purpose: McpOAuthSignedTokenPurpose,
  payloadText: string,
): string {
  const payloadB64: string = Buffer.from(payloadText, "utf8").toString(
    "base64url",
  );

  return `v1.${payloadB64}.${expectedSignature(purpose, payloadB64)}`;
}

function forge(purpose: McpOAuthSignedTokenPurpose, envelope: unknown): string {
  return forgeRaw(purpose, JSON.stringify(envelope));
}

function validEnvelope(overrides: Record<string, unknown> = {}): JSONObject {
  return {
    v: 1,
    c: { note: "hello" },
    i: NOW.getTime(),
    x: NOW.getTime() + ONE_MINUTE_MS,
    ...overrides,
  } as JSONObject;
}

function verifyAt(
  purpose: McpOAuthSignedTokenPurpose,
  token: unknown,
  now: Date = NOW,
): JSONObject | null {
  return McpOAuthSignedToken.verify({ purpose, token, now });
}

function payloadOf(token: string): JSONObject {
  return JSON.parse(
    Buffer.from(token.split(".")[1] as string, "base64url").toString("utf8"),
  ) as JSONObject;
}

// Loads a private copy of the module that signs with a different secret.
function loadWithEncryptionSecret(secret: string): SignedTokenClass {
  let loaded: SignedTokenClass | null = null;

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
        "../../../../Server/Utils/Mcp/McpOAuthSignedToken",
      ) as {
        default: SignedTokenClass;
      }
    ).default;
  });

  jest.dontMock("../../../../Server/EnvironmentConfig");

  if (!loaded) {
    throw new Error("module did not load");
  }

  return loaded;
}

describe("McpOAuthSignedToken: round trip and format", () => {
  test("verify returns exactly the claims that were signed", () => {
    const claims: JSONObject = {
      text: "value",
      count: 42,
      flag: true,
      off: false,
      nothing: null,
      nested: { list: [1, "two", { three: 3 }] },
      // Latin-1, a BMP dash, CJK and an astral-plane emoji.
      unicode: `caf\xe9 ${String.fromCodePoint(0x2014, 0x65e5, 0x672c, 0x1f600)}`,
      empty: "",
    };

    const token: string = signOrFail(PURPOSE_A, claims);

    expect(verifyAt(PURPOSE_A, token)).toEqual(claims);
  });

  test("an empty claims object round trips", () => {
    expect(verifyAt(PURPOSE_A, signOrFail(PURPOSE_A, {}))).toEqual({});
  });

  test('is "v1.<base64url payload>.<43 base64url characters>"', () => {
    const token: string = signOrFail(PURPOSE_A);

    expect(token).toMatch(TOKEN_PATTERN);
    expect(token.split(".")).toHaveLength(3);
    expect(token.split(".")[0]).toBe("v1");
    expect(token.split(".")[2]).toHaveLength(43);
    expect(token).not.toContain("=");
    expect(token).not.toContain("+");
    expect(token).not.toContain("/");
  });

  test("the payload is readable JSON carrying version, claims, issue time and expiry", () => {
    const token: string = signOrFail(PURPOSE_A, CLAIMS, 90);

    expect(payloadOf(token)).toEqual({
      v: 1,
      c: CLAIMS,
      i: NOW.getTime(),
      x: NOW.getTime() + 90 * 1000,
    });
  });

  test("the signature is HMAC-SHA256 under a key DERIVED from EncryptionSecret and the purpose label", () => {
    const token: string = signOrFail(PURPOSE_A);
    const [, payloadB64, signature] = token.split(".") as [
      string,
      string,
      string,
    ];

    expect(signature).toBe(expectedSignature(PURPOSE_A, payloadB64));
  });

  test("a token signed with EncryptionSecret itself as the key (no derivation) does not verify", () => {
    /*
     * The derivation is what separates these tokens from everything else
     * EncryptionSecret signs. A token MACed with the raw secret must be a
     * forgery, whatever purpose it is presented under.
     */
    const payloadB64: string = signOrFail(PURPOSE_A).split(".")[1] as string;
    const rawKeySignature: string = crypto
      .createHmac("sha256", EncryptionSecret.toString())
      .update(`v1.${payloadB64}`)
      .digest("base64url");

    for (const purpose of ALL_PURPOSES) {
      expect(
        verifyAt(purpose, `v1.${payloadB64}.${rawKeySignature}`),
      ).toBeNull();
    }
  });

  test("uses the current time when none is given", () => {
    const token: string | null = McpOAuthSignedToken.sign({
      purpose: PURPOSE_A,
      claims: CLAIMS,
      expiresInSeconds: 60,
    });

    expect(token).not.toBeNull();
    expect(McpOAuthSignedToken.verify({ purpose: PURPOSE_A, token })).toEqual(
      CLAIMS,
    );

    const issuedAt: number = payloadOf(token as string)["i"] as number;

    expect(Math.abs(issuedAt - Date.now())).toBeLessThan(ONE_MINUTE_MS);
  });

  test("two tokens for the same claims at different times differ", () => {
    expect(signOrFail(PURPOSE_A, CLAIMS, 60, at(0))).not.toBe(
      signOrFail(PURPOSE_A, CLAIMS, 60, at(1)),
    );
  });
});

describe("McpOAuthSignedToken: tampering", () => {
  test("changing any character of the payload is refused", () => {
    const token: string = signOrFail(PURPOSE_A);
    const [version, payloadB64, signature] = token.split(".") as [
      string,
      string,
      string,
    ];

    for (const index of [
      0,
      Math.floor(payloadB64.length / 2),
      payloadB64.length - 1,
    ]) {
      const original: string = payloadB64[index] as string;
      const replacement: string = original === "A" ? "B" : "A";
      const tampered: string = `${payloadB64.slice(0, index)}${replacement}${payloadB64.slice(index + 1)}`;

      expect(
        verifyAt(PURPOSE_A, `${version}.${tampered}.${signature}`),
      ).toBeNull();
    }
  });

  test("rewriting a claim and keeping the old signature is refused", () => {
    const token: string = signOrFail(PURPOSE_A, { role: "member" });
    const envelope: JSONObject = payloadOf(token);

    (envelope["c"] as JSONObject)["role"] = "owner";

    const rewritten: string = Buffer.from(
      JSON.stringify(envelope),
      "utf8",
    ).toString("base64url");

    expect(
      verifyAt(PURPOSE_A, `v1.${rewritten}.${token.split(".")[2] as string}`),
    ).toBeNull();
  });

  test("pushing the expiry out and keeping the old signature is refused", () => {
    const token: string = signOrFail(PURPOSE_A);
    const envelope: JSONObject = payloadOf(token);

    envelope["x"] = (envelope["x"] as number) + 24 * 60 * ONE_MINUTE_MS;

    const rewritten: string = Buffer.from(
      JSON.stringify(envelope),
      "utf8",
    ).toString("base64url");

    expect(
      verifyAt(PURPOSE_A, `v1.${rewritten}.${token.split(".")[2] as string}`),
    ).toBeNull();
  });

  test("changing any character of the signature is refused", () => {
    const token: string = signOrFail(PURPOSE_A);
    const [version, payloadB64, signature] = token.split(".") as [
      string,
      string,
      string,
    ];

    for (const index of [0, 21, 42]) {
      const original: string = signature[index] as string;
      const replacement: string = original === "A" ? "B" : "A";
      const tampered: string = `${signature.slice(0, index)}${replacement}${signature.slice(index + 1)}`;

      expect(
        verifyAt(PURPOSE_A, `${version}.${payloadB64}.${tampered}`),
      ).toBeNull();
    }
  });

  test("a signature of the wrong length is refused", () => {
    const token: string = signOrFail(PURPOSE_A);
    const [, payloadB64, signature] = token.split(".") as [
      string,
      string,
      string,
    ];

    expect(
      verifyAt(PURPOSE_A, `v1.${payloadB64}.${signature.slice(1)}`),
    ).toBeNull();
    expect(verifyAt(PURPOSE_A, `v1.${payloadB64}.${signature}A`)).toBeNull();
    expect(verifyAt(PURPOSE_A, `v1.${payloadB64}.`)).toBeNull();
    expect(verifyAt(PURPOSE_A, `v1.${payloadB64}`)).toBeNull();
  });

  test("any other version prefix is refused, even with everything else intact", () => {
    const token: string = signOrFail(PURPOSE_A);
    const rest: string = token.slice("v1".length);

    for (const prefix of ["v2", "V1", "v01", "v", "1", "", "v1.v1"]) {
      expect(verifyAt(PURPOSE_A, `${prefix}${rest}`)).toBeNull();
    }
  });

  test("the payload of one valid token under the signature of another is refused, both ways", () => {
    const first: string = signOrFail(PURPOSE_A, { who: "first" });
    const second: string = signOrFail(PURPOSE_A, { who: "second" });

    const [, firstPayload, firstSignature] = first.split(".") as [
      string,
      string,
      string,
    ];
    const [, secondPayload, secondSignature] = second.split(".") as [
      string,
      string,
      string,
    ];

    expect(
      verifyAt(PURPOSE_A, `v1.${firstPayload}.${secondSignature}`),
    ).toBeNull();
    expect(
      verifyAt(PURPOSE_A, `v1.${secondPayload}.${firstSignature}`),
    ).toBeNull();

    // The originals are untouched by the attempt.
    expect(verifyAt(PURPOSE_A, first)).toEqual({ who: "first" });
    expect(verifyAt(PURPOSE_A, second)).toEqual({ who: "second" });
  });

  test("anything around a valid token is refused", () => {
    const token: string = signOrFail(PURPOSE_A);

    for (const wrapped of [
      ` ${token}`,
      `${token} `,
      `${token}\n`,
      `\n${token}`,
      `Bearer ${token}`,
      `${token}.extra`,
      `${token}.`,
      `.${token}`,
      `${token}=`,
      `${token}${token}`,
    ]) {
      expect(verifyAt(PURPOSE_A, wrapped)).toBeNull();
    }
  });
});

describe("McpOAuthSignedToken: lifetime", () => {
  test("is valid until the millisecond before it expires, and not at the millisecond it does", () => {
    const token: string = signOrFail(PURPOSE_A, CLAIMS, 60);

    expect(verifyAt(PURPOSE_A, token, at(0))).toEqual(CLAIMS);
    expect(verifyAt(PURPOSE_A, token, at(ONE_MINUTE_MS - 1))).toEqual(CLAIMS);
    expect(verifyAt(PURPOSE_A, token, at(ONE_MINUTE_MS))).toBeNull();
    expect(verifyAt(PURPOSE_A, token, at(ONE_MINUTE_MS + 1))).toBeNull();
    expect(verifyAt(PURPOSE_A, token, at(24 * 60 * ONE_MINUTE_MS))).toBeNull();
  });

  test("expiresInSeconds is in seconds", () => {
    const token: string = signOrFail(PURPOSE_A, CLAIMS, 600);

    expect(verifyAt(PURPOSE_A, token, at(600 * 1000 - 1))).toEqual(CLAIMS);
    expect(verifyAt(PURPOSE_A, token, at(600 * 1000))).toBeNull();
  });

  test("a token issued up to five minutes in the future is accepted (clock skew between pods)", () => {
    const token: string = signOrFail(PURPOSE_A, CLAIMS, 3600);

    expect(verifyAt(PURPOSE_A, token, at(-1))).toEqual(CLAIMS);
    expect(verifyAt(PURPOSE_A, token, at(-FIVE_MINUTES_MS))).toEqual(CLAIMS);
  });

  test("a token issued more than five minutes in the future is refused", () => {
    const token: string = signOrFail(PURPOSE_A, CLAIMS, 3600);

    expect(verifyAt(PURPOSE_A, token, at(-FIVE_MINUTES_MS - 1))).toBeNull();
    expect(verifyAt(PURPOSE_A, token, at(-60 * ONE_MINUTE_MS))).toBeNull();
  });

  test("sign refuses to mint a token that is already expired", () => {
    for (const expiresInSeconds of [0, -1, -3600]) {
      expect(
        McpOAuthSignedToken.sign({
          purpose: PURPOSE_A,
          claims: CLAIMS,
          expiresInSeconds,
          now: NOW,
        }),
      ).toBeNull();
    }
  });

  test("sign refuses a lifetime that is not a number", () => {
    expect(
      McpOAuthSignedToken.sign({
        purpose: PURPOSE_A,
        claims: CLAIMS,
        expiresInSeconds: Number.NaN,
        now: NOW,
      }),
    ).toBeNull();
    expect(
      McpOAuthSignedToken.sign({
        purpose: PURPOSE_A,
        claims: CLAIMS,
        expiresInSeconds: Number.POSITIVE_INFINITY,
        now: NOW,
      }),
    ).toBeNull();
  });
});

describe("McpOAuthSignedToken: length cap", () => {
  const TIGHT_PURPOSE: McpOAuthSignedTokenPurpose = {
    keyDerivationLabel: PURPOSE_A.keyDerivationLabel,
    maxLength: 200,
  };

  let createHmacSpy: SpyInstance<typeof crypto.createHmac>;

  beforeEach((): void => {
    createHmacSpy = jest.spyOn(crypto, "createHmac");
  });

  afterEach((): void => {
    createHmacSpy.mockRestore();
  });

  test("sign returns null when the token would be longer than the purpose allows", () => {
    expect(
      McpOAuthSignedToken.sign({
        purpose: TIGHT_PURPOSE,
        claims: { state: "x".repeat(500) },
        expiresInSeconds: 60,
        now: NOW,
      }),
    ).toBeNull();
  });

  test("sign still mints a token that fits", () => {
    const token: string | null = McpOAuthSignedToken.sign({
      purpose: TIGHT_PURPOSE,
      claims: { s: "ok" },
      expiresInSeconds: 60,
      now: NOW,
    });

    expect(token).not.toBeNull();
    expect((token as string).length).toBeLessThanOrEqual(200);
  });

  test("the cap is inclusive: exactly maxLength verifies, one over does not", () => {
    const token: string = signOrFail(PURPOSE_A);

    expect(
      verifyAt(
        {
          keyDerivationLabel: PURPOSE_A.keyDerivationLabel,
          maxLength: token.length,
        },
        token,
      ),
    ).toEqual(CLAIMS);

    expect(
      verifyAt(
        {
          keyDerivationLabel: PURPOSE_A.keyDerivationLabel,
          maxLength: token.length - 1,
        },
        token,
      ),
    ).toBeNull();
  });

  test("verify refuses an over-long token before any cryptography runs", () => {
    // Genuinely signed, so only the length can be what refuses it.
    const token: string = signOrFail(PURPOSE_A, { state: "x".repeat(500) });

    expect(verifyAt(PURPOSE_A, token)).not.toBeNull();

    // The spy is live: an ordinary verification does reach the HMAC.
    expect(createHmacSpy).toHaveBeenCalled();

    createHmacSpy.mockClear();

    expect(verifyAt(TIGHT_PURPOSE, token)).toBeNull();
    expect(createHmacSpy).not.toHaveBeenCalled();
  });

  test("verify refuses a malformed token before any cryptography runs", () => {
    createHmacSpy.mockClear();

    expect(verifyAt(PURPOSE_A, "not-a-token")).toBeNull();
    expect(verifyAt(PURPOSE_A, "x".repeat(1024 * 1024))).toBeNull();
    expect(verifyAt(PURPOSE_A, 12345)).toBeNull();
    expect(createHmacSpy).not.toHaveBeenCalled();
  });
});

describe("McpOAuthSignedToken: one purpose, one key", () => {
  test("a token minted for one purpose does not verify as another", () => {
    const token: string = signOrFail(PURPOSE_A);

    expect(verifyAt(PURPOSE_A, token)).toEqual(CLAIMS);
    expect(verifyAt(PURPOSE_B, token)).toBeNull();
  });

  test("an authorization-request ticket is not a delegation token, and the reverse", () => {
    const ticket: string = signOrFail(TICKET_PURPOSE);
    const delegation: string = signOrFail(DELEGATION_PURPOSE);

    expect(verifyAt(TICKET_PURPOSE, ticket)).toEqual(CLAIMS);
    expect(verifyAt(DELEGATION_PURPOSE, delegation)).toEqual(CLAIMS);

    expect(verifyAt(DELEGATION_PURPOSE, ticket)).toBeNull();
    expect(verifyAt(TICKET_PURPOSE, delegation)).toBeNull();
  });

  test("no purpose accepts a token minted for any other", () => {
    for (const mintedFor of ALL_PURPOSES) {
      const token: string = signOrFail(mintedFor);

      for (const presentedAs of ALL_PURPOSES) {
        const accepted: boolean = verifyAt(presentedAs, token) !== null;

        expect({
          mintedFor: mintedFor.keyDerivationLabel,
          presentedAs: presentedAs.keyDerivationLabel,
          accepted,
        }).toEqual({
          mintedFor: mintedFor.keyDerivationLabel,
          presentedAs: presentedAs.keyDerivationLabel,
          accepted: mintedFor === presentedAs,
        });
      }
    }
  });

  test("labels that differ by a single character are different purposes", () => {
    const token: string = signOrFail({
      keyDerivationLabel: "oneuptime:mcp:oauth:api-delegation-token:v1",
      maxLength: 4096,
    });

    for (const label of [
      "oneuptime:mcp:oauth:api-delegation-token:v2",
      "oneuptime:mcp:oauth:api-delegation-token:v1 ",
      "oneuptime:mcp:oauth:api-delegation-token:V1",
      "",
    ]) {
      expect(
        verifyAt({ keyDerivationLabel: label, maxLength: 4096 }, token),
      ).toBeNull();
    }
  });

  test("the key comes from the label alone: maxLength is not part of it", () => {
    const token: string = signOrFail(PURPOSE_A);

    expect(
      verifyAt(
        { keyDerivationLabel: PURPOSE_A.keyDerivationLabel, maxLength: 9999 },
        token,
      ),
    ).toEqual(CLAIMS);
  });
});

describe("McpOAuthSignedToken: a different EncryptionSecret", () => {
  test("a token signed under another instance's secret does not verify here, and the reverse", () => {
    const other: SignedTokenClass = loadWithEncryptionSecret(
      "another-instances-encryption-secret",
    );

    const foreign: string | null = other.sign({
      purpose: PURPOSE_A,
      claims: CLAIMS,
      expiresInSeconds: 60,
      now: NOW,
    });

    expect(foreign).not.toBeNull();

    // It is a good token where it was made...
    expect(
      other.verify({ purpose: PURPOSE_A, token: foreign, now: NOW }),
    ).toEqual(CLAIMS);

    // ...and nothing here.
    expect(verifyAt(PURPOSE_A, foreign)).toBeNull();

    const local: string = signOrFail(PURPOSE_A);

    expect(
      other.verify({ purpose: PURPOSE_A, token: local, now: NOW }),
    ).toBeNull();
    expect(verifyAt(PURPOSE_A, local)).toEqual(CLAIMS);
  });

  test("the same payload gets a different signature under a different secret", () => {
    const payloadB64: string = signOrFail(PURPOSE_A).split(".")[1] as string;

    expect(expectedSignature(PURPOSE_A, payloadB64)).not.toBe(
      expectedSignature(PURPOSE_A, payloadB64, "another-secret"),
    );
  });
});

describe("McpOAuthSignedToken.verify: things that are not tokens", () => {
  const NOT_TOKENS: Array<[string, unknown]> = [
    ["undefined", undefined],
    ["null", null],
    ["an empty string", ""],
    ["a number", 42],
    ["a boolean", true],
    ["an object", { token: "v1.a.b" }],
    ["an array holding a valid token", ["placeholder"]],
    [
      "a function",
      (): string => {
        return "v1.a.b";
      },
    ],
    ["only a version", "v1"],
    ["two segments", "v1.abc"],
    ["empty segments", "v1.."],
    ["an empty payload", `v1..${"A".repeat(43)}`],
    ["characters outside base64url", `v1.a+b/c=.${"A".repeat(43)}`],
    ["whitespace in the payload", `v1.a b.${"A".repeat(43)}`],
    [
      "a random opaque secret",
      "oumcp_at_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
    ],
    ["a UUID", "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e"],
  ];

  test.each(NOT_TOKENS)(
    "%s is null, and does not throw",
    (_label: string, value: unknown) => {
      for (const purpose of ALL_PURPOSES) {
        expect(() => {
          return verifyAt(purpose, value);
        }).not.toThrow();
        expect(verifyAt(purpose, value)).toBeNull();
      }
    },
  );

  test("an array holding a genuinely valid token is still refused", () => {
    expect(verifyAt(PURPOSE_A, [signOrFail(PURPOSE_A)])).toBeNull();
  });

  test("an object whose toString yields a valid token is still refused", () => {
    const token: string = signOrFail(PURPOSE_A);

    expect(
      verifyAt(PURPOSE_A, {
        toString: (): string => {
          return token;
        },
      }),
    ).toBeNull();
  });
});

describe("McpOAuthSignedToken.verify: correctly signed, wrongly shaped", () => {
  /*
   * Everything here carries a GENUINE signature - what somebody holding the
   * key, or a future bug in sign(), could produce. The envelope checks are
   * what stand between such a token and a caller that trusts its claims.
   */

  test("the forging helper is sound: a well-formed forged envelope verifies", () => {
    expect(verifyAt(PURPOSE_A, forge(PURPOSE_A, validEnvelope()))).toEqual({
      note: "hello",
    });
  });

  const BAD_VERSIONS: Array<[string, unknown]> = [
    ["2", 2],
    ["0", 0],
    ['the string "1"', "1"],
    ["true", true],
    ["null", null],
    ["1.5", 1.5],
  ];

  test.each(BAD_VERSIONS)(
    "version %s is refused",
    (_label: string, version: unknown) => {
      expect(
        verifyAt(PURPOSE_A, forge(PURPOSE_A, validEnvelope({ v: version }))),
      ).toBeNull();
    },
  );

  test("a missing version is refused", () => {
    const envelope: JSONObject = validEnvelope();

    delete envelope["v"];

    expect(verifyAt(PURPOSE_A, forge(PURPOSE_A, envelope))).toBeNull();
  });

  const BAD_CLAIMS: Array<[string, unknown]> = [
    ["an array", ["userId", "email"]],
    ["a string", "claims"],
    ["a number", 7],
    ["null", null],
    ["true", true],
  ];

  test.each(BAD_CLAIMS)(
    "claims that are %s are refused",
    (_label: string, claims: unknown) => {
      expect(
        verifyAt(PURPOSE_A, forge(PURPOSE_A, validEnvelope({ c: claims }))),
      ).toBeNull();
    },
  );

  test("missing claims are refused", () => {
    const envelope: JSONObject = validEnvelope();

    delete envelope["c"];

    expect(verifyAt(PURPOSE_A, forge(PURPOSE_A, envelope))).toBeNull();
  });

  const BAD_TIMES: Array<[string, unknown]> = [
    ["a fraction", NOW.getTime() + 0.5],
    ["a numeric string", String(NOW.getTime() + ONE_MINUTE_MS)],
    ["null", null],
    ["true", true],
    ["an object", { ms: NOW.getTime() }],
    ["beyond the safe integer range", Number.MAX_SAFE_INTEGER + 2],
  ];

  test.each(BAD_TIMES)(
    "an issue time that is %s is refused",
    (_label: string, value: unknown) => {
      expect(
        verifyAt(PURPOSE_A, forge(PURPOSE_A, validEnvelope({ i: value }))),
      ).toBeNull();
    },
  );

  test.each(BAD_TIMES)(
    "an expiry that is %s is refused",
    (_label: string, value: unknown) => {
      expect(
        verifyAt(PURPOSE_A, forge(PURPOSE_A, validEnvelope({ x: value }))),
      ).toBeNull();
    },
  );

  test("an expiry or issue time that overflows to Infinity is refused", () => {
    // JSON cannot say Infinity, but 1e400 parses to it.
    const overflowingExpiry: string = `{"v":1,"c":{},"i":${NOW.getTime()},"x":1e400}`;
    const overflowingIssue: string = `{"v":1,"c":{},"i":-1e400,"x":${NOW.getTime() + ONE_MINUTE_MS}}`;

    expect(
      verifyAt(PURPOSE_A, forgeRaw(PURPOSE_A, overflowingExpiry)),
    ).toBeNull();
    expect(
      verifyAt(PURPOSE_A, forgeRaw(PURPOSE_A, overflowingIssue)),
    ).toBeNull();
  });

  test("a missing issue time or expiry is refused", () => {
    const withoutIssue: JSONObject = validEnvelope();
    const withoutExpiry: JSONObject = validEnvelope();

    delete withoutIssue["i"];
    delete withoutExpiry["x"];

    expect(verifyAt(PURPOSE_A, forge(PURPOSE_A, withoutIssue))).toBeNull();
    expect(verifyAt(PURPOSE_A, forge(PURPOSE_A, withoutExpiry))).toBeNull();
  });

  test("a signed envelope that has already expired, or is issued in the future, is refused", () => {
    expect(
      verifyAt(
        PURPOSE_A,
        forge(PURPOSE_A, validEnvelope({ x: NOW.getTime() })),
      ),
    ).toBeNull();
    expect(
      verifyAt(
        PURPOSE_A,
        forge(PURPOSE_A, validEnvelope({ x: NOW.getTime() - 1 })),
      ),
    ).toBeNull();
    expect(
      verifyAt(
        PURPOSE_A,
        forge(
          PURPOSE_A,
          validEnvelope({
            i: NOW.getTime() + FIVE_MINUTES_MS + 1,
            x: NOW.getTime() + 60 * ONE_MINUTE_MS,
          }),
        ),
      ),
    ).toBeNull();
  });

  const NOT_ENVELOPES: Array<[string, string]> = [
    ["not JSON at all", "this is not json"],
    ["truncated JSON", '{"v":1,"c":{'],
    ["a JSON array", '[1,{"note":"hello"}]'],
    ["a JSON string", '"v1"'],
    ["a JSON number", "1"],
    ["JSON null", "null"],
    ["JSON true", "true"],
    ["an empty object", "{}"],
  ];

  test.each(NOT_ENVELOPES)(
    "a signed payload that is %s is null, and does not throw",
    (_label: string, payloadText: string) => {
      const token: string = forgeRaw(PURPOSE_A, payloadText);

      expect(() => {
        return verifyAt(PURPOSE_A, token);
      }).not.toThrow();
      expect(verifyAt(PURPOSE_A, token)).toBeNull();
    },
  );

  test("a signed payload that is not valid UTF-8 is null, and does not throw", () => {
    const payloadB64: string = Buffer.from([0xff, 0xfe, 0x80, 0x81]).toString(
      "base64url",
    );
    const token: string = `v1.${payloadB64}.${expectedSignature(PURPOSE_A, payloadB64)}`;

    expect(() => {
      return verifyAt(PURPOSE_A, token);
    }).not.toThrow();
    expect(verifyAt(PURPOSE_A, token)).toBeNull();
  });
});

describe("McpOAuthSignedToken is never a JWT, in either direction", () => {
  const userId: ObjectID = ObjectID.generate();
  const email: Email = new Email("member@example.com");

  // Claims shaped exactly like a dashboard session, the worst case.
  const SESSION_SHAPED_CLAIMS: JSONObject = {
    userId: userId.toString(),
    email: email.toString(),
    name: "A Member",
    isMasterAdmin: true,
    isGlobalLogin: true,
  };

  test("a signed token is refused by JSONWebToken.decode, for every purpose", () => {
    for (const purpose of ALL_PURPOSES) {
      const token: string = signOrFail(purpose, SESSION_SHAPED_CLAIMS);

      expect(() => {
        return JSONWebToken.decode(token);
      }).toThrow("AccessToken is invalid or expired");

      expect(() => {
        return JSONWebToken.decodeJsonPayload(token);
      }).toThrow();
    }
  });

  test("a signed token is refused by the JWT library itself, under the same secret", () => {
    const token: string = signOrFail(DELEGATION_PURPOSE, SESSION_SHAPED_CLAIMS);

    expect(() => {
      return jwt.verify(token, EncryptionSecret.toString());
    }).toThrow();

    // Not even parseable as a JWT without checking the signature.
    expect(jwt.decode(token)).toBeNull();
  });

  test("a real session JWT does not verify as a signed token of any purpose", () => {
    const sessionToken: string = JSONWebToken.signUserLoginToken({
      tokenData: {
        userId,
        email,
        name: new Name("A Member"),
        timezone: null,
        isMasterAdmin: true,
        isGlobalLogin: true,
        sessionId: ObjectID.generate(),
      },
      expiresInSeconds: 900,
    });

    // It IS a session, which is exactly why it must not also be one of these.
    expect(JSONWebToken.decode(sessionToken).userId.toString()).toBe(
      userId.toString(),
    );

    for (const purpose of ALL_PURPOSES) {
      expect(
        McpOAuthSignedToken.verify({ purpose, token: sessionToken }),
      ).toBeNull();
    }
  });

  test("a JWT carrying a signed token's own envelope does not verify either", () => {
    /*
     * The envelope fields, signed as a JWT with the same secret: the format
     * and the key are both wrong, so the contents do not matter.
     */
    const lookalike: string = JSONWebToken.signJsonPayload(
      {
        v: 1,
        c: SESSION_SHAPED_CLAIMS,
        i: Date.now(),
        x: Date.now() + ONE_MINUTE_MS,
      },
      60,
    );

    for (const purpose of ALL_PURPOSES) {
      expect(
        McpOAuthSignedToken.verify({ purpose, token: lookalike }),
      ).toBeNull();
    }
  });

  test("a signed token does not start the way every JWT does", () => {
    // A JWT's first segment is base64url JSON, so it always begins "eyJ".
    const token: string = signOrFail(PURPOSE_A, SESSION_SHAPED_CLAIMS);

    expect(token.startsWith("v1.")).toBe(true);
    expect(token.startsWith("eyJ")).toBe(false);
  });
});
