import { afterEach, describe, expect, jest, test } from "@jest/globals";
import crypto, { KeyObject } from "crypto";
import fs from "fs";
import path from "path";
import EnterpriseFeature from "Common/Server/Enterprise/EnterpriseFeature";
import {
  ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
  ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
  EnterpriseLicenseSnapshotUtil,
} from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";
import LicenseToken, {
  classifyLicenseToken,
  ClassifyLicenseTokenInput,
  LICENSE_TOKEN_AUDIENCE,
  LICENSE_TOKEN_ISSUER,
  LICENSE_TOKEN_MAX_LENGTH,
  LicenseTokenClaims,
  LicenseTokenClassification,
  LicenseTokenError,
  LicenseTokenErrorCode,
  ParsedLicenseToken,
  resolveTrustedLicenseKeys,
  ResolvedTrustedLicenseKeys,
} from "../../../Server/License/LicenseToken";
import {
  getProductionTrustedLicenseKeys,
  getTrustedLicenseKeys,
  setTrustedLicenseKeysForTests,
  TrustedLicenseKey,
} from "../../../Server/License/TrustedLicenseKeys";

/*
 * The signed-license format: EdDSA compact JWS, the strict parser, the RFC 7638
 * key id, the trusted-key list and the pure classification every license
 * decision in the product is built on.
 *
 * Keys are generated per run; no private key material is committed.
 */

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;
const MINUTE_IN_MS: number = 60 * 1000;
const NOW: Date = new Date("2026-09-18T12:00:00.000Z");

/*
 * The owner's decision, written out rather than read from the constants so a
 * change to either constant fails here: an expired license gets 30 days of
 * grace, and an install that never had a license gets a 14-day trial.
 */
const GRACE_DAYS: number = 30;
const TRIAL_DAYS: number = 14;
const NOW_IN_SECONDS: number = Math.floor(NOW.getTime() / 1000);
const LOCAL_INSTANCE_ID: string = "11111111-2222-3333-4444-555555555555";

interface KeyPair {
  publicKey: KeyObject;
  privateKey: KeyObject;
}

const generateEd25519: () => KeyPair = (): KeyPair => {
  return crypto.generateKeyPairSync("ed25519");
};

const SIGNING_KEY: KeyPair = generateEd25519();
const OTHER_KEY: KeyPair = generateEd25519();

const publicPem: (key: KeyObject) => string = (key: KeyObject): string => {
  return key.export({ type: "spki", format: "pem" }).toString();
};

const trustedEntry: (keyPair: KeyPair) => TrustedLicenseKey = (
  keyPair: KeyPair,
): TrustedLicenseKey => {
  return {
    kid: LicenseToken.computeKeyId(keyPair.publicKey),
    publicKeyPem: publicPem(keyPair.publicKey),
  };
};

const TRUSTED: TrustedLicenseKey = trustedEntry(SIGNING_KEY);

const base64url: (value: string | Buffer) => string = (
  value: string | Buffer,
): string => {
  return Buffer.from(value).toString("base64url");
};

const claimsFor: (overrides?: Partial<LicenseTokenClaims>) => LicenseTokenClaims =
  (overrides?: Partial<LicenseTokenClaims>): LicenseTokenClaims => {
    return {
      iss: LICENSE_TOKEN_ISSUER,
      aud: LICENSE_TOKEN_AUDIENCE,
      sub: "license-0001",
      licenseKey: "OU-ENT-0001",
      companyName: "Acme Inc",
      userLimit: 50,
      isEvaluation: false,
      features: ["*"],
      iat: NOW_IN_SECONDS - DAY_IN_MS / 1000,
      exp: NOW_IN_SECONDS + (30 * DAY_IN_MS) / 1000,
      ...(overrides || {}),
    };
  };

/*
 * Builds a compact JWS from raw parts, signing with Ed25519 unless a signature
 * is supplied. Bypasses LicenseToken.sign on purpose, so tests can produce
 * tokens the real signer would refuse to issue.
 */
const craftToken: (options: {
  header: Record<string, unknown>;
  payload: Record<string, unknown> | string;
  privateKey?: KeyObject | undefined;
  signature?: string | undefined;
}) => string = (options: {
  header: Record<string, unknown>;
  payload: Record<string, unknown> | string;
  privateKey?: KeyObject | undefined;
  signature?: string | undefined;
}): string => {
  const headerSegment: string = base64url(JSON.stringify(options.header));
  const payloadSegment: string = base64url(
    typeof options.payload === "string"
      ? options.payload
      : JSON.stringify(options.payload),
  );
  const signingInput: string = `${headerSegment}.${payloadSegment}`;
  const signature: string =
    options.signature !== undefined
      ? options.signature
      : crypto
          .sign(
            null,
            Buffer.from(signingInput),
            options.privateKey || SIGNING_KEY.privateKey,
          )
          .toString("base64url");

  return `${signingInput}.${signature}`;
};

const eddsaHeader: (
  keyPair?: KeyPair,
  extra?: Record<string, unknown>,
) => Record<string, unknown> = (
  keyPair?: KeyPair,
  extra?: Record<string, unknown>,
): Record<string, unknown> => {
  return {
    alg: "EdDSA",
    typ: "JWT",
    kid: LicenseToken.computeKeyId((keyPair || SIGNING_KEY).publicKey),
    ...(extra || {}),
  };
};

const legacyToken: (payload?: Record<string, unknown>) => string = (
  payload?: Record<string, unknown>,
): string => {
  const headerSegment: string = base64url(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  );
  const payloadSegment: string = base64url(
    JSON.stringify(payload || { licenseKey: "OU-LEGACY", exp: 2000000000 }),
  );
  const signature: string = crypto
    .createHmac("sha256", "legacy-encryption-secret")
    .update(`${headerSegment}.${payloadSegment}`)
    .digest("base64url");

  return `${headerSegment}.${payloadSegment}.${signature}`;
};

const classify: (
  overrides?: Partial<ClassifyLicenseTokenInput>,
) => LicenseTokenClassification = (
  overrides?: Partial<ClassifyLicenseTokenInput>,
): LicenseTokenClassification => {
  return classifyLicenseToken({
    token: LicenseToken.sign(claimsFor(), SIGNING_KEY.privateKey),
    storedColumns: {},
    now: NOW,
    trustedKeys: [TRUSTED],
    localInstanceId: LOCAL_INSTANCE_ID,
    graceDays: GRACE_DAYS,
    trialDays: TRIAL_DAYS,
    acceptUnverified: true,
    ...(overrides || {}),
  });
};

const errorCodeOf: (fn: () => unknown) => LicenseTokenErrorCode | null = (
  fn: () => unknown,
): LicenseTokenErrorCode | null => {
  try {
    fn();
  } catch (err) {
    if (err instanceof LicenseTokenError) {
      return err.code;
    }

    throw err;
  }

  return null;
};

const replaceSegment: (
  token: string,
  index: number,
  segment: string,
) => string = (token: string, index: number, segment: string): string => {
  const segments: Array<string> = token.split(".");
  segments[index] = segment;
  return segments.join(".");
};

afterEach(() => {
  setTrustedLicenseKeysForTests(null);
});

describe("LicenseToken.computeKeyId (RFC 7638 thumbprint)", () => {
  test("matches the RFC 8037 appendix A.3 test vector", () => {
    const publicKey: KeyObject = crypto.createPublicKey({
      key: {
        kty: "OKP",
        crv: "Ed25519",
        x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
      },
      format: "jwk",
    });

    expect(LicenseToken.computeKeyId(publicKey)).toBe(
      "kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k",
    );
  });

  test("a private key yields the same kid as its public key", () => {
    expect(LicenseToken.computeKeyId(SIGNING_KEY.privateKey)).toBe(
      LicenseToken.computeKeyId(SIGNING_KEY.publicKey),
    );
  });

  test("different keys have different kids; the same key always the same one", () => {
    expect(LicenseToken.computeKeyId(SIGNING_KEY.publicKey)).not.toBe(
      LicenseToken.computeKeyId(OTHER_KEY.publicKey),
    );
    expect(LicenseToken.computeKeyId(SIGNING_KEY.publicKey)).toBe(
      LicenseToken.computeKeyId(
        crypto.createPublicKey(publicPem(SIGNING_KEY.publicKey)),
      ),
    );
  });

  test("the kid is 43 base64url characters (a SHA-256)", () => {
    expect(LicenseToken.computeKeyId(SIGNING_KEY.publicKey)).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
  });

  test.each(["ec", "ed448", "x25519"] as Array<string>)(
    "refuses a %s key",
    (keyType: string) => {
      const keyPair: KeyPair =
        keyType === "ec"
          ? crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" })
          : keyType === "ed448"
            ? crypto.generateKeyPairSync("ed448")
            : crypto.generateKeyPairSync("x25519");

      expect(
        errorCodeOf(() => {
          return LicenseToken.computeKeyId(keyPair.publicKey);
        }),
      ).toBe("bad-key");
    },
  );
});

