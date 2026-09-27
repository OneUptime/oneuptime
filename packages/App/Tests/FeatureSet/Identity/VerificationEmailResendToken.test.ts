import VerificationEmailResendToken, {
  VERIFICATION_EMAIL_RESEND_TOKEN_EXPIRY_IN_SECONDS,
  VerificationEmailResendTokenClaims,
} from "../../../FeatureSet/Identity/Utils/VerificationEmailResendToken";
import { EncryptionSecret } from "Common/Server/EnvironmentConfig";
import JSONWebToken from "Common/Server/Utils/JsonWebToken";
import Email from "Common/Types/Email";
import ObjectID from "Common/Types/ObjectID";
import crypto from "crypto";
import { describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * THE CREDENTIAL A FRESHLY SIGNED-UP BROWSER HOLDS TO ASK FOR ANOTHER
 * VERIFICATION EMAIL -- AND EVERYTHING IT MUST NOT BE.
 *
 * A hosted signup ends on "check your inbox" with no session. The page is
 * handed this token instead, so that it can press "resend" without anybody
 * signing in. What it carries is harmless (the id of the account the holder
 * just created and the address they typed), so the tests that matter are
 * about what it must NOT be:
 *
 *   - NOT FORGEABLE. Any change to the payload, the signature, the version or
 *     the shape is refused -- and a signature made under a different
 *     EncryptionSecret is refused too;
 *
 *   - NOT A SESSION. JSONWebToken.decode accepts any JWT signed with
 *     EncryptionSecret that carries an `email` as a full user session. A
 *     resend token minted as such a JWT would be a session for an UNVERIFIED
 *     account -- exactly what signup refuses to hand out. So it is not a JWT,
 *     it is signed with a key derived for this purpose alone, and the real
 *     decode is run against it here rather than trusted to reject it;
 *
 *   - NOT EVERLASTING. It expires a day after issue, to the millisecond, and a
 *     token claiming to have been issued well in the future is refused;
 *
 *   - NOT A THROWER. The route treats "null" as a forged credential and a
 *     throw as a server error, so a malformed token must never become a 500.
 *     A few hundred deterministic random strings are thrown at it to hold that;
 *
 *   - NOT A LEAK. The address travels base64url-encoded, never readable in the
 *     raw token that sits in a page's memory and its network log.
 * ---------------------------------------------------------------------------
 */

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    },
    getLogAttributesFromRequest: (): Record<string, unknown> => {
      return {};
    },
  };
});

const USER_ID: string = "22222222-2222-4222-8222-222222222222";
const OTHER_USER_ID: string = "33333333-3333-4333-8333-333333333333";
const USER_EMAIL: string = "new-user@example.com";

const NOW: Date = new Date("2026-09-27T12:00:00.000Z");
const NOW_MS: number = NOW.getTime();
const EXPIRY_MS: number =
  VERIFICATION_EMAIL_RESEND_TOKEN_EXPIRY_IN_SECONDS * 1000;

/* The label the spec derives the signing key under, restated on purpose. */
const KEY_DERIVATION_LABEL: string =
  "oneuptime:identity:verification-email-resend-token:v1";

const TOKEN_SHAPE_PATTERN: RegExp =
  /^v1\.[A-Za-z0-9_-]{1,900}\.[A-Za-z0-9_-]{43}$/;
const JWT_SHAPE_PATTERN: RegExp =
  /^eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*$/;
const BASE64URL_ALPHABET: string =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

type MintFunction = (data?: {
  userId?: string;
  email?: string;
  now?: Date;
}) => string;

// A genuine token, as /signup would mint it.
const mint: MintFunction = (
  data: { userId?: string; email?: string; now?: Date } = {},
): string => {
  const token: string | null = VerificationEmailResendToken.generate({
    userId: new ObjectID(data.userId || USER_ID),
    email: new Email(data.email || USER_EMAIL),
    now: data.now || NOW,
  });

  if (!token) {
    throw new Error("generate() refused a perfectly ordinary account");
  }

  return token;
};

type SignFunction = (payloadB64: string, secret?: string) => string;

/*
 * The signature exactly as the spec defines it: an HMAC key derived from
 * EncryptionSecret under a purpose label, then an HMAC over "v1.<payload>".
 * Reimplemented here rather than borrowed from the module, so that a change
 * to the derivation shows up as a test failure and so that the tests below
 * can sign payloads the module itself would never write.
 */
