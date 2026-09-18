import { afterEach, describe, expect, jest, test } from "@jest/globals";
import crypto, { KeyObject } from "crypto";
import fs from "fs";
import path from "path";
import EnterpriseFeature from "Common/Server/Enterprise/EnterpriseFeature";
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
const NOW: Date = new Date("2026-09-18T12:00:00.000Z");
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
    graceDays: 14,
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

  test("ships empty until the key ceremony (update this test when the first key is added)", () => {
    expect(getProductionTrustedLicenseKeys()).toEqual([]);
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
        graceDays: 14,
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

  test("an unlicensed Enterprise install is in grace for 14 days from first seen", () => {
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
  });

  test("the unlicensed grace includes its last millisecond and ends right after", () => {
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

  test("the grace length follows graceDays", () => {
    const firstSeen: Date = new Date(NOW.getTime() - 20 * DAY_IN_MS);

    expect(
      classify({
        token: null,
        graceDays: 30,
        storedColumns: { enterpriseEditionFirstSeenAt: firstSeen },
      }).status,
    ).toBe("grace");
    expect(
      classify({
        token: null,
        graceDays: 14,
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

  test("expiry: valid before exp, grace from exp through exp + 14 days, expired after", () => {
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
      new Date(NOW.getTime() + 14 * DAY_IN_MS),
    );

    expect(
      classify({
        token: tokenExpiringAt(new Date(NOW.getTime() - 14 * DAY_IN_MS)),
      }).status,
    ).toBe("grace");

    const expired: LicenseTokenClassification = classify({
      token: tokenExpiringAt(
        new Date(NOW.getTime() - 14 * DAY_IN_MS - oneSecond),
      ),
    });
    expect(expired.status).toBe("expired");
    expect(expired.verification).toBe("verified");
    expect(expired.graceReason).toBeUndefined();
    expect(expired.graceEndsAt).toEqual(new Date(NOW.getTime() - oneSecond));
  });

  test("the same token moves valid -> grace -> expired as time passes", () => {
    const token: string = LicenseToken.sign(claimsFor(), SIGNING_KEY.privateKey);

    expect(
      [0, 31, 45].map((days: number): string => {
        return classify({
          token,
          now: new Date(NOW.getTime() + days * DAY_IN_MS),
        }).status;
      }),
    ).toEqual(["valid", "grace", "expired"]);
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

  test("unverified expiry uses the stored column with the same 14-day grace", () => {
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
    expect(at(15).status).toBe("expired");
  });

  test("an unverified token with no recorded expiry is invalid", () => {
    for (const expiresAt of [null, undefined, new Date("nope")]) {
      expect(
        classify({ token: legacyToken(), storedColumns: { expiresAt } }),
      ).toMatchObject({
        status: "invalid",
        verification: "unverified",
        reason: "unverified-without-expiry",
      });
    }
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

describe("classifyLicenseToken is pure", () => {
  test("the same input gives the same output and is not mutated", () => {
    const input: ClassifyLicenseTokenInput = {
      token: LicenseToken.sign(claimsFor(), SIGNING_KEY.privateKey),
      storedColumns: { expiresAt: new Date(NOW.getTime() + DAY_IN_MS) },
      now: new Date(NOW.getTime()),
      trustedKeys: [TRUSTED],
      localInstanceId: LOCAL_INSTANCE_ID,
      graceDays: 14,
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