describe("Ed25519 signing primitive", () => {
  test("reproduces the RFC 8037 appendix A.4 signature (deterministic, null digest)", () => {
    const privateKey: KeyObject = crypto.createPrivateKey({
      key: {
        kty: "OKP",
        crv: "Ed25519",
        d: "nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A",
        x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
      },
      format: "jwk",
    });
    const signingInput: string =
      "eyJhbGciOiJFZERTQSJ9.RXhhbXBsZSBvZiBFZDI1NTE5IHNpZ25pbmc";
    const expectedSignature: string =
      "hgyY0il_MGCjP0JzlnLWG1PPOt7-09PGcvMg3AIbQR6dWbhijcNR4ki4iylGjg5BhVsPt9g7sVvpAr_MuM0KAg";

    expect(
      crypto.sign(null, Buffer.from(signingInput), privateKey).toString(
        "base64url",
      ),
    ).toBe(expectedSignature);

    const parsed: ParsedLicenseToken = {
      header: { alg: "EdDSA" },
      kid: "rfc-8037",
      payload: {},
      signingInput,
      signature: Buffer.from(expectedSignature, "base64url"),
    };

    const publicKey: KeyObject = crypto.createPublicKey({
      key: {
        kty: "OKP",
        crv: "Ed25519",
        x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
      },
      format: "jwk",
    });

    expect(LicenseToken.verifySignature(parsed, publicKey)).toBe(true);
    expect(LicenseToken.computeKeyId(privateKey)).toBe(
      LicenseToken.computeKeyId(publicKey),
    );
  });
});

describe("LicenseToken.sign", () => {
  test("produces a compact JWS with the EdDSA header and the claims", () => {
    const token: string = LicenseToken.sign(claimsFor(), SIGNING_KEY.privateKey);
    const segments: Array<string> = token.split(".");

    expect(segments).toHaveLength(3);
    expect(
      JSON.parse(Buffer.from(segments[0] as string, "base64url").toString()),
    ).toEqual({
      alg: "EdDSA",
      typ: "JWT",
      kid: LicenseToken.computeKeyId(SIGNING_KEY.publicKey),
    });
    expect(
      JSON.parse(Buffer.from(segments[1] as string, "base64url").toString()),
    ).toEqual(claimsFor());
  });

  test("the result parses and verifies with the matching public key only", () => {
    const parsed: ParsedLicenseToken = LicenseToken.parse(
      LicenseToken.sign(claimsFor(), SIGNING_KEY.privateKey),
    );

    expect(LicenseToken.verifySignature(parsed, SIGNING_KEY.publicKey)).toBe(
      true,
    );
    expect(LicenseToken.verifySignature(parsed, OTHER_KEY.publicKey)).toBe(
      false,
    );
  });

  test("verifying with a non-Ed25519 key is false, not an exception", () => {
    const parsed: ParsedLicenseToken = LicenseToken.parse(
      LicenseToken.sign(claimsFor(), SIGNING_KEY.privateKey),
    );
    const ecKey: KeyPair = crypto.generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });

    expect(LicenseToken.verifySignature(parsed, ecKey.publicKey)).toBe(false);
  });

  test("is deterministic", () => {
    expect(LicenseToken.sign(claimsFor(), SIGNING_KEY.privateKey)).toBe(
      LicenseToken.sign(claimsFor(), SIGNING_KEY.privateKey),
    );
  });

  test("leaves out optional claims that are undefined", () => {
    const token: string = LicenseToken.sign(
      claimsFor({ instanceId: undefined, iat: undefined }),
      SIGNING_KEY.privateKey,
    );
    const payload: Record<string, unknown> = LicenseToken.parse(token).payload;

    expect(payload).not.toHaveProperty("instanceId");
    expect(payload).not.toHaveProperty("iat");
  });

  test("a realistic license stays far below the size cap", () => {
    const token: string = LicenseToken.sign(
      claimsFor({
        companyName: "A Rather Long Company Name Holdings International Ltd.",
        features: ["sso", "scim", "team-compliance", "audit-logs", "instance-health"],
        instanceId: LOCAL_INSTANCE_ID,
      }),
      SIGNING_KEY.privateKey,
    );

    expect(token.length).toBeLessThan(1024);
  });

  test("refuses to issue a token over the size cap", () => {
    expect(
      errorCodeOf(() => {
        return LicenseToken.sign(
          claimsFor({ companyName: "x".repeat(LICENSE_TOKEN_MAX_LENGTH) }),
          SIGNING_KEY.privateKey,
        );
      }),
    ).toBe("too-large");
  });

  test("refuses a public key, or a key that is not Ed25519", () => {
    expect(
      errorCodeOf(() => {
        return LicenseToken.sign(claimsFor(), SIGNING_KEY.publicKey);
      }),
    ).toBe("bad-key");
    expect(
      errorCodeOf(() => {
        return LicenseToken.sign(
          claimsFor(),
          crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" })
            .privateKey,
        );
      }),
    ).toBe("bad-key");
  });

  test("refuses to sign claims its own clients would reject", () => {
    expect(
      errorCodeOf(() => {
        return LicenseToken.sign(
          claimsFor({ aud: "some-other-audience" }),
          SIGNING_KEY.privateKey,
        );
      }),
    ).toBe("bad-claims");
  });
});