const sign: SignFunction = (
  payloadB64: string,
  secret: string = EncryptionSecret.toString(),
): string => {
  const key: Buffer = crypto
    .createHmac("sha256", secret)
    .update(KEY_DERIVATION_LABEL)
    .digest();

  return crypto
    .createHmac("sha256", key)
    .update("v1." + payloadB64)
    .digest("base64url");
};

type EncodeFunction = (text: string) => string;

const encode: EncodeFunction = (text: string): string => {
  return Buffer.from(text, "utf8").toString("base64url");
};

type ForgeFunction = (payload: unknown, options?: { raw?: boolean }) => string;

/*
 * A correctly SIGNED token over any payload at all. What these tokens test is
 * everything verify() checks AFTER the signature -- which only matters if the
 * signing key ever leaks, and is exactly what must still hold if it does.
 */
const forge: ForgeFunction = (
  payload: unknown,
  options: { raw?: boolean } = {},
): string => {
  const payloadB64: string = encode(
    options.raw ? (payload as string) : JSON.stringify(payload),
  );

  return `v1.${payloadB64}.${sign(payloadB64)}`;
};

type ValidPayloadFunction = (
  overrides?: Record<string, unknown>,
) => Record<string, unknown>;

const validPayload: ValidPayloadFunction = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => {
  return {
    v: 1,
    u: USER_ID,
    e: USER_EMAIL,
    i: NOW_MS,
    x: NOW_MS + EXPIRY_MS,
    ...overrides,
  };
};

type WithoutFunction = (key: string) => Record<string, unknown>;

const validPayloadWithout: WithoutFunction = (
  key: string,
): Record<string, unknown> => {
  const payload: Record<string, unknown> = validPayload();
  delete payload[key];
  return payload;
};

type SegmentsFunction = (token: string) => {
  prefix: string;
  payload: string;
  signature: string;
};

const segments: SegmentsFunction = (
  token: string,
): { prefix: string; payload: string; signature: string } => {
  const parts: Array<string> = token.split(".");

  return {
    prefix: parts[0] || "",
    payload: parts[1] || "",
    signature: parts[2] || "",
  };
};

type DecodePayloadFunction = (token: string) => Record<string, unknown>;