describe("LicenseToken.parse (strict)", () => {
  const VALID_TOKEN: string = LicenseToken.sign(
    claimsFor(),
    SIGNING_KEY.privateKey,
  );

  test("parses a valid token", () => {
    const parsed: ParsedLicenseToken = LicenseToken.parse(VALID_TOKEN);

    expect(parsed.kid).toBe(LicenseToken.computeKeyId(SIGNING_KEY.publicKey));
    expect(parsed.payload["sub"]).toBe("license-0001");
    expect(parsed.signingInput).toBe(
      VALID_TOKEN.split(".").slice(0, 2).join("."),
    );
    expect(parsed.signature).toHaveLength(64);
  });

  test.each([null, undefined, 42, {}, ["a", "b", "c"]] as Array<unknown>)(
    "refuses a non-string (%p)",
    (value: unknown) => {
      expect(
        errorCodeOf(() => {
          return LicenseToken.parse(value);
        }),
      ).toBe("not-a-string");
    },
  );

  test("refuses anything over 4 KB before parsing it", () => {
    const huge: string = `${"A".repeat(LICENSE_TOKEN_MAX_LENGTH)}.A.A`;

    expect(
      errorCodeOf(() => {
        return LicenseToken.parse(huge);
      }),
    ).toBe("too-large");
    expect(
      errorCodeOf(() => {
        return LicenseToken.parse("A".repeat(1024 * 1024));
      }),
    ).toBe("too-large");
  });

  test("a token of exactly the cap is not refused for its size", () => {
    const atCap: string = `A.A.${"A".repeat(LICENSE_TOKEN_MAX_LENGTH - 4)}`;

    expect(atCap.length).toBe(LICENSE_TOKEN_MAX_LENGTH);
    expect(
      errorCodeOf(() => {
        return LicenseToken.parse(atCap);
      }),
    ).not.toBe("too-large");
  });

  test.each([
    ["two segments", "a.b"],
    ["four segments", "a.b.c.d"],
    ["an empty segment", "a..c"],
    ["an empty token", ""],
    ["just dots", ".."],
  ])("refuses %s", (_label: string, token: string) => {
    expect(
      errorCodeOf(() => {
        return LicenseToken.parse(token);
      }),
    ).toBe("malformed");
  });

  test.each([
    ["padding", "="],
    ["a plus sign", "+"],
    ["a slash", "/"],
    ["a space", " "],
    ["a newline", "\n"],
    ["a non-ASCII character", "é"],
  ])("refuses a payload segment containing %s", (_label: string, extra: string) => {
    const segments: Array<string> = VALID_TOKEN.split(".");
    const token: string = replaceSegment(
      VALID_TOKEN,
      1,
      `${segments[1]}${extra}`,
    );

    expect(
      errorCodeOf(() => {
        return LicenseToken.parse(token);
      }),
    ).toBe("malformed");
  });

  test("refuses a trailing newline after the token", () => {
    expect(
      errorCodeOf(() => {
        return LicenseToken.parse(`${VALID_TOKEN}\n`);
      }),
    ).not.toBeNull();
  });

  test("refuses a header that is not JSON, not an object, or has no alg", () => {
    for (const header of [
      base64url("not json"),
      base64url(JSON.stringify(["EdDSA"])),
      base64url(JSON.stringify("EdDSA")),
      base64url(JSON.stringify({ typ: "JWT" })),
      base64url(JSON.stringify({ alg: 5 })),
    ]) {
      expect(
        errorCodeOf(() => {
          return LicenseToken.parse(replaceSegment(VALID_TOKEN, 0, header));
        }),
      ).toBe("malformed");
    }
  });

  test("refuses a non-canonical header encoding", () => {
    const header: string = VALID_TOKEN.split(".")[0] as string;
    // Flip unused low bits of the final character: same bytes, different text.
    const lastCharacter: string = header.slice(-1);
    const alphabet: string =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const alternatives: Array<string> = alphabet.split("").filter(
      (candidate: string): boolean => {
        return (
          candidate !== lastCharacter &&
          Buffer.from(`${header.slice(0, -1)}${candidate}`, "base64url").equals(
            Buffer.from(header, "base64url"),
          )
        );
      },
    );

    if (alternatives.length === 0) {
      // The header length leaves no spare bits; nothing to test for this key.
      return;
    }

    expect(
      errorCodeOf(() => {
        return LicenseToken.parse(
          replaceSegment(
            VALID_TOKEN,
            0,
            `${header.slice(0, -1)}${alternatives[0]}`,
          ),
        );
      }),
    ).toBe("malformed");
  });

  test.each(["none", "HS256", "RS256", "ES256", "eddsa", "EdDSA "])(
    "refuses alg %p",
    (alg: string) => {
      const token: string = craftToken({
        header: eddsaHeader(undefined, { alg }),
        payload: claimsFor() as unknown as Record<string, unknown>,
      });

      expect(
        errorCodeOf(() => {
          return LicenseToken.parse(token);
        }),
      ).toBe("unsupported-algorithm");
    },
  );

  test.each(["crit", "jku", "jwk", "x5u", "x5c"])(
    "refuses a header carrying %s",
    (parameter: string) => {
      const token: string = craftToken({
        header: eddsaHeader(undefined, { [parameter]: null }),
        payload: claimsFor() as unknown as Record<string, unknown>,
      });

      expect(
        errorCodeOf(() => {
          return LicenseToken.parse(token);
        }),
      ).toBe("forbidden-header");
    },
  );

  test.each([
    ["no kid", undefined],
    ["an empty kid", ""],
    ["a numeric kid", 7],
  ] as Array<[string, unknown]>)("refuses %s", (_label: string, kid: unknown) => {
    const header: Record<string, unknown> = eddsaHeader();

    if (kid === undefined) {
      delete header["kid"];
    } else {
      header["kid"] = kid;
    }

    const token: string = craftToken({
      header,
      payload: claimsFor() as unknown as Record<string, unknown>,
    });

    expect(
      errorCodeOf(() => {
        return LicenseToken.parse(token);
      }),
    ).toBe("missing-key-id");
  });

  test("refuses a payload that is not a JSON object", () => {
    for (const payload of ["[1,2,3]", '"licence"', "null", "{bad json"]) {
      expect(
        errorCodeOf(() => {
          return LicenseToken.parse(
            craftToken({ header: eddsaHeader(), payload }),
          );
        }),
      ).toBe("malformed");
    }
  });

  test("refuses a 65-byte signature", () => {
    const signature: string = Buffer.concat([
      Buffer.from(VALID_TOKEN.split(".")[2] as string, "base64url"),
      Buffer.from([0]),
    ]).toString("base64url");

    expect(
      errorCodeOf(() => {
        return LicenseToken.parse(replaceSegment(VALID_TOKEN, 2, signature));
      }),
    ).toBe("bad-signature-encoding");
  });

  test("refuses a 63-byte signature", () => {
    const signature: string = Buffer.from(
      VALID_TOKEN.split(".")[2] as string,
      "base64url",
    )
      .subarray(0, 63)
      .toString("base64url");

    expect(
      errorCodeOf(() => {
        return LicenseToken.parse(replaceSegment(VALID_TOKEN, 2, signature));
      }),
    ).toBe("bad-signature-encoding");
  });

  test.each(["A", "AA", "AAA", "_", "-"])(
    "refuses extra characters (%p) appended to the signature",
    (extra: string) => {
      expect(
        errorCodeOf(() => {
          return LicenseToken.parse(`${VALID_TOKEN}${extra}`);
        }),
      ).toBe("bad-signature-encoding");
    },
  );

  test("refuses a non-canonical final signature character", () => {
    const signature: string = VALID_TOKEN.split(".")[2] as string;
    const lastCharacter: string = signature.slice(-1);
    const alphabet: string =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const sameBytes: Array<string> = alphabet.split("").filter(
      (candidate: string): boolean => {
        return (
          candidate !== lastCharacter &&
          Buffer.from(
            `${signature.slice(0, -1)}${candidate}`,
            "base64url",
          ).equals(Buffer.from(signature, "base64url"))
        );
      },
    );

    // 64 bytes leave 4 unused bits in the last character.
    expect(sameBytes.length).toBeGreaterThan(0);

    expect(
      errorCodeOf(() => {
        return LicenseToken.parse(
          replaceSegment(
            VALID_TOKEN,
            2,
            `${signature.slice(0, -1)}${sameBytes[0]}`,
          ),
        );
      }),
    ).toBe("bad-signature-encoding");
  });

  test("decodeHeader recognises a legacy HS256 token without verifying it", () => {
    const decoded: ReturnType<typeof LicenseToken.decodeHeader> =
      LicenseToken.decodeHeader(legacyToken());

    expect(decoded.alg).toBe("HS256");
    expect(decoded.kid).toBeNull();
  });
});

describe("LicenseToken.validateClaims", () => {
  const validate: (
    overrides: Record<string, unknown>,
  ) => LicenseTokenErrorCode | null = (
    overrides: Record<string, unknown>,
  ): LicenseTokenErrorCode | null => {
    return errorCodeOf(() => {
      return LicenseToken.validateClaims({
        ...(claimsFor() as unknown as Record<string, unknown>),
        ...overrides,
      });
    });
  };

  test("accepts well-formed claims and normalises them", () => {
    expect(
      LicenseToken.validateClaims(
        claimsFor({ instanceId: LOCAL_INSTANCE_ID }) as unknown as Record<
          string,
          unknown
        >,
      ),
    ).toEqual(claimsFor({ instanceId: LOCAL_INSTANCE_ID }));
  });

  test.each([
    ["the wrong issuer", { iss: "https://evil.example.com" }],
    ["no issuer", { iss: undefined }],
    ["the wrong audience", { aud: "oneuptime-session" }],
    ["an audience list", { aud: [LICENSE_TOKEN_AUDIENCE] }],
    ["no license id", { sub: "" }],
    ["no license key", { licenseKey: "" }],
    ["a numeric company name", { companyName: 7 }],
    ["a negative user limit", { userLimit: -1 }],
    ["a string user limit", { userLimit: "50" }],
    ["a string evaluation flag", { isEvaluation: "false" }],
    ["features that are not a list", { features: "*" }],
    ["a non-string feature", { features: ["sso", 7] }],
    ["an empty instance id", { instanceId: "" }],
    ["a numeric instance id", { instanceId: 7 }],
    ["no expiry", { exp: undefined }],
    ["a string expiry", { exp: "2030-01-01" }],
  ] as Array<[string, Record<string, unknown>]>)(
    "rejects %s",
    (_label: string, overrides: Record<string, unknown>) => {
      expect(validate(overrides)).toBe("bad-claims");
    },
  );

  test.each([
    ["a null user limit (no seat limit)", { userLimit: null }],
    ["a zero user limit", { userLimit: 0 }],
    ["a missing iat", { iat: undefined }],
    ["an iat far in the future (clock skew is never fatal)", { iat: 4102444800 }],
    ["a string iat (informational only)", { iat: "yesterday" }],
    ["an nbf in the future (nbf is not used)", { nbf: 4102444800 }],
    ["an empty feature list", { features: [] }],
    ["unknown extra claims", { plan: "enterprise-plus" }],
  ] as Array<[string, Record<string, unknown>]>)(
    "accepts %s",
    (_label: string, overrides: Record<string, unknown>) => {
      expect(validate(overrides)).toBeNull();
    },
  );
});

describe("LicenseToken.toSnapshotFeatures", () => {
  test("the wildcard anywhere means every feature", () => {
    expect(LicenseToken.toSnapshotFeatures(["*"])).toBe("all");
    expect(LicenseToken.toSnapshotFeatures(["sso", "*"])).toBe("all");
  });

  test("a subset maps to features, ignoring names this build does not know", () => {
    expect(
      LicenseToken.toSnapshotFeatures([
        "sso",
        "scim",
        "future-feature",
        "sso",
      ]),
    ).toEqual([EnterpriseFeature.SSO, EnterpriseFeature.SCIM]);
    expect(LicenseToken.toSnapshotFeatures([])).toEqual([]);
  });
});