const decodePayload: DecodePayloadFunction = (
  token: string,
): Record<string, unknown> => {
  return JSON.parse(
    Buffer.from(segments(token).payload, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
};

type VerifyFunction = (
  token: unknown,
  now?: Date,
) => VerificationEmailResendTokenClaims | null;

const verifyAt: VerifyFunction = (
  token: unknown,
  now: Date = NOW,
): VerificationEmailResendTokenClaims | null => {
  return VerificationEmailResendToken.verify(token, now);
};

type RandomFunction = () => number;

type CreateRandomFunction = (seed: number) => RandomFunction;

/*
 * Park-Miller: small, deterministic and seedable, so the fuzz below throws the
 * same few hundred strings at verify() on every run and a failure reproduces.
 */
const createRandom: CreateRandomFunction = (seed: number): RandomFunction => {
  let state: number = seed % 2147483647;

  if (state <= 0) {
    state = state + 2147483646;
  }

  return (): number => {
    state = (state * 48271) % 2147483647;
    return (state - 1) / 2147483646;
  };
};

type RandomStringFunction = (
  random: RandomFunction,
  alphabet: string,
  length: number,
) => string;

const randomString: RandomStringFunction = (
  random: RandomFunction,
  alphabet: string,
  length: number,
): string => {
  let result: string = "";

  for (let i: number = 0; i < length; i++) {
    result = result + alphabet.charAt(Math.floor(random() * alphabet.length));
  }

  return result;
};

describe("a token minted for a new account", () => {
  it("round-trips to the account id, the address and the issuance time", () => {
    const claims: VerificationEmailResendTokenClaims | null = verifyAt(mint());

    expect(claims).not.toBeNull();
    expect(claims!.userId).toBeInstanceOf(ObjectID);
    expect(claims!.userId.toString()).toBe(USER_ID);
    expect(claims!.email).toBeInstanceOf(Email);
    expect(claims!.email.toString()).toBe(USER_EMAIL);
    expect(claims!.issuedAt).toBeInstanceOf(Date);
    expect(claims!.issuedAt.getTime()).toBe(NOW_MS);
  });

  it("carries nothing but the claims the spec names", () => {
    const claims: VerificationEmailResendTokenClaims | null = verifyAt(mint());

    expect(Object.keys(claims!).sort()).toEqual(
      ["email", "issuedAt", "userId"].sort(),
    );
  });

  it("is three dot-separated segments: a version, a payload and a 43-character signature", () => {
    const token: string = mint();

    expect(token).toMatch(TOKEN_SHAPE_PATTERN);
    expect(token.split(".")).toHaveLength(3);
    expect(segments(token).prefix).toBe("v1");
    expect(segments(token).signature).toHaveLength(43);
  });

  it("encodes exactly the documented payload, expiring one day after issue", () => {
    expect(decodePayload(mint())).toEqual({
      v: 1,
      u: USER_ID,
      e: USER_EMAIL,
      i: NOW_MS,
      x: NOW_MS + 24 * 60 * 60 * 1000,
    });
  });

  it("expires after one day", () => {
    expect(VERIFICATION_EMAIL_RESEND_TOKEN_EXPIRY_IN_SECONDS).toBe(
      24 * 60 * 60,
    );
  });

  it("is signed with the purpose-derived key the spec describes", () => {
    const token: string = mint();

    expect(segments(token).signature).toBe(sign(segments(token).payload));
  });

  it("is deterministic for the same account, address and instant", () => {
    expect(mint()).toBe(mint());
  });

  it("differs for a different account, address or instant", () => {
    const token: string = mint();

    expect(mint({ userId: OTHER_USER_ID })).not.toBe(token);
    expect(mint({ email: "someone-else@example.com" })).not.toBe(token);
    expect(mint({ now: new Date(NOW_MS + 1) })).not.toBe(token);
  });

  it("uses the current time when no clock is passed", () => {
    const before: number = Date.now();

    const token: string | null = VerificationEmailResendToken.generate({
      userId: new ObjectID(USER_ID),
      email: new Email(USER_EMAIL),
    });

    const after: number = Date.now();

    const claims: VerificationEmailResendTokenClaims | null =
      VerificationEmailResendToken.verify(token);

    expect(claims).not.toBeNull();
    expect(claims!.issuedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(claims!.issuedAt.getTime()).toBeLessThanOrEqual(after);
  });
});

describe("the address inside the token", () => {
  /*
   * The route compares the stored address with the token's, so a token that
   * kept whatever case the form was typed in would refuse its own account.
   */
  it("is stored lower-cased, even when handed something that is not", () => {
    const shouting: Email = {
      toString: (): string => {
        return "New-User@Example.COM";
      },
    } as unknown as Email;

    const token: string | null = VerificationEmailResendToken.generate({
      userId: new ObjectID(USER_ID),
      email: shouting,
      now: NOW,
    });

    expect(token).not.toBeNull();
    expect(decodePayload(token!)["e"]).toBe(USER_EMAIL);
    expect(verifyAt(token)!.email.toString()).toBe(USER_EMAIL);
  });

  it("comes back lower-cased even from a signed payload that is not", () => {
    const claims: VerificationEmailResendTokenClaims | null = verifyAt(
      forge(validPayload({ e: "New-User@Example.COM" })),
    );

    expect(claims!.email.toString()).toBe(USER_EMAIL);
  });

  it("matches however the same address was typed", () => {
    expect(verifyAt(mint({ email: "NEW-USER@EXAMPLE.COM" }))!.email).toEqual(
      verifyAt(mint({ email: "new-user@example.com" }))!.email,
    );
  });

  it("is not readable in the raw token", () => {
    const token: string = mint();

    expect(token).not.toContain(USER_EMAIL);
    expect(token).not.toContain("@");
    expect(token).not.toContain("example.com");
  });

  it("is not accompanied by the account id in readable form either", () => {
    expect(mint()).not.toContain(USER_ID);
  });
});

describe("expiry", () => {
  const token: string = mint();

  it("is honoured up to the last millisecond before expiry", () => {
    expect(verifyAt(token, new Date(NOW_MS + EXPIRY_MS - 1))).not.toBeNull();
  });

  it("is refused at the instant of expiry", () => {
    expect(verifyAt(token, new Date(NOW_MS + EXPIRY_MS))).toBeNull();
  });

  it("is refused after expiry", () => {
    expect(verifyAt(token, new Date(NOW_MS + EXPIRY_MS + 1))).toBeNull();
    expect(
      verifyAt(token, new Date(NOW_MS + 30 * 24 * 60 * 60 * 1000)),
    ).toBeNull();
  });

  it("is honoured an hour after issue", () => {
    expect(verifyAt(token, new Date(NOW_MS + 60 * 60 * 1000))).not.toBeNull();
  });

  /*
   * A few minutes of clock disagreement between the pods behind one hostname
   * is tolerated -- up to five minutes, inclusive. Beyond that the token was
   * not minted by an honest clock.
   */
  it("tolerates an issuance time up to five minutes ahead of this clock", () => {
    expect(verifyAt(token, new Date(NOW_MS - 4 * 60 * 1000))).not.toBeNull();
    expect(verifyAt(token, new Date(NOW_MS - 5 * 60 * 1000))).not.toBeNull();
  });

  it("refuses an issuance time more than five minutes ahead of this clock", () => {
    expect(verifyAt(token, new Date(NOW_MS - 5 * 60 * 1000 - 1))).toBeNull();
    expect(verifyAt(token, new Date(NOW_MS - 60 * 60 * 1000))).toBeNull();
  });

  it("refuses a correctly signed token that claims a far-future issuance", () => {
    /*
     * An issuance time far in the future would dodge the per-credential cap,
     * which counts only sends after issuance.
     */
    const farFuture: number = NOW_MS + 24 * 60 * 60 * 1000;

    expect(
      verifyAt(forge(validPayload({ i: farFuture, x: farFuture + EXPIRY_MS }))),
    ).toBeNull();
  });

  it("never throws on a broken clock", () => {
    expect(() => {
      return verifyAt(token, new Date(Number.NaN));
    }).not.toThrow();
    expect(verifyAt(token, new Date(Number.NaN))).toBeNull();
    expect(verifyAt(token, {} as unknown as Date)).toBeNull();
  });
});

describe("tampering", () => {
  it("refuses a token whose payload now names a different account", () => {
    const token: string = mint();
    const payload: Record<string, unknown> = decodePayload(token);
    payload["u"] = OTHER_USER_ID;

    const tampered: string = `v1.${encode(JSON.stringify(payload))}.${segments(token).signature}`;

    expect(verifyAt(tampered)).toBeNull();
  });

  it("refuses a token whose payload now names a different address", () => {
    const token: string = mint();
    const payload: Record<string, unknown> = decodePayload(token);
    payload["e"] = "attacker@example.net";

    const tampered: string = `v1.${encode(JSON.stringify(payload))}.${segments(token).signature}`;

    expect(verifyAt(tampered)).toBeNull();
  });

  it("refuses a token whose expiry has been pushed out", () => {
    const token: string = mint();
    const payload: Record<string, unknown> = decodePayload(token);
    payload["x"] = NOW_MS + 365 * 24 * 60 * 60 * 1000;

    const tampered: string = `v1.${encode(JSON.stringify(payload))}.${segments(token).signature}`;

    expect(verifyAt(tampered)).toBeNull();
    expect(verifyAt(tampered, new Date(NOW_MS + EXPIRY_MS + 1))).toBeNull();
  });

  it("refuses a token with any single character of its payload changed", () => {
    const token: string = mint();
    const { payload, signature } = segments(token);

    for (let index: number = 0; index < payload.length; index++) {
      const original: string = payload.charAt(index);
      const replacement: string = original === "A" ? "B" : "A";
      const mutated: string =
        payload.slice(0, index) + replacement + payload.slice(index + 1);

      expect(verifyAt(`v1.${mutated}.${signature}`)).toBeNull();
    }
  });

  it("refuses a token with any single character of its signature changed", () => {
    const token: string = mint();
    const { payload, signature } = segments(token);

    for (let index: number = 0; index < signature.length; index++) {
      const original: string = signature.charAt(index);
      const replacement: string = original === "A" ? "B" : "A";
      const mutated: string =
        signature.slice(0, index) + replacement + signature.slice(index + 1);

      expect(verifyAt(`v1.${payload}.${mutated}`)).toBeNull();
    }
  });

  it("refuses a payload wearing the signature of another genuine token", () => {
    const mine: string = mint();
    const theirs: string = mint({ userId: OTHER_USER_ID });

    expect(
      verifyAt(`v1.${segments(theirs).payload}.${segments(mine).signature}`),
    ).toBeNull();
    expect(
      verifyAt(`v1.${segments(mine).payload}.${segments(theirs).signature}`),
    ).toBeNull();
  });

  it("refuses a payload signed with the raw EncryptionSecret instead of the derived key", () => {
    /*
     * Purpose separation: an HMAC made directly with EncryptionSecret -- as
     * any other feature signing with it might -- must not verify here.
     */
    const payloadB64: string = encode(JSON.stringify(validPayload()));
    const rawSignature: string = crypto
      .createHmac("sha256", EncryptionSecret.toString())
      .update("v1." + payloadB64)
      .digest("base64url");

    expect(verifyAt(`v1.${payloadB64}.${rawSignature}`)).toBeNull();
  });

  it("accepts the same payload signed with the derived key, so the refusals above are about the key", () => {
    expect(verifyAt(forge(validPayload()))).not.toBeNull();
  });
});

describe("the version and the shape", () => {
  const token: string = mint();
  const { payload, signature } = segments(token);

  it.each([
    ["a v2 prefix", `v2.${payload}.${signature}`],
    ["an upper-case prefix", `V1.${payload}.${signature}`],
    ["a v0 prefix", `v0.${payload}.${signature}`],
    ["no prefix", `.${payload}.${signature}`],
    ["the prefix dropped", `${payload}.${signature}`],
    ["an extra trailing segment", `${token}.extra`],
    ["a trailing dot", `${token}.`],
    ["the signature duplicated as a fourth segment", `${token}.${signature}`],
    ["the signature missing", `v1.${payload}`],
    ["the signature empty", `v1.${payload}.`],
    ["the payload empty", `v1..${signature}`],
    [
      "the separator between payload and signature dropped",
      `v1.${payload}${signature}`,
    ],
    ["a short signature", `v1.${payload}.${signature.slice(0, 42)}`],
    ["a long signature", `v1.${payload}.${signature}A`],
    ["standard base64 padding", `v1.${payload}.${signature}=`],
    ["leading whitespace", ` ${token}`],
    ["trailing whitespace", `${token} `],
    ["a trailing newline", `${token}\n`],
    ["a Bearer prefix", `Bearer ${token}`],
    ["the empty string", ""],
  ])("refuses a token with %s", (_label: string, candidate: string) => {
    expect(verifyAt(candidate)).toBeNull();
  });

  it("refuses a correctly signed payload that declares another version", () => {
    expect(verifyAt(forge(validPayload({ v: 2 })))).toBeNull();
    expect(verifyAt(forge(validPayload({ v: "1" })))).toBeNull();
    expect(verifyAt(forge(validPayload({ v: 0 })))).toBeNull();
    expect(verifyAt(forge(validPayloadWithout("v")))).toBeNull();
  });
});

describe("inputs that are not strings", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a number", 12345],
    ["NaN", Number.NaN],
    ["a boolean", true],
    ["an empty object", {}],
    ["an empty array", []],
    ["an array holding a genuine token", [mint()]],
    ["an object holding a genuine token", { token: mint() }],
    [
      "an object that stringifies to a genuine token",
      {
        toString: (): string => {
          return mint();
        },
      },
    ],
    ["a boxed string holding a genuine token", Object(mint())],
    ["a Buffer holding a genuine token", Buffer.from(mint())],
    [
      "a function",
      (): string => {
        return mint();
      },
    ],
    ["a symbol", Symbol("token")],
  ])("refuses %s without throwing", (_label: string, candidate: unknown) => {
    expect(() => {
      return VerificationEmailResendToken.verify(candidate, NOW);
    }).not.toThrow();
    expect(verifyAt(candidate)).toBeNull();
  });
});

describe("over-long and undecodable input", () => {
  it("refuses a token past the length cap before doing any cryptography", () => {
    const payloadB64: string = "A".repeat(1100);

    expect(verifyAt(`v1.${payloadB64}.${sign(payloadB64)}`)).toBeNull();
  });

  it("refuses a correctly signed payload longer than the payload cap", () => {
    const payloadB64: string = encode(
      JSON.stringify(validPayload({ padding: "p".repeat(700) })),
    );

    expect(payloadB64.length).toBeGreaterThan(900);
    expect(verifyAt(`v1.${payloadB64}.${sign(payloadB64)}`)).toBeNull();
  });

  it("refuses a megabyte of input", () => {
    expect(verifyAt("v1." + "A".repeat(1024 * 1024))).toBeNull();
    expect(verifyAt("x".repeat(1024 * 1024))).toBeNull();
  });

  it.each([
    ["text that is not JSON", "not json at all"],
    ["truncated JSON", '{"v":1,"u":"'],
    ["a JSON array", JSON.stringify([1, USER_ID, USER_EMAIL])],
    ["JSON null", "null"],
    ["a JSON number", "12345"],
    ["a JSON string", JSON.stringify("v1")],
    ["JSON true", "true"],
    ["an empty JSON object", "{}"],
    ["invalid UTF-8 bytes", "\udc00\ud800"],
  ])(
    "refuses a correctly signed payload holding %s",
    (_label: string, text: string) => {
      expect(verifyAt(forge(text, { raw: true }))).toBeNull();
    },
  );

  it("refuses a payload segment that is not valid base64url", () => {
    const payloadB64: string = "!!!not-base64!!!";

    expect(verifyAt(`v1.${payloadB64}.${sign(payloadB64)}`)).toBeNull();
  });
});