describe("TrustedLicenseKeys", () => {
  test("every production entry is an Ed25519 public key whose kid is its thumbprint", () => {
    const production: ReadonlyArray<TrustedLicenseKey> =
      getProductionTrustedLicenseKeys();
    const resolved: ResolvedTrustedLicenseKeys =
      resolveTrustedLicenseKeys(production);

    expect(resolved.problems).toEqual([]);
    expect(resolved.keys.size).toBe(production.length);

    for (const entry of production) {
      const publicKey: KeyObject = crypto.createPublicKey(entry.publicKeyPem);

      expect(publicKey.asymmetricKeyType).toBe("ed25519");
      expect(LicenseToken.computeKeyId(publicKey)).toBe(entry.kid);
      expect(entry.publicKeyPem).not.toContain("PRIVATE KEY");
    }
  });

  /*
   * The ceremony has shipped its first key, so this is no longer "must be
   * empty" but "must be exactly these". Trusting a key means every install
   * running this build accepts licenses signed with the matching private key,
   * so an addition has to be a deliberate, reviewed change to the list AND to
   * this line - an extra entry that slipped in unreviewed fails here.
   */
  test("trusts exactly the key ids the ceremony has shipped", () => {
    expect(
      getProductionTrustedLicenseKeys().map(
        (entry: TrustedLicenseKey): string => {
          return entry.kid;
        },
      ),
    ).toEqual(["vvbOO2N2qmM6A7D1L5NK7NHaAEauC42jGJcqO6mdLmM"]);
  });

  test("the key list module is pure data: it imports nothing and parses nothing at load", () => {
    const source: string = fs.readFileSync(
      path.join(__dirname, "../../../Server/License/TrustedLicenseKeys.ts"),
      "utf8",
    );

    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toContain("require(");
    expect(source).not.toContain("createPublicKey");
  });

  test("a malformed production list cannot break loading or classification", () => {
    const malformed: Array<TrustedLicenseKey> = [
      {
        kid: "broken",
        publicKeyPem:
          "-----BEGIN PUBLIC KEY-----\nnot a key at all\n-----END PUBLIC KEY-----\n",
      },
      { kid: "", publicKeyPem: "" },
    ];

    let classification: LicenseTokenClassification | null = null;

    jest.isolateModules(() => {
      jest.doMock("../../../Server/License/TrustedLicenseKeys", () => {
        return {
          __esModule: true,
          getProductionTrustedLicenseKeys: (): Array<TrustedLicenseKey> => {
            return malformed;
          },
          getTrustedLicenseKeys: (): Array<TrustedLicenseKey> => {
            return malformed;
          },
          setTrustedLicenseKeysForTests: (): void => {
            return undefined;
          },
        };
      });

      const isolatedLicenseToken: typeof import("../../../Server/License/LicenseToken") =
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        require("../../../Server/License/LicenseToken");
      const isolatedKeys: typeof import("../../../Server/License/TrustedLicenseKeys") =
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        require("../../../Server/License/TrustedLicenseKeys");

      classification = isolatedLicenseToken.classifyLicenseToken({
        token: LicenseToken.sign(claimsFor(), SIGNING_KEY.privateKey),
        storedColumns: { expiresAt: new Date(NOW.getTime() + DAY_IN_MS) },
        now: NOW,
        trustedKeys: isolatedKeys.getTrustedLicenseKeys(),
        localInstanceId: LOCAL_INSTANCE_ID,
        graceDays: GRACE_DAYS,
        trialDays: TRIAL_DAYS,
        acceptUnverified: true,
      });
    });

    jest.dontMock("../../../Server/License/TrustedLicenseKeys");

    expect(classification).not.toBeNull();
    expect(
      (classification as unknown as LicenseTokenClassification).verification,
    ).toBe("unverified");
  });

  test("the test-only setter replaces the list, and null restores production", () => {
    setTrustedLicenseKeysForTests([TRUSTED]);
    expect(getTrustedLicenseKeys()).toEqual([TRUSTED]);

    setTrustedLicenseKeysForTests(null);
    expect(getTrustedLicenseKeys()).toEqual(getProductionTrustedLicenseKeys());
  });

  test("the test-only setter refuses to run outside jest", () => {
    const workerId: string | undefined = process.env["JEST_WORKER_ID"];

    try {
      delete process.env["JEST_WORKER_ID"];

      expect(() => {
        setTrustedLicenseKeysForTests([TRUSTED]);
      }).toThrow("only be used from tests");
    } finally {
      if (workerId === undefined) {
        delete process.env["JEST_WORKER_ID"];
      } else {
        process.env["JEST_WORKER_ID"] = workerId;
      }
    }

    expect(getTrustedLicenseKeys()).toEqual(getProductionTrustedLicenseKeys());
  });
});

describe("resolveTrustedLicenseKeys", () => {
  test("resolves a good entry", () => {
    const resolved: ResolvedTrustedLicenseKeys = resolveTrustedLicenseKeys([
      TRUSTED,
    ]);

    expect(resolved.problems).toEqual([]);
    expect(resolved.keys.get(TRUSTED.kid)?.asymmetricKeyType).toBe("ed25519");
  });

  test("skips malformed PEMs, wrong key types, kid mismatches and private keys without throwing", () => {
    const ecPublicPem: string = publicPem(
      crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey,
    );
    const privatePem: string = SIGNING_KEY.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();

    const resolved: ResolvedTrustedLicenseKeys = resolveTrustedLicenseKeys([
      { kid: "malformed", publicKeyPem: "-----BEGIN PUBLIC KEY-----\nAAAA\n" },
      { kid: "garbage", publicKeyPem: "garbage" },
      { kid: "ec", publicKeyPem: ecPublicPem },
      { kid: "wrong-kid", publicKeyPem: TRUSTED.publicKeyPem },
      { kid: TRUSTED.kid, publicKeyPem: privatePem },
      trustedEntry(OTHER_KEY),
    ]);

    expect(
      resolved.problems.map((problem: { kid: string }) => {
        return problem.kid;
      }),
    ).toEqual(["malformed", "garbage", "ec", "wrong-kid", TRUSTED.kid]);
    expect([...resolved.keys.keys()]).toEqual([trustedEntry(OTHER_KEY).kid]);
  });
});

describe("classifyLicenseToken: no token", () => {
  test.each([null, undefined, ""] as Array<string | null | undefined>)(
    "a missing token (%p) is missing",
    (token: string | null | undefined) => {
      const result: LicenseTokenClassification = classify({ token });

      expect(result).toMatchObject({
        status: "missing",
        verification: "none",
        reason: "no-token",
        userLimit: null,
        features: [],
      });
      expect(result.graceReason).toBeUndefined();
    },
  );

  test("an unlicensed Enterprise install is on trial for 14 days from first seen, not for the 30-day grace", () => {
    const firstSeen: Date = new Date(NOW.getTime() - 3 * DAY_IN_MS);
    const result: LicenseTokenClassification = classify({
      token: null,
      storedColumns: { enterpriseEditionFirstSeenAt: firstSeen },
    });

    expect(result).toMatchObject({
      status: "grace",
      verification: "none",
      graceReason: "unlicensed",
      features: "all",
      reason: "unlicensed-grace",
    });
    expect(result.graceEndsAt).toEqual(
      new Date(firstSeen.getTime() + 14 * DAY_IN_MS),
    );
    expect(result.message).toContain("14-day trial");
    expect(result.message).not.toContain("grace");
  });

  test("the unlicensed trial includes its last millisecond and ends right after", () => {
    const lastMoment: LicenseTokenClassification = classify({
      token: null,
      storedColumns: {
        enterpriseEditionFirstSeenAt: new Date(NOW.getTime() - 14 * DAY_IN_MS),
      },
    });
    const justAfter: LicenseTokenClassification = classify({
      token: null,
      storedColumns: {
        enterpriseEditionFirstSeenAt: new Date(
          NOW.getTime() - 14 * DAY_IN_MS - 1,
        ),
      },
    });

    expect(lastMoment.status).toBe("grace");
    expect(justAfter).toMatchObject({
      status: "missing",
      reason: "unlicensed-grace-over",
      features: [],
    });
    expect(justAfter.graceEndsAt).toEqual(new Date(NOW.getTime() - 1));
  });

  test("an unparseable first-seen date is ignored", () => {
    expect(
      classify({
        token: null,
        storedColumns: { enterpriseEditionFirstSeenAt: new Date("not a date") },
      }).reason,
    ).toBe("no-token");
  });

  test("an unlicensed install is still on trial at first seen + 13 days 23 hours 59 minutes", () => {
    const firstSeen: Date = new Date(NOW.getTime() - 20 * DAY_IN_MS);
    const at: (offsetInMs: number) => LicenseTokenClassification = (
      offsetInMs: number,
    ): LicenseTokenClassification => {
      return classify({
        token: null,
        now: new Date(firstSeen.getTime() + offsetInMs),
        storedColumns: { enterpriseEditionFirstSeenAt: firstSeen },
      });
    };

    expect(at(14 * DAY_IN_MS - MINUTE_IN_MS)).toMatchObject({
      status: "grace",
      graceReason: "unlicensed",
      reason: "unlicensed-grace",
    });
    // Inclusive of its last moment, like the grace period.
    expect(at(14 * DAY_IN_MS).status).toBe("grace");
    expect(at(14 * DAY_IN_MS + 1)).toMatchObject({
      status: "missing",
      reason: "unlicensed-grace-over",
      features: [],
    });
    // Nowhere near the 30 days an expired license gets.
    expect(at(29 * DAY_IN_MS).status).toBe("missing");
  });

  test("the trial length follows trialDays, and graceDays does not touch it", () => {
    const firstSeen: Date = new Date(NOW.getTime() - 20 * DAY_IN_MS);

    expect(
      classify({
        token: null,
        trialDays: 30,
        graceDays: 14,
        storedColumns: { enterpriseEditionFirstSeenAt: firstSeen },
      }).status,
    ).toBe("grace");
    expect(
      classify({
        token: null,
        trialDays: 14,
        graceDays: 30,
        storedColumns: { enterpriseEditionFirstSeenAt: firstSeen },
      }).status,
    ).toBe("missing");
  });
});