describe("a correctly signed payload with missing or ill-typed claims", () => {
  /*
   * These can only exist if the signing key has leaked. They are refused
   * anyway, so that a leaked key forges well-formed tokens at worst -- never
   * a token that makes the route query with a missing id or a bogus address.
   */
  it.each([
    ["no account id", validPayloadWithout("u")],
    ["a numeric account id", validPayload({ u: 12345 })],
    ["an account id that is not a UUID", validPayload({ u: "not-a-uuid" })],
    ["an account id with trailing text", validPayload({ u: USER_ID + "x" })],
    [
      "an account id with a SQL payload",
      validPayload({ u: `${USER_ID}' OR '1'='1` }),
    ],
    ["an empty account id", validPayload({ u: "" })],
    [
      "an account id wrapped in an object",
      validPayload({ u: { value: USER_ID } }),
    ],
    ["no address", validPayloadWithout("e")],
    ["a numeric address", validPayload({ e: 42 })],
    ["an address that is not one", validPayload({ e: "not-an-email" })],
    ["an empty address", validPayload({ e: "" })],
    [
      "an address wrapped in an object",
      validPayload({ e: { value: USER_EMAIL } }),
    ],
    ["no issuance time", validPayloadWithout("i")],
    ["an issuance time given as a string", validPayload({ i: String(NOW_MS) })],
    ["a fractional issuance time", validPayload({ i: NOW_MS + 0.5 })],
    ["an unsafe-integer issuance time", validPayload({ i: 2 ** 53 })],
    ["a null issuance time", validPayload({ i: null })],
    [
      "an issuance time given as an ISO date",
      validPayload({ i: NOW.toISOString() }),
    ],
    ["no expiry", validPayloadWithout("x")],
    [
      "an expiry given as a string",
      validPayload({ x: String(NOW_MS + EXPIRY_MS) }),
    ],
    ["a fractional expiry", validPayload({ x: NOW_MS + EXPIRY_MS + 0.5 })],
    ["an unsafe-integer expiry", validPayload({ x: Number.MAX_VALUE })],
    ["a null expiry", validPayload({ x: null })],
    ["an expiry already in the past", validPayload({ x: NOW_MS - 1 })],
    ["an expiry of exactly now", validPayload({ x: NOW_MS })],
  ])("refuses %s", (_label: string, payload: Record<string, unknown>) => {
    expect(verifyAt(forge(payload))).toBeNull();
  });
});