describe("classifyLicenseToken: verified tokens", () => {
  test("a current signed license is valid, with everything taken from the claims", () => {
    const result: LicenseTokenClassification = classify({
      token: LicenseToken.sign(
        claimsFor({ userLimit: 25, isEvaluation: true, companyName: "Signed Co" }),
        SIGNING_KEY.privateKey,
      ),
      // Deliberately contradicting columns: a verified token ignores them.
      storedColumns: {
        expiresAt: new Date(NOW.getTime() - 400 * DAY_IN_MS),
        companyName: "Column Co",
        userLimit: 9999,
        isEvaluation: false,
      },
    });

    expect(result).toMatchObject({
      status: "valid",
      verification: "verified",
      reason: "verified",
      companyName: "Signed Co",
      userLimit: 25,
      isEvaluation: true,
      features: "all",
      kid: TRUSTED.kid,
      licenseId: "license-0001",
    });
    expect(result.expiresAt).toEqual(
      new Date((NOW_IN_SECONDS + (30 * DAY_IN_MS) / 1000) * 1000),
    );
    expect(result.graceReason).toBeUndefined();
    expect(result.graceEndsAt).toBeUndefined();
  });

  test("a subset license lists only its known features", () => {
    const result: LicenseTokenClassification = classify({
      token: LicenseToken.sign(
        claimsFor({ features: ["sso", "audit-logs", "quantum-monitoring"] }),
        SIGNING_KEY.privateKey,
      ),
    });

    expect(result.features).toEqual([
      EnterpriseFeature.SSO,
      EnterpriseFeature.AuditLogs,
    ]);
  });

  test("expiry: valid before exp, grace from exp through exp + 30 days, expired after", () => {
    const tokenExpiringAt: (expiresAt: Date) => string = (
      expiresAt: Date,
    ): string => {
      return LicenseToken.sign(
        claimsFor({ exp: Math.floor(expiresAt.getTime() / 1000) }),
        SIGNING_KEY.privateKey,
      );
    };

    const oneSecond: number = 1000;

    expect(
      classify({ token: tokenExpiringAt(new Date(NOW.getTime() + oneSecond)) })
        .status,
    ).toBe("valid");

    const atExpiry: LicenseTokenClassification = classify({
      token: tokenExpiringAt(NOW),
    });
    expect(atExpiry).toMatchObject({ status: "grace", graceReason: "expired" });
    expect(atExpiry.graceEndsAt).toEqual(
      new Date(NOW.getTime() + 30 * DAY_IN_MS),
    );

    expect(
      classify({
        token: tokenExpiringAt(new Date(NOW.getTime() - 30 * DAY_IN_MS)),
      }).status,
    ).toBe("grace");

    const expired: LicenseTokenClassification = classify({
      token: tokenExpiringAt(
        new Date(NOW.getTime() - 30 * DAY_IN_MS - oneSecond),
      ),
    });
    expect(expired.status).toBe("expired");
    expect(expired.verification).toBe("verified");
    expect(expired.graceReason).toBeUndefined();
    expect(expired.graceEndsAt).toEqual(new Date(NOW.getTime() - oneSecond));
  });

  test("an expired license is still in grace at expiry + 29 days 23 hours 59 minutes, and expired just after expiry + 30 days", () => {
    const expiresAt: Date = new Date(NOW.getTime() - 60 * DAY_IN_MS);
    const token: string = LicenseToken.sign(
      claimsFor({
        iat: Math.floor(expiresAt.getTime() / 1000) - 365 * 24 * 60 * 60,
        exp: Math.floor(expiresAt.getTime() / 1000),
      }),
      SIGNING_KEY.privateKey,
    );
    const at: (offsetInMs: number) => LicenseTokenClassification = (
      offsetInMs: number,
    ): LicenseTokenClassification => {
      return classify({
        token,
        now: new Date(expiresAt.getTime() + offsetInMs),
      });
    };

    expect(at(-1).status).toBe("valid");
    expect(at(14 * DAY_IN_MS + 1)).toMatchObject({
      status: "grace",
      graceReason: "expired",
    });
    expect(at(30 * DAY_IN_MS - MINUTE_IN_MS)).toMatchObject({
      status: "grace",
      graceReason: "expired",
    });
    // judgeExpiry: in grace up to and including expiresAt + graceDays.
    expect(at(30 * DAY_IN_MS).status).toBe("grace");

    const justAfter: LicenseTokenClassification = at(30 * DAY_IN_MS + 1);
    expect(justAfter.status).toBe("expired");
    expect(justAfter.graceEndsAt).toEqual(
      new Date(expiresAt.getTime() + 30 * DAY_IN_MS),
    );
  });

  test("the grace length follows graceDays, and trialDays does not touch it", () => {
    const token: string = LicenseToken.sign(
      claimsFor({ exp: NOW_IN_SECONDS - (20 * DAY_IN_MS) / 1000 }),
      SIGNING_KEY.privateKey,
    );

    expect(
      classify({ token, graceDays: 30, trialDays: 14 }).status,
    ).toBe("grace");
    expect(
      classify({ token, graceDays: 14, trialDays: 30 }).status,
    ).toBe("expired");
  });

  test("the same token moves valid -> grace -> expired as time passes", () => {
    const token: string = LicenseToken.sign(claimsFor(), SIGNING_KEY.privateKey);

    expect(
      [0, 31, 59, 61].map((days: number): string => {
        return classify({
          token,
          now: new Date(NOW.getTime() + days * DAY_IN_MS),
        }).status;
      }),
    ).toEqual(["valid", "grace", "grace", "expired"]);
  });

  test("a license bound to this instance is valid", () => {
    expect(
      classify({
        token: LicenseToken.sign(
          claimsFor({ instanceId: LOCAL_INSTANCE_ID }),
          SIGNING_KEY.privateKey,
        ),
      }),
    ).toMatchObject({ status: "valid", instanceId: LOCAL_INSTANCE_ID });
  });

  test("a license bound to another instance is invalid", () => {
    expect(
      classify({
        token: LicenseToken.sign(
          claimsFor({ instanceId: "another-instance" }),
          SIGNING_KEY.privateKey,
        ),
      }),
    ).toMatchObject({
      status: "invalid",
      verification: "verified",
      reason: "instance-mismatch",
      instanceId: "another-instance",
      features: [],
    });
  });

  test("a bound license on an instance whose id is unknown is invalid", () => {
    for (const localInstanceId of [null, undefined, ""]) {
      expect(
        classify({
          localInstanceId,
          token: LicenseToken.sign(
            claimsFor({ instanceId: LOCAL_INSTANCE_ID }),
            SIGNING_KEY.privateKey,
          ),
        }).reason,
      ).toBe("instance-mismatch");
    }
  });

  test("an unbound license is valid on any instance", () => {
    expect(classify({ localInstanceId: null }).status).toBe("valid");
    expect(classify({ localInstanceId: "any" }).status).toBe("valid");
  });

  test("a trusted list with a malformed entry still verifies with the good key", () => {
    expect(
      classify({
        trustedKeys: [
          { kid: "broken", publicKeyPem: "not a pem" },
          TRUSTED,
        ],
      }).verification,
    ).toBe("verified");
  });
});

describe("classifyLicenseToken: tampering against a trusted key is invalid", () => {
  const signed: string = LicenseToken.sign(claimsFor(), SIGNING_KEY.privateKey);

  test("a raised user limit (payload edited, signature kept)", () => {
    const tamperedPayload: string = base64url(
      JSON.stringify(claimsFor({ userLimit: 100000 })),
    );

    expect(
      classify({ token: replaceSegment(signed, 1, tamperedPayload) }),
    ).toMatchObject({
      status: "invalid",
      verification: "verified",
      reason: "bad-signature",
      userLimit: null,
      features: [],
    });
  });

  test("a pushed-out expiry", () => {
    const tamperedPayload: string = base64url(
      JSON.stringify(claimsFor({ exp: 4102444800 })),
    );

    expect(
      classify({ token: replaceSegment(signed, 1, tamperedPayload) }).reason,
    ).toBe("bad-signature");
  });

  test("an edited header", () => {
    const tamperedHeader: string = base64url(
      JSON.stringify(eddsaHeader(undefined, { typ: "LICENSE" })),
    );

    expect(
      classify({ token: replaceSegment(signed, 0, tamperedHeader) }).reason,
    ).toBe("bad-signature");
  });

  test("a token signed by another key that claims the trusted kid", () => {
    const forged: string = craftToken({
      header: eddsaHeader(SIGNING_KEY),
      payload: claimsFor() as unknown as Record<string, unknown>,
      privateKey: OTHER_KEY.privateKey,
    });

    expect(classify({ token: forged })).toMatchObject({
      status: "invalid",
      reason: "bad-signature",
    });
  });

  test("a zeroed signature", () => {
    expect(
      classify({
        token: replaceSegment(
          signed,
          2,
          Buffer.alloc(64).toString("base64url"),
        ),
      }).reason,
    ).toBe("bad-signature");
  });

  test.each([
    ["the wrong audience", { aud: "oneuptime-session" }],
    ["the wrong issuer", { iss: "https://licenses.example.com" }],
    ["no expiry", { exp: undefined }],
    ["no license key", { licenseKey: undefined }],
  ] as Array<[string, Record<string, unknown>]>)(
    "a correctly signed token with %s",
    (_label: string, overrides: Record<string, unknown>) => {
      const token: string = craftToken({
        header: eddsaHeader(),
        payload: {
          ...(claimsFor() as unknown as Record<string, unknown>),
          ...overrides,
        },
      });

      expect(classify({ token })).toMatchObject({
        status: "invalid",
        verification: "verified",
        reason: "bad-claims",
      });
    },
  );

  test("a 65-byte signature, trailing characters and a huge token are malformed", () => {
    const longSignature: string = Buffer.concat([
      Buffer.from(signed.split(".")[2] as string, "base64url"),
      Buffer.from([1]),
    ]).toString("base64url");

    for (const token of [
      replaceSegment(signed, 2, longSignature),
      `${signed}A`,
      `${signed}.extra`,
      `${signed.slice(0, -2)}${"A".repeat(LICENSE_TOKEN_MAX_LENGTH)}`,
    ]) {
      expect(classify({ token })).toMatchObject({
        status: "invalid",
        reason: "malformed",
        features: [],
      });
    }
  });

  test.each(["x", "a.b.c", "not.a.token!", "eyJ.eyJ.sig", " "])(
    "garbage (%p) is malformed, never unverified",
    (token: string) => {
      expect(classify({ token })).toMatchObject({
        status: "invalid",
        verification: "none",
        reason: "malformed",
      });
    },
  );

  test.each(["none", "RS256", "ES256"])(
    "alg %p is refused, even with a trusted kid",
    (alg: string) => {
      const token: string = craftToken({
        header: eddsaHeader(undefined, { alg }),
        payload: claimsFor() as unknown as Record<string, unknown>,
        signature: alg === "none" ? "AA" : undefined,
      });

      expect(classify({ token })).toMatchObject({
        status: "invalid",
        reason: "unsupported-algorithm",
      });
    },
  );

  test("a trusted-kid token with a jku header is malformed", () => {
    const token: string = craftToken({
      header: eddsaHeader(undefined, { jku: "https://evil.example.com/keys" }),
      payload: claimsFor() as unknown as Record<string, unknown>,
    });

    expect(classify({ token }).reason).toBe("malformed");
  });
});

describe("classifyLicenseToken: unverified tokens", () => {
  const untrustedToken: string = LicenseToken.sign(
    claimsFor({ userLimit: 5, companyName: "Claimed Co" }),
    OTHER_KEY.privateKey,
  );
  const futureColumns: ClassifyLicenseTokenInput["storedColumns"] = {
    expiresAt: new Date(NOW.getTime() + 100 * DAY_IN_MS),
    companyName: "Column Co",
    userLimit: 30,
    isEvaluation: true,
  };

  test("an unknown kid is unverified and takes its limits from the stored columns", () => {
    expect(
      classify({ token: untrustedToken, storedColumns: futureColumns }),
    ).toMatchObject({
      status: "valid",
      verification: "unverified",
      reason: "unverified",
      companyName: "Column Co",
      userLimit: 30,
      isEvaluation: true,
      features: "all",
      kid: LicenseToken.computeKeyId(OTHER_KEY.publicKey),
    });
  });

  test("with no trusted keys at all (the state at merge), every signed token is unverified", () => {
    expect(
      classify({
        token: LicenseToken.sign(claimsFor(), SIGNING_KEY.privateKey),
        trustedKeys: [],
        storedColumns: futureColumns,
      }).verification,
    ).toBe("unverified");
  });

  test("a legacy HS256 token is unverified", () => {
    expect(
      classify({ token: legacyToken(), storedColumns: futureColumns }),
    ).toMatchObject({
      status: "valid",
      verification: "unverified",
      reason: "unverified",
    });
  });

  test("a legacy HS256 token with a forged payload is still only unverified (limits never come from it)", () => {
    const result: LicenseTokenClassification = classify({
      token: legacyToken({ userLimit: 100000, exp: 4102444800 }),
      storedColumns: futureColumns,
    });

    expect(result.userLimit).toBe(30);
    expect(result.expiresAt).toEqual(futureColumns.expiresAt);
  });

  test("unverified expiry uses the stored column with the same 30-day grace", () => {
    const at: (daysAgo: number) => LicenseTokenClassification = (
      daysAgo: number,
    ): LicenseTokenClassification => {
      return classify({
        token: legacyToken(),
        storedColumns: {
          expiresAt: new Date(NOW.getTime() - daysAgo * DAY_IN_MS),
        },
      });
    };

    expect(at(3)).toMatchObject({
      status: "grace",
      graceReason: "expired",
      verification: "unverified",
    });
    expect(at(14).status).toBe("grace");
    expect(at(15).status).toBe("grace");
    expect(at(29).status).toBe("grace");
    expect(at(30).status).toBe("grace");
    expect(at(31).status).toBe("expired");
  });

  test("an unverified legacy license gets 30 days of grace, to the millisecond", () => {
    const expiresAt: Date = new Date(NOW.getTime() - 60 * DAY_IN_MS);
    const at: (offsetInMs: number) => LicenseTokenClassification = (
      offsetInMs: number,
    ): LicenseTokenClassification => {
      return classify({
        token: legacyToken(),
        now: new Date(expiresAt.getTime() + offsetInMs),
        storedColumns: { expiresAt },
      });
    };

    expect(at(30 * DAY_IN_MS - MINUTE_IN_MS)).toMatchObject({
      status: "grace",
      graceReason: "expired",
      verification: "unverified",
    });
    expect(at(30 * DAY_IN_MS).status).toBe("grace");
    expect(at(30 * DAY_IN_MS + 1)).toMatchObject({
      status: "expired",
      verification: "unverified",
    });
    expect(at(30 * DAY_IN_MS + 1).graceEndsAt).toEqual(
      new Date(expiresAt.getTime() + 30 * DAY_IN_MS),
    );
  });

  test("when unverified licenses are no longer accepted, they are invalid", () => {
    for (const token of [legacyToken(), untrustedToken]) {
      expect(
        classify({
          token,
          storedColumns: futureColumns,
          acceptUnverified: false,
        }),
      ).toMatchObject({
        status: "invalid",
        verification: "unverified",
        reason: "unverified-not-accepted",
      });
    }
  });

  test("turning legacy acceptance off never affects verified tokens", () => {
    expect(
      classify({ acceptUnverified: false }).verification,
    ).toBe("verified");
  });
});