describe("it is not a session", () => {
  /*
   * The property the whole design turns on. JSONWebToken.decode is the real
   * one here, not a mock: if a resend token ever decoded, holding one would
   * be holding a signed-in session for an account whose address nobody has
   * proved.
   */
  it("does not look like a JWT", () => {
    const token: string = mint();

    expect(token).not.toMatch(JWT_SHAPE_PATTERN);
    expect(token.startsWith("eyJ")).toBe(false);
    expect(
      token.split(".").every((segment: string) => {
        return segment.startsWith("eyJ");
      }),
    ).toBe(false);
  });

  it("is rejected by the real JSONWebToken.decode", () => {
    const token: string = mint();

    expect(() => {
      return JSONWebToken.decode(token);
    }).toThrow("AccessToken is invalid or expired");
  });

  it("is rejected by the real JSONWebToken.decodeJsonPayload", () => {
    expect(() => {
      return JSONWebToken.decodeJsonPayload(mint());
    }).toThrow();
  });

  it("would have been a session had it been a JWT -- which is why it is not one", () => {
    /*
     * The same claims, signed the way every other identity token is. The real
     * decode accepts it as a session for the address it names, so this is the
     * token a careless implementation would have handed an unverified user.
     */
    const sessionShaped: string = JSONWebToken.signJsonPayload(
      {
        userId: USER_ID,
        email: USER_EMAIL,
        v: 1,
        u: USER_ID,
        e: USER_EMAIL,
        i: NOW_MS,
        x: NOW_MS + EXPIRY_MS,
      },
      60 * 60,
    );

    expect(JSONWebToken.decode(sessionShaped).email.toString()).toBe(
      USER_EMAIL,
    );

    // ...and this route refuses it, so nothing can be passed off either way.
    expect(verifyAt(sessionShaped)).toBeNull();
    expect(VerificationEmailResendToken.verify(sessionShaped)).toBeNull();
  });
});