/*
 * The regression this block exists for.
 *
 * An installation can hold a license TOKEN with no EXPIRY recorded beside it:
 * EnterpriseLicenseSync writes the two columns under independent presence
 * checks, and activation (LicenseClient.mapValidationResponse) writes the
 * token next to a null expiry when the response carried no expiresAt. That
 * state used to classify "invalid", which is not usable, so SSO, SCIM and
 * audit logging stopped the moment such an install upgraded - no trial, no
 * grace - for a customer whose paid license may be perfectly good.
 *
 * It is now treated exactly as an install with no license at all: the trial
 * counted from enterpriseEditionFirstSeenAt, then the same lapse, so the
 * outcome is a countdown instead of a cliff. If this regresses, an Enterprise
 * install with a mis-mirrored license loses single sign-on on upgrade.
 */
describe("classifyLicenseToken: an unverified token with no recorded expiry", () => {
  const FIRST_SEEN: Date = new Date(NOW.getTime() - 3 * DAY_IN_MS);
  const UNKNOWN_KID_TOKEN: string = LicenseToken.sign(
    claimsFor(),
    OTHER_KEY.privateKey,
  );

  /*
   * Every shape a stored expiry can be absent in. LicenseInputs normalises ""
   * and an unparseable string to null before the classifier sees them, but
   * the classifier must not depend on that: it is called directly from tests,
   * from LicenseRanking and (through LicenseInputsUtil.withUpdate) on values
   * that came straight off a license-server response.
   */
  const ABSENT_EXPIRIES: Array<[string, unknown]> = [
    ["null", null],
    ["undefined", undefined],
    ["an empty string", ""],
    ["an unparseable string", "the first of never"],
    ["an invalid Date", new Date("nope")],
  ];

  const classifyWithoutExpiry: (
    expiresAt: unknown,
    overrides?: Partial<ClassifyLicenseTokenInput>,
  ) => LicenseTokenClassification = (
    expiresAt: unknown,
    overrides?: Partial<ClassifyLicenseTokenInput>,
  ): LicenseTokenClassification => {
    return classify({
      token: legacyToken(),
      storedColumns: {
        expiresAt: expiresAt as Date | null | undefined,
        companyName: "Acme Inc",
        userLimit: 25,
        isEvaluation: true,
        enterpriseEditionFirstSeenAt: FIRST_SEEN,
      },
      ...(overrides || {}),
    });
  };

  /*
   * Everything except how the state is DIAGNOSED. verification and reason are
   * meant to differ from an unlicensed install's (a token IS installed here),
   * and the message names the problem; every other field must match.
   */
  const comparableFields: (
    classification: LicenseTokenClassification,
  ) => Record<string, unknown> = (
    classification: LicenseTokenClassification,
  ): Record<string, unknown> => {
    const fields: Record<string, unknown> = {
      ...(classification as unknown as Record<string, unknown>),
    };

    delete fields["verification"];
    delete fields["reason"];
    delete fields["message"];
    delete fields["kid"];

    return fields;
  };

  test.each(ABSENT_EXPIRIES)(
    "with %s for an expiry it is the unlicensed trial, not a lock-out",
    (_label: string, expiresAt: unknown) => {
      const result: LicenseTokenClassification =
        classifyWithoutExpiry(expiresAt);

      expect(result).toMatchObject({
        status: "grace",
        verification: "unverified",
        graceReason: "unlicensed",
        features: "all",
        reason: "unverified-without-expiry-unlicensed",
        // The trial's terms, not the stored columns' - exactly as unlicensed.
        userLimit: null,
        isEvaluation: false,
      });
      expect(result.graceEndsAt).toEqual(
        new Date(FIRST_SEEN.getTime() + TRIAL_DAYS * DAY_IN_MS),
      );
      expect(result.expiresAt).toBeUndefined();
    },
  );

  test("the message names the problem and what a master admin can do about it", () => {
    const message: string = String(classifyWithoutExpiry(null).message);

    expect(message).toContain("no expiry is recorded for it");
    expect(message).toContain("re-activate the license");
    expect(message).toContain("daily license sync");
    expect(message).toContain(`${TRIAL_DAYS}-day trial`);
    // Not an expired license: nobody should be told to renew one.
    expect(message).not.toContain("has expired");
  });

  test("an EdDSA token signed by an unknown key behaves the same way", () => {
    const result: LicenseTokenClassification = classifyWithoutExpiry(null, {
      token: UNKNOWN_KID_TOKEN,
    });

    expect(result).toMatchObject({
      status: "grace",
      verification: "unverified",
      reason: "unverified-without-expiry-unlicensed",
      kid: LicenseToken.computeKeyId(OTHER_KEY.publicKey),
    });
    expect(result.message).toContain("a key this build does not know");
  });

  test("the trial runs from first seen for trialDays, inclusive of its last moment", () => {
    const at: (offsetInMs: number) => LicenseTokenClassification = (
      offsetInMs: number,
    ): LicenseTokenClassification => {
      return classifyWithoutExpiry(null, {
        now: new Date(FIRST_SEEN.getTime() + offsetInMs),
      });
    };

    expect(
      at(TRIAL_DAYS * DAY_IN_MS - DAY_IN_MS - MINUTE_IN_MS),
    ).toMatchObject({
      status: "grace",
      graceReason: "unlicensed",
      reason: "unverified-without-expiry-unlicensed",
    });
    expect(at(TRIAL_DAYS * DAY_IN_MS - MINUTE_IN_MS).status).toBe("grace");
    // The same inclusive boundary classifyMissingToken uses.
    expect(at(TRIAL_DAYS * DAY_IN_MS).status).toBe("grace");
    expect(at(TRIAL_DAYS * DAY_IN_MS + 1)).toMatchObject({
      status: "missing",
      features: [],
      reason: "unverified-without-expiry-unlicensed",
    });
    // It is the trial, not the 30 days of grace an expired license gets.
    expect(at(GRACE_DAYS * DAY_IN_MS - DAY_IN_MS).status).toBe("missing");
  });

  test("after the trial it is field-for-field an unlicensed install, bar the diagnosis", () => {
    const now: Date = new Date(
      FIRST_SEEN.getTime() + TRIAL_DAYS * DAY_IN_MS + DAY_IN_MS,
    );
    const columns: ClassifyLicenseTokenInput["storedColumns"] = {
      expiresAt: null,
      companyName: "Acme Inc",
      userLimit: 25,
      isEvaluation: true,
      enterpriseEditionFirstSeenAt: FIRST_SEEN,
    };
    const lapsed: LicenseTokenClassification = classify({
      token: legacyToken(),
      storedColumns: columns,
      now,
    });
    const unlicensed: LicenseTokenClassification = classify({
      token: null,
      storedColumns: columns,
      now,
    });

    expect(lapsed.status).toBe("missing");
    expect(lapsed.features).toEqual([]);
    expect(comparableFields(lapsed)).toEqual(comparableFields(unlicensed));
    // Only the diagnosis differs, and it must.
    expect(lapsed.verification).toBe("unverified");
    expect(unlicensed.verification).toBe("none");
    expect(lapsed.reason).toBe("unverified-without-expiry-unlicensed");
    expect(unlicensed.reason).toBe("unlicensed-grace-over");
  });

  test("during the trial it is field-for-field an unlicensed install, bar the diagnosis", () => {
    const columns: ClassifyLicenseTokenInput["storedColumns"] = {
      expiresAt: undefined,
      enterpriseEditionFirstSeenAt: FIRST_SEEN,
    };

    expect(
      comparableFields(
        classify({ token: legacyToken(), storedColumns: columns }),
      ),
    ).toEqual(
      comparableFields(classify({ token: null, storedColumns: columns })),
    );
  });

  /*
   * The two states the brief insists stay apart: "the trial ended" carries a
   * graceEndsAt, "the first-run stamp was never written" does not, and
   * EnterpriseLicenseSnapshotUtil.isTrialStartUnknown reads exactly that
   * difference to fail open. Collapsing them would turn a fail-open state
   * into a lapse.
   */
  test("with no first-seen stamp it is the UNKNOWN trial-start state, not a lapse", () => {
    const unknownStart: LicenseTokenClassification = classify({
      token: legacyToken(),
      storedColumns: { expiresAt: null },
    });
    const lapsed: LicenseTokenClassification = classifyWithoutExpiry(null, {
      now: new Date(FIRST_SEEN.getTime() + (TRIAL_DAYS + 1) * DAY_IN_MS),
    });

    expect(unknownStart).toMatchObject({
      status: "missing",
      verification: "unverified",
      reason: "unverified-without-expiry-unlicensed",
      features: [],
    });
    expect(unknownStart.graceEndsAt).toBeUndefined();
    expect(EnterpriseLicenseSnapshotUtil.isTrialStartUnknown(unknownStart)).toBe(
      true,
    );

    expect(lapsed.graceEndsAt).toBeDefined();
    expect(EnterpriseLicenseSnapshotUtil.isTrialStartUnknown(lapsed)).toBe(
      false,
    );
  });

  test("the whole trial is usable, and the lapse is not", () => {
    expect(
      EnterpriseLicenseSnapshotUtil.isUsable(classifyWithoutExpiry(null)),
    ).toBe(true);
    expect(
      EnterpriseLicenseSnapshotUtil.isUsable(
        classifyWithoutExpiry(null, {
          now: new Date(FIRST_SEEN.getTime() + (TRIAL_DAYS + 1) * DAY_IN_MS),
        }),
      ),
    ).toBe(false);
  });

  /*
   * The announced sunset of unverified licenses is NOT softened by any of
   * this. If this regresses, turning the switch off would stop refusing the
   * licenses it exists to refuse.
   */
  test.each(ABSENT_EXPIRIES)(
    "with acceptUnverified off and %s for an expiry it is still invalid",
    (_label: string, expiresAt: unknown) => {
      for (const token of [legacyToken(), UNKNOWN_KID_TOKEN]) {
        expect(
          classifyWithoutExpiry(expiresAt, { token, acceptUnverified: false }),
        ).toMatchObject({
          status: "invalid",
          verification: "unverified",
          reason: "unverified-not-accepted",
          features: [],
        });
      }
    },
  );

  /*
   * The neighbouring behaviours this must not have touched.
   */
  test("an unverified token WITH a stored expiry is unchanged: valid, 30 days of grace, then expired", () => {
    const expiresAt: Date = new Date(NOW.getTime() - 60 * DAY_IN_MS);
    const at: (offsetInMs: number) => LicenseTokenClassification = (
      offsetInMs: number,
    ): LicenseTokenClassification => {
      return classify({
        token: legacyToken(),
        now: new Date(expiresAt.getTime() + offsetInMs),
        storedColumns: {
          expiresAt,
          userLimit: 25,
          enterpriseEditionFirstSeenAt: FIRST_SEEN,
        },
      });
    };

    expect(at(-1)).toMatchObject({
      status: "valid",
      verification: "unverified",
      reason: "unverified",
      userLimit: 25,
    });
    expect(at(0)).toMatchObject({ status: "grace", graceReason: "expired" });
    expect(at(GRACE_DAYS * DAY_IN_MS).status).toBe("grace");
    expect(at(GRACE_DAYS * DAY_IN_MS + 1)).toMatchObject({
      status: "expired",
      verification: "unverified",
      reason: "unverified",
    });
    // Never the trial: a license with an expiry is judged by it.
    expect(at(GRACE_DAYS * DAY_IN_MS + 1).graceReason).toBeUndefined();
  });

  test("a VERIFIED token takes its expiry from its claims, stored columns absent or not", () => {
    const signed: string = LicenseToken.sign(
      claimsFor({ userLimit: 7, companyName: "Signed Co" }),
      SIGNING_KEY.privateKey,
    );

    expect(
      classify({
        token: signed,
        storedColumns: {
          expiresAt: null,
          enterpriseEditionFirstSeenAt: new Date(
            NOW.getTime() - 400 * DAY_IN_MS,
          ),
        },
      }),
    ).toMatchObject({
      status: "valid",
      verification: "verified",
      reason: "verified",
      userLimit: 7,
      companyName: "Signed Co",
    });
  });

  /*
   * Pinned, not endorsed: a signed token whose claims carry no exp fails
   * claim validation, so it is invalid/verified - it never reaches the stored
   * columns and never falls back to the trial. If that ever changes it should
   * be a decision, not a side effect.
   */
  test("a verified token whose claims carry no expiry stays bad-claims", () => {
    const token: string = craftToken({
      header: eddsaHeader(),
      payload: {
        ...(claimsFor() as unknown as Record<string, unknown>),
        exp: undefined,
      },
    });

    expect(
      classify({
        token,
        storedColumns: { enterpriseEditionFirstSeenAt: FIRST_SEEN },
      }),
    ).toMatchObject({
      status: "invalid",
      verification: "verified",
      reason: "bad-claims",
      features: [],
    });
  });

  test("a token bound to another instance is still invalid, expiry or no expiry", () => {
    expect(
      classifyWithoutExpiry(null, {
        token: LicenseToken.sign(
          claimsFor({ instanceId: "another-instance" }),
          SIGNING_KEY.privateKey,
        ),
      }),
    ).toMatchObject({
      status: "invalid",
      verification: "verified",
      reason: "instance-mismatch",
    });
  });

  test("garbage in the token column is still malformed, never the trial", () => {
    for (const token of [
      "x",
      "not.a.token!",
      " ",
      // An EdDSA token whose signature is no longer canonical base64url.
      `${UNKNOWN_KID_TOKEN}A`,
    ]) {
      expect(classifyWithoutExpiry(null, { token })).toMatchObject({
        status: "invalid",
        reason: "malformed",
      });
    }
  });

  test("the trial here follows trialDays, and graceDays does not touch it", () => {
    const at: (
      periods: { graceDays: number; trialDays: number },
      offsetInDays: number,
    ) => string = (
      periods: { graceDays: number; trialDays: number },
      offsetInDays: number,
    ): string => {
      return classifyWithoutExpiry(null, {
        ...periods,
        now: new Date(FIRST_SEEN.getTime() + offsetInDays * DAY_IN_MS),
      }).status;
    };

    expect(at({ graceDays: GRACE_DAYS, trialDays: TRIAL_DAYS }, 20)).toBe(
      "missing",
    );
    expect(at({ graceDays: TRIAL_DAYS, trialDays: GRACE_DAYS }, 20)).toBe(
      "grace",
    );
  });
});