describe("a token signed under a different EncryptionSecret", () => {
  type TokenModule =
    typeof import("../../../FeatureSet/Identity/Utils/VerificationEmailResendToken");

  type LoadWithSecretFunction = (secret: string) => TokenModule;

  /*
   * EncryptionSecret is read at module load, so the only honest way to see a
   * second installation is a second copy of the module with its own
   * environment. A token minted by one installation must be worthless to
   * every other: they share this code and the derivation label, and nothing
   * else.
   */
  const loadWithSecret: LoadWithSecretFunction = (
    secret: string,
  ): TokenModule => {
    let loaded: TokenModule | null = null;

    jest.isolateModules((): void => {
      jest.doMock("Common/Server/EnvironmentConfig", () => {
        const actual: Record<string, unknown> = jest.requireActual(
          "Common/Server/EnvironmentConfig",
        ) as Record<string, unknown>;

        return {
          ...actual,
          __esModule: true,
          EncryptionSecret: {
            toString: (): string => {
              return secret;
            },
          },
        };
      });

      /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
      loaded = require("../../../FeatureSet/Identity/Utils/VerificationEmailResendToken");
      /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    });

    jest.dontMock("Common/Server/EnvironmentConfig");

    if (!loaded) {
      throw new Error("The reloaded token module did not load");
    }

    return loaded;
  };

  const OTHER_SECRET: string = "a-completely-different-encryption-secret";

  it("is refused here", () => {
    const other: TokenModule = loadWithSecret(OTHER_SECRET);

    const foreignToken: string | null = other.default.generate({
      userId: new ObjectID(USER_ID),
      email: new Email(USER_EMAIL),
      now: NOW,
    });

    expect(foreignToken).not.toBeNull();
    expect(verifyAt(foreignToken)).toBeNull();
  });

  it("refuses ours there", () => {
    const other: TokenModule = loadWithSecret(OTHER_SECRET);

    expect(other.default.verify(mint(), NOW)).toBeNull();
  });

  it("still verifies its own tokens, so the refusals are about the secret", () => {
    const other: TokenModule = loadWithSecret(OTHER_SECRET);

    const foreignToken: string | null = other.default.generate({
      userId: new ObjectID(USER_ID),
      email: new Email(USER_EMAIL),
      now: NOW,
    });

    const claims: VerificationEmailResendTokenClaims | null =
      other.default.verify(foreignToken, NOW);

    expect(claims?.userId.toString()).toBe(USER_ID);
    expect(claims?.email.toString()).toBe(USER_EMAIL);

    // Same payload bytes, different signature: only the key differs.
    expect(segments(foreignToken!).payload).toBe(segments(mint()).payload);
    expect(segments(foreignToken!).signature).toBe(
      sign(segments(foreignToken!).payload, OTHER_SECRET),
    );
    expect(segments(foreignToken!).signature).not.toBe(
      segments(mint()).signature,
    );
  });
});

describe("verify never throws", () => {
  /*
   * Deterministic fuzz: the same seed every run, so a failure names a string
   * that can be reproduced. Three families -- arbitrary text, strings shaped
   * exactly like a token, and single-edit mutations of a genuine token.
   */
  const ARBITRARY_ALPHABET: string =
    BASE64URL_ALPHABET + '. =+/{}[]":,\\\n\t\u0000é漢😀';

  type CandidateFactory = (random: RandomFunction) => string;

  const expectRefusedWithoutThrowing: (candidate: string) => void = (
    candidate: string,
  ): void => {
    let result: VerificationEmailResendTokenClaims | null | undefined =
      undefined;

    expect(() => {
      result = VerificationEmailResendToken.verify(candidate, NOW);
    }).not.toThrow();

    expect(result).toBeNull();
  };

  const runFuzz: (
    seed: number,
    count: number,
    factory: CandidateFactory,
  ) => void = (
    seed: number,
    count: number,
    factory: CandidateFactory,
  ): void => {
    const random: RandomFunction = createRandom(seed);

    for (let i: number = 0; i < count; i++) {
      expectRefusedWithoutThrowing(factory(random));
    }
  };

  it("on arbitrary text", () => {
    runFuzz(20260927, 150, (random: RandomFunction): string => {
      return randomString(
        random,
        ARBITRARY_ALPHABET,
        Math.floor(random() * 200),
      );
    });
  });

  it("on arbitrary text that starts like a token", () => {
    runFuzz(4242, 100, (random: RandomFunction): string => {
      return (
        "v1." +
        randomString(random, ARBITRARY_ALPHABET, Math.floor(random() * 120))
      );
    });
  });

  it("on strings shaped exactly like a token", () => {
    runFuzz(1337, 150, (random: RandomFunction): string => {
      return (
        "v1." +
        randomString(
          random,
          BASE64URL_ALPHABET,
          1 + Math.floor(random() * 950),
        ) +
        "." +
        randomString(random, BASE64URL_ALPHABET, 43)
      );
    });
  });

  it("on single-edit mutations of a genuine token", () => {
    const genuine: string = mint();

    runFuzz(99, 150, (random: RandomFunction): string => {
      let mutated: string = genuine;

      // Retry until the edit actually changed something.
      while (mutated === genuine) {
        const position: number = Math.floor(random() * genuine.length);
        const character: string = ARBITRARY_ALPHABET.charAt(
          Math.floor(random() * ARBITRARY_ALPHABET.length),
        );
        const edit: number = Math.floor(random() * 3);

        if (edit === 0) {
          mutated =
            genuine.slice(0, position) +
            character +
            genuine.slice(position + 1);
        } else if (edit === 1) {
          mutated =
            genuine.slice(0, position) + character + genuine.slice(position);
        } else {
          mutated = genuine.slice(0, position) + genuine.slice(position + 1);
        }
      }

      return mutated;
    });
  });

  it("on correctly signed random payloads", () => {
    runFuzz(7, 50, (random: RandomFunction): string => {
      return forge(
        randomString(random, ARBITRARY_ALPHABET, Math.floor(random() * 300)),
        { raw: true },
      );
    });
  });
});