describe("classifyLicenseToken is pure", () => {
  test("the same input gives the same output and is not mutated", () => {
    const input: ClassifyLicenseTokenInput = {
      token: LicenseToken.sign(claimsFor(), SIGNING_KEY.privateKey),
      storedColumns: { expiresAt: new Date(NOW.getTime() + DAY_IN_MS) },
      now: new Date(NOW.getTime()),
      trustedKeys: [TRUSTED],
      localInstanceId: LOCAL_INSTANCE_ID,
      graceDays: GRACE_DAYS,
      trialDays: TRIAL_DAYS,
      acceptUnverified: true,
    };
    const snapshot: string = JSON.stringify(input);

    expect(classifyLicenseToken(input)).toEqual(classifyLicenseToken(input));
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  test("it reads the trusted keys it is given, not the module's list", () => {
    setTrustedLicenseKeysForTests([]);

    expect(classify({ trustedKeys: [TRUSTED] }).verification).toBe(
      "verified",
    );
  });
});

describe("the grace period and the trial are two constants", () => {
  test("30 days of grace after a license expires, a 14-day trial for an install with no license", () => {
    expect(ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS).toBe(GRACE_DAYS);
    expect(ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS).toBe(TRIAL_DAYS);
    expect(GRACE_DAYS).not.toBe(TRIAL_DAYS);
  });

  /*
   * The negative control: the same moment, 20 days after both the expiry and
   * the first run, lands in the grace period and after the trial. With the two
   * periods swapped, both verdicts flip - so a caller that passed them the
   * wrong way round could not pass the boundary tests above.
   */
  test("swapping graceDays and trialDays flips both verdicts", () => {
    const expiredToken: string = LicenseToken.sign(
      claimsFor({ exp: NOW_IN_SECONDS - (20 * DAY_IN_MS) / 1000 }),
      SIGNING_KEY.privateKey,
    );
    const unlicensed: Partial<ClassifyLicenseTokenInput> = {
      token: null,
      storedColumns: {
        enterpriseEditionFirstSeenAt: new Date(NOW.getTime() - 20 * DAY_IN_MS),
      },
    };
    const verdicts: (periods: {
      graceDays: number;
      trialDays: number;
    }) => Array<string> = (periods: {
      graceDays: number;
      trialDays: number;
    }): Array<string> => {
      return [
        classify({ token: expiredToken, ...periods }).status,
        classify({ ...unlicensed, ...periods }).status,
      ];
    };

    expect(
      verdicts({
        graceDays: ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
        trialDays: ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
      }),
    ).toEqual(["grace", "missing"]);
    expect(
      verdicts({
        graceDays: ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
        trialDays: ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
      }),
    ).toEqual(["expired", "grace"]);
  });
});