describe("generate", () => {
  /*
   * The payload's fixed overhead with an empty address. The spec caps the
   * payload segment at 900 base64url characters, which is 675 bytes of JSON,
   * so the longest address that fits is 675 bytes minus this.
   */
  const PAYLOAD_OVERHEAD: number = JSON.stringify(
    validPayload({ e: "" }),
  ).length;
  const LONGEST_ADDRESS_THAT_FITS: number = (900 * 3) / 4 - PAYLOAD_OVERHEAD;

  type AddressOfLengthFunction = (length: number) => string;

  const addressOfLength: AddressOfLengthFunction = (length: number): string => {
    const domain: string = "@example.com";

    return "a".repeat(length - domain.length) + domain;
  };

  it("mints a token for the longest address that fits the length cap", () => {
    const address: string = addressOfLength(LONGEST_ADDRESS_THAT_FITS);
    const token: string | null = VerificationEmailResendToken.generate({
      userId: new ObjectID(USER_ID),
      email: new Email(address),
      now: NOW,
    });

    expect(token).not.toBeNull();
    expect(segments(token!).payload).toHaveLength(900);
    expect(verifyAt(token)!.email.toString()).toBe(address);
  });

  it("returns null, rather than a token the route would refuse, one character past it", () => {
    expect(
      VerificationEmailResendToken.generate({
        userId: new ObjectID(USER_ID),
        email: new Email(addressOfLength(LONGEST_ADDRESS_THAT_FITS + 1)),
        now: NOW,
      }),
    ).toBeNull();
  });

  it("returns null for an absurdly long address", () => {
    expect(
      VerificationEmailResendToken.generate({
        userId: new ObjectID(USER_ID),
        email: new Email(addressOfLength(5000)),
        now: NOW,
      }),
    ).toBeNull();
  });

  it("returns null for an account id that is not a UUID", () => {
    expect(
      VerificationEmailResendToken.generate({
        userId: new ObjectID("not-a-uuid"),
        email: new Email(USER_EMAIL),
        now: NOW,
      }),
    ).toBeNull();
  });

  it("returns null for an address that does not parse", () => {
    expect(
      VerificationEmailResendToken.generate({
        userId: new ObjectID(USER_ID),
        email: {
          toString: (): string => {
            return "not an address";
          },
        } as unknown as Email,
        now: NOW,
      }),
    ).toBeNull();
  });

  it("returns null rather than throwing on input it cannot use", () => {
    /*
     * Signup has already created the account by the time this runs; a throw
     * here would fail a signup that succeeded. No token just means no button.
     */
    expect(() => {
      return VerificationEmailResendToken.generate({
        userId: null as unknown as ObjectID,
        email: new Email(USER_EMAIL),
        now: NOW,
      });
    }).not.toThrow();

    expect(
      VerificationEmailResendToken.generate({
        userId: null as unknown as ObjectID,
        email: new Email(USER_EMAIL),
        now: NOW,
      }),
    ).toBeNull();

    expect(
      VerificationEmailResendToken.generate({
        userId: new ObjectID(USER_ID),
        email: undefined as unknown as Email,
        now: NOW,
      }),
    ).toBeNull();

    expect(
      VerificationEmailResendToken.generate({
        userId: new ObjectID(USER_ID),
        email: new Email(USER_EMAIL),
        now: new Date(Number.NaN),
      }),
    ).toBeNull();
  });
});
