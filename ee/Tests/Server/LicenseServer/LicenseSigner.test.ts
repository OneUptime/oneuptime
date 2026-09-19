import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import crypto from "crypto";
import JSONWebToken from "Common/Server/Utils/JsonWebToken";
import logger from "Common/Server/Utils/Logger";
import BadDataException from "Common/Types/Exception/BadDataException";
import LicenseToken, {
  classifyLicenseToken,
  LICENSE_TOKEN_AUDIENCE,
  LICENSE_TOKEN_ISSUER,
  LicenseTokenClassification,
} from "../../../Server/License/LicenseToken";
import {
  setTrustedLicenseKeysForTests,
  TrustedLicenseKey,
} from "../../../Server/License/TrustedLicenseKeys";
import LicenseSigner, {
  ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV,
  LicenseSigningKeyError,
  LicenseSigningState,
  LicenseTokenSubject,
  ResolvedLicenseSigning,
} from "../../../Server/LicenseServer/LicenseSigner";
import {
  collectLoggedText,
  decodeTokenPart,
  generateEd25519KeyPair,
  signLegacyHs256,
  TestKeyPair,
  toBase64Pem,
  toEscapedPem,
  toPrivatePem,
  toPublicPem,
  toTrustedKey,
} from "./LicenseServerTestKit";

/*
 * How the license server signs what it hands to self-hosted installations:
 * EdDSA only with a key THIS build trusts, the unchanged legacy HS256 token
 * otherwise - and the private key never reaches a log or the environment
 * after boot.
 *
 * Every EdDSA token is checked the way an installation checks it, through
 * classifyLicenseToken (ee/Server/License/LicenseToken.ts).
 */

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;
const NOW: Date = new Date("2026-09-18T12:00:00.000Z");
const LICENSE_EXPIRES_AT: Date = new Date("2027-09-18T00:00:00.000Z");
const INSTANCE_ID: string = "0b6d8f7e-1c2a-4e3b-9d4f-5a6b7c8d9e0f";
const OTHER_INSTANCE_ID: string = "11111111-2222-4333-8444-555555555555";

const SIGNING_KEY: TestKeyPair = generateEd25519KeyPair();
const OTHER_KEY: TestKeyPair = generateEd25519KeyPair();
const SIGNING_PEM: string = toPrivatePem(SIGNING_KEY);
const TRUSTED: TrustedLicenseKey = toTrustedKey(SIGNING_KEY);
const SIGNING_KID: string = TRUSTED.kid;

const subjectFor: (
  overrides?: Partial<LicenseTokenSubject>,
) => LicenseTokenSubject = (
  overrides?: Partial<LicenseTokenSubject>,
): LicenseTokenSubject => {
  return {
    licenseId: "7d9b2f0e-3c4a-4b5d-8e6f-7a8b9c0d1e2f",
    licenseKey: "acme-license-key",
    companyName: "Acme Inc",
    userLimit: 150,
    isEvaluation: false,
    expiresAt: LICENSE_EXPIRES_AT,
    ...(overrides || {}),
  };
};

const classifyAsInstallation: (data: {
  token: string;
  trustedKeys?: ReadonlyArray<TrustedLicenseKey> | undefined;
  localInstanceId?: string | null | undefined;
  now?: Date | undefined;
}) => LicenseTokenClassification = (data: {
  token: string;
  trustedKeys?: ReadonlyArray<TrustedLicenseKey> | undefined;
  localInstanceId?: string | null | undefined;
  now?: Date | undefined;
}): LicenseTokenClassification => {
  return classifyLicenseToken({
    token: data.token,
    storedColumns: {
      expiresAt: LICENSE_EXPIRES_AT,
      companyName: "Acme Inc",
      userLimit: 150,
      isEvaluation: false,
    },
    now: data.now || NOW,
    trustedKeys: data.trustedKeys || [TRUSTED],
    localInstanceId:
      data.localInstanceId === undefined ? INSTANCE_ID : data.localInstanceId,
    graceDays: 14,
    acceptUnverified: true,
  });
};

// Puts the signer into a mode the way boot does: env var + this build's keys.
const initSignerWith: (data: {
  rawKey: string | undefined;
  trustedKeys: ReadonlyArray<TrustedLicenseKey>;
}) => LicenseSigningState = (data: {
  rawKey: string | undefined;
  trustedKeys: ReadonlyArray<TrustedLicenseKey>;
}): LicenseSigningState => {
  if (data.rawKey === undefined) {
    delete process.env[ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV];
  } else {
    process.env[ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV] = data.rawKey;
  }

  setTrustedLicenseKeysForTests(data.trustedKeys);
  LicenseSigner.resetForTests();

  return LicenseSigner.init();
};

type LoggerSpy = ReturnType<typeof jest.spyOn>;

let infoSpy: LoggerSpy;
let warnSpy: LoggerSpy;
let errorSpy: LoggerSpy;
let debugSpy: LoggerSpy;
let signJsonPayloadSpy: LoggerSpy;

const loggedText: () => string = (): string => {
  return collectLoggedText([
    infoSpy as unknown as { mock: { calls: Array<Array<unknown>> } },
    warnSpy as unknown as { mock: { calls: Array<Array<unknown>> } },
    errorSpy as unknown as { mock: { calls: Array<Array<unknown>> } },
    debugSpy as unknown as { mock: { calls: Array<Array<unknown>> } },
  ]);
};

beforeEach(() => {
  infoSpy = jest.spyOn(logger, "info").mockImplementation((): void => {
    return undefined;
  });
  warnSpy = jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
  errorSpy = jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  debugSpy = jest.spyOn(logger, "debug").mockImplementation((): void => {
    return undefined;
  });
  signJsonPayloadSpy = jest
    .spyOn(JSONWebToken, "signJsonPayload")
    .mockImplementation(signLegacyHs256 as never);
});

afterEach(() => {
  delete process.env[ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV];
  setTrustedLicenseKeysForTests(null);
  LicenseSigner.resetForTests();
  jest.restoreAllMocks();
});

describe("LicenseSigner.decodeSigningKeyMaterial", () => {
  test("returns null for an unset or blank value", () => {
    expect(LicenseSigner.decodeSigningKeyMaterial(undefined)).toBeNull();
    expect(LicenseSigner.decodeSigningKeyMaterial(null)).toBeNull();
    expect(LicenseSigner.decodeSigningKeyMaterial("")).toBeNull();
    expect(LicenseSigner.decodeSigningKeyMaterial("   \n ")).toBeNull();
  });

  test("keeps a PEM as it is", () => {
    expect(LicenseSigner.decodeSigningKeyMaterial(SIGNING_PEM)).toBe(
      SIGNING_PEM.trim(),
    );
  });

  test('turns literal "\\n" escapes (a single-line env value) into newlines', () => {
    expect(
      LicenseSigner.decodeSigningKeyMaterial(toEscapedPem(SIGNING_PEM)),
    ).toBe(SIGNING_PEM.trim());
  });

  test('also turns literal "\\r\\n" escapes into newlines', () => {
    const crlfEscaped: string = SIGNING_PEM.trim().split("\n").join("\\r\\n");

    expect(LicenseSigner.decodeSigningKeyMaterial(crlfEscaped)).toBe(
      SIGNING_PEM.trim(),
    );
  });

  test("decodes a base64-encoded PEM", () => {
    expect(
      LicenseSigner.decodeSigningKeyMaterial(toBase64Pem(SIGNING_PEM)),
    ).toBe(SIGNING_PEM.trim());
  });

  test("decodes a base64-encoded PEM that itself carries escaped newlines", () => {
    expect(
      LicenseSigner.decodeSigningKeyMaterial(
        toBase64Pem(toEscapedPem(SIGNING_PEM)),
      ),
    ).toBe(SIGNING_PEM.trim());
  });

  test("decodes a base64 value wrapped across lines", () => {
    const wrapped: string = (
      toBase64Pem(SIGNING_PEM).match(/.{1,64}/g) as Array<string>
    ).join("\n");

    expect(LicenseSigner.decodeSigningKeyMaterial(wrapped)).toBe(
      SIGNING_PEM.trim(),
    );
  });

  test("strips one pair of surrounding quotes (a quoted .env value)", () => {
    expect(
      LicenseSigner.decodeSigningKeyMaterial(`"${toEscapedPem(SIGNING_PEM)}"`),
    ).toBe(SIGNING_PEM.trim());
    expect(
      LicenseSigner.decodeSigningKeyMaterial(`'${toBase64Pem(SIGNING_PEM)}'`),
    ).toBe(SIGNING_PEM.trim());
  });

  test("returns anything else unchanged, so it fails to parse", () => {
    expect(LicenseSigner.decodeSigningKeyMaterial("not a key")).toBe(
      "not a key",
    );
  });
});

describe("LicenseSigner.parseSigningPrivateKey", () => {
  const problemOf: (raw: string | undefined) => string | null = (
    raw: string | undefined,
  ): string | null => {
    try {
      LicenseSigner.parseSigningPrivateKey(raw);
    } catch (err) {
      if (err instanceof LicenseSigningKeyError) {
        return err.problem;
      }

      throw err;
    }

    return null;
  };

  test("parses an Ed25519 PKCS#8 PEM and derives its RFC 7638 key id", () => {
    const parsed: { kid: string } =
      LicenseSigner.parseSigningPrivateKey(SIGNING_PEM);

    expect(parsed.kid).toBe(SIGNING_KID);
  });

  test.each([
    ["the escaped", toEscapedPem(SIGNING_PEM)],
    ["the base64", toBase64Pem(SIGNING_PEM)],
  ])("parses %s form to the same key id", (_label: string, raw: string) => {
    expect(LicenseSigner.parseSigningPrivateKey(raw).kid).toBe(SIGNING_KID);
  });

  test("reports an unset key as not-set", () => {
    expect(problemOf(undefined)).toBe("not-set");
    expect(problemOf("  ")).toBe("not-set");
  });

  test("reports garbage as unparseable", () => {
    expect(problemOf("definitely-not-a-key")).toBe("unparseable");
    expect(
      problemOf("-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----"),
    ).toBe("unparseable");
  });

  test("reports a PUBLIC key as unparseable - a private key is required", () => {
    expect(problemOf(toPublicPem(SIGNING_KEY))).toBe("unparseable");
  });

  test("reports an RSA or EC private key as not-ed25519", () => {
    const rsaPem: string = crypto
      .generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();
    const ecPem: string = crypto
      .generateKeyPairSync("ec", { namedCurve: "P-256" })
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();

    expect(problemOf(rsaPem)).toBe("not-ed25519");
    expect(problemOf(ecPem)).toBe("not-ed25519");
  });

  test("never puts the value it was given into the error message", () => {
    const secretLookingValue: string = "c2VjcmV0LXNpZ25pbmcta2V5LW1hdGVyaWFs";

    try {
      LicenseSigner.parseSigningPrivateKey(secretLookingValue);
      throw new Error("expected a LicenseSigningKeyError");
    } catch (err) {
      expect(err).toBeInstanceOf(LicenseSigningKeyError);
      expect((err as Error).message).not.toContain(secretLookingValue);
    }

    const body: string = SIGNING_PEM.split("\n")[1] as string;

    try {
      LicenseSigner.parseSigningPrivateKey(
        SIGNING_PEM.replace(body, body.substring(0, body.length - 4)),
      );
    } catch (err) {
      expect((err as Error).message).not.toContain(body.substring(0, 20));
    }
  });
});

describe("LicenseSigner.resolveSigning - which format this server signs with", () => {
  const resolve: (
    rawKey: string | undefined,
    trustedKeys: ReadonlyArray<TrustedLicenseKey>,
  ) => ResolvedLicenseSigning = (
    rawKey: string | undefined,
    trustedKeys: ReadonlyArray<TrustedLicenseKey>,
  ): ResolvedLicenseSigning => {
    return LicenseSigner.resolveSigning({ rawKey, trustedKeys, now: NOW });
  };

  test("no key: legacy HS256", () => {
    const resolved: ResolvedLicenseSigning = resolve(undefined, [TRUSTED]);

    expect(resolved.state).toEqual({
      mode: "legacy-hs256",
      problem: "not-set",
      message: `${ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV} is not set.`,
    });
    expect(resolved.privateKey).toBeNull();
  });

  test("a key that does not parse: legacy HS256", () => {
    const resolved: ResolvedLicenseSigning = resolve("garbage", [TRUSTED]);

    expect(resolved.state.mode).toBe("legacy-hs256");
    expect(resolved.state.problem).toBe("unparseable");
    expect(resolved.privateKey).toBeNull();
  });

  test("a key that is not Ed25519: legacy HS256", () => {
    const ecPem: string = crypto
      .generateKeyPairSync("ec", { namedCurve: "P-256" })
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();

    expect(resolve(ecPem, [TRUSTED]).state).toMatchObject({
      mode: "legacy-hs256",
      problem: "not-ed25519",
    });
  });

  test("an Ed25519 key this build does not trust (the shipped, empty list): legacy HS256", () => {
    const resolved: ResolvedLicenseSigning = resolve(SIGNING_PEM, []);

    expect(resolved.state).toMatchObject({
      mode: "legacy-hs256",
      problem: "not-trusted",
      kid: SIGNING_KID,
    });
    expect(resolved.privateKey).toBeNull();
  });

  test("an Ed25519 key when the build trusts only a different key: legacy HS256", () => {
    expect(resolve(SIGNING_PEM, [toTrustedKey(OTHER_KEY)]).state).toMatchObject(
      { mode: "legacy-hs256", problem: "not-trusted" },
    );
  });

  test("a trust-list entry whose kid names our key but holds another key does not count", () => {
    const forged: TrustedLicenseKey = {
      kid: SIGNING_KID,
      publicKeyPem: toPublicPem(OTHER_KEY),
    };

    expect(resolve(SIGNING_PEM, [forged]).state).toMatchObject({
      mode: "legacy-hs256",
      problem: "not-trusted",
    });
  });

  test("a trusted Ed25519 key: EdDSA, with its key id", () => {
    const resolved: ResolvedLicenseSigning = resolve(SIGNING_PEM, [TRUSTED]);

    expect(resolved.state).toEqual({
      mode: "eddsa",
      kid: SIGNING_KID,
      message: `License tokens are signed with EdDSA (key id ${SIGNING_KID}).`,
    });
    expect(resolved.privateKey?.asymmetricKeyType).toBe("ed25519");
  });

  test.each([
    ["escaped-newline", toEscapedPem(SIGNING_PEM)],
    ["base64", toBase64Pem(SIGNING_PEM)],
  ])("a trusted key given in %s form: EdDSA", (_label: string, raw: string) => {
    expect(resolve(raw, [TRUSTED]).state.mode).toBe("eddsa");
  });

  test("a malformed entry elsewhere in the trust list does not stop EdDSA", () => {
    const malformed: TrustedLicenseKey = {
      kid: "broken",
      publicKeyPem:
        "-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----",
    };

    expect(resolve(SIGNING_PEM, [malformed, TRUSTED]).state.mode).toBe("eddsa");
  });

  test("a failed self-test (the signer cannot produce a verifying token) keeps legacy HS256", () => {
    jest.spyOn(LicenseToken, "sign").mockImplementationOnce((): string => {
      throw new Error("signing is broken");
    });

    expect(resolve(SIGNING_PEM, [TRUSTED]).state).toMatchObject({
      mode: "legacy-hs256",
      problem: "self-test-failed",
      kid: SIGNING_KID,
    });
  });

  test("never throws, whatever it is handed", () => {
    for (const raw of [
      undefined,
      "",
      "x",
      "-----BEGIN",
      "=====",
      toPublicPem(SIGNING_KEY),
    ]) {
      expect(() => {
        return resolve(raw, [TRUSTED]);
      }).not.toThrow();
    }
  });
});

describe("LicenseSigner.init - read once at boot", () => {
  test("reads the key from the environment and removes it", () => {
    const state: LicenseSigningState = initSignerWith({
      rawKey: SIGNING_PEM,
      trustedKeys: [TRUSTED],
    });

    expect(state.mode).toBe("eddsa");
    expect(process.env[ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV]).toBe(
      undefined,
    );
    expect(
      Object.keys(process.env).includes(
        ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV,
      ),
    ).toBe(false);
  });

  test("removes an untrusted key from the environment too", () => {
    initSignerWith({ rawKey: SIGNING_PEM, trustedKeys: [] });

    expect(process.env[ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV]).toBe(
      undefined,
    );
  });

  test("parses once: later calls keep the first decision", () => {
    initSignerWith({ rawKey: SIGNING_PEM, trustedKeys: [TRUSTED] });

    process.env[ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV] = "garbage";

    expect(LicenseSigner.init().mode).toBe("eddsa");
    expect(LicenseSigner.getState().mode).toBe("eddsa");
    expect(LicenseSigner.isEdDsaEnabled()).toBe(true);
  });

  test("getState initialises on first use", () => {
    process.env[ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV] = SIGNING_PEM;
    setTrustedLicenseKeysForTests([TRUSTED]);

    expect(LicenseSigner.getState().mode).toBe("eddsa");
    expect(process.env[ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV]).toBe(
      undefined,
    );
  });

  test("logs the chosen mode once: EdDSA as info with the key id", () => {
    initSignerWith({ rawKey: SIGNING_PEM, trustedKeys: [TRUSTED] });
    LicenseSigner.init();
    LicenseSigner.getState();

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(String(infoSpy.mock.calls[0]?.[0])).toContain("EdDSA");
    expect(String(infoSpy.mock.calls[0]?.[0])).toContain(SIGNING_KID);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("logs no key as info, and a key it cannot use as a warning", () => {
    initSignerWith({ rawKey: undefined, trustedKeys: [TRUSTED] });

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(String(infoSpy.mock.calls[0]?.[0])).toContain("legacy HS256");
    expect(warnSpy).not.toHaveBeenCalled();

    infoSpy.mockClear();

    initSignerWith({ rawKey: SIGNING_PEM, trustedKeys: [] });

    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain("TrustedLicenseKeys");
  });

  test.each([
    ["PEM", SIGNING_PEM],
    ["escaped PEM", toEscapedPem(SIGNING_PEM)],
    ["base64 PEM", toBase64Pem(SIGNING_PEM)],
  ])(
    "never logs the private key (%s), trusted or not",
    (_label: string, raw: string) => {
      initSignerWith({ rawKey: raw, trustedKeys: [TRUSTED] });
      initSignerWith({ rawKey: raw, trustedKeys: [] });
      initSignerWith({
        rawKey: raw.substring(0, raw.length - 10),
        trustedKeys: [],
      });

      const logged: string = loggedText();
      const pemBody: string = SIGNING_PEM.split("\n")[1] as string;

      expect(logged).not.toContain(pemBody);
      expect(logged).not.toContain(pemBody.substring(0, 24));
      expect(logged).not.toContain(toBase64Pem(SIGNING_PEM).substring(0, 40));
      expect(logged).not.toContain("PRIVATE KEY");
    },
  );

  test("resetForTests refuses to run outside jest", () => {
    const workerId: string | undefined = process.env["JEST_WORKER_ID"];

    delete process.env["JEST_WORKER_ID"];

    try {
      expect(() => {
        LicenseSigner.resetForTests();
      }).toThrow("only be used from tests");
    } finally {
      process.env["JEST_WORKER_ID"] = workerId;
    }
  });
});

describe("the token /validate and /report-user-count hand out", () => {
  describe("with EdDSA signing (trusted key)", () => {
    beforeEach(() => {
      initSignerWith({ rawKey: SIGNING_PEM, trustedKeys: [TRUSTED] });
    });

    test("is a signed license an installation of this build verifies as valid", () => {
      const token: string = LicenseSigner.signOnlineToken(
        subjectFor(),
        NOW,
      ) as string;
      const classification: LicenseTokenClassification = classifyAsInstallation(
        { token },
      );

      expect(classification.reason).toBe("verified");
      expect(classification.verification).toBe("verified");
      expect(classification.status).toBe("valid");
      expect(classification.kid).toBe(SIGNING_KID);
      expect(classification.licenseId).toBe(subjectFor().licenseId);
      expect(classification.companyName).toBe("Acme Inc");
      expect(classification.userLimit).toBe(150);
      expect(classification.isEvaluation).toBe(false);
      expect(classification.features).toBe("all");
      expect(classification.expiresAt?.toISOString()).toBe(
        LICENSE_EXPIRES_AT.toISOString(),
      );
      expect(signJsonPayloadSpy).not.toHaveBeenCalled();
    });

    test("carries exactly the design's claims, unbound to any instance", () => {
      const token: string = LicenseSigner.signOnlineToken(
        subjectFor({ userLimit: null, isEvaluation: true }),
        NOW,
      ) as string;

      expect(decodeTokenPart(token, 0)).toEqual({
        alg: "EdDSA",
        typ: "JWT",
        kid: SIGNING_KID,
      });
      expect(decodeTokenPart(token, 1)).toEqual({
        iss: LICENSE_TOKEN_ISSUER,
        aud: LICENSE_TOKEN_AUDIENCE,
        sub: subjectFor().licenseId,
        licenseKey: "acme-license-key",
        companyName: "Acme Inc",
        userLimit: null,
        isEvaluation: true,
        features: ["*"],
        iat: Math.floor(NOW.getTime() / 1000),
        exp: Math.floor(LICENSE_EXPIRES_AT.getTime() / 1000),
      });
    });

    test("is accepted on any instance of the customer (online tokens are not instance-bound)", () => {
      const token: string = LicenseSigner.signOnlineToken(
        subjectFor(),
        NOW,
      ) as string;

      expect(
        classifyAsInstallation({ token, localInstanceId: OTHER_INSTANCE_ID })
          .status,
      ).toBe("valid");
      expect(
        classifyAsInstallation({ token, localInstanceId: null }).status,
      ).toBe("valid");
    });

    test("goes into grace, then expires, on the license's own expiry", () => {
      const token: string = LicenseSigner.signOnlineToken(
        subjectFor(),
        NOW,
      ) as string;

      expect(
        classifyAsInstallation({
          token,
          now: new Date(LICENSE_EXPIRES_AT.getTime() + 3 * DAY_IN_MS),
        }).status,
      ).toBe("grace");
      expect(
        classifyAsInstallation({
          token,
          now: new Date(LICENSE_EXPIRES_AT.getTime() + 30 * DAY_IN_MS),
        }).status,
      ).toBe("expired");
    });

    test("is rejected by a build that trusts a different key", () => {
      const token: string = LicenseSigner.signOnlineToken(
        subjectFor(),
        NOW,
      ) as string;

      expect(
        classifyAsInstallation({
          token,
          trustedKeys: [toTrustedKey(OTHER_KEY)],
        }).verification,
      ).toBe("unverified");
    });

    test("falls back to the legacy token when the license cannot be expressed as a signed license", () => {
      const token: string | null = LicenseSigner.signOnlineToken(
        subjectFor({ licenseKey: "" }),
        NOW,
      );

      expect(token).not.toBeNull();
      expect(decodeTokenPart(token as string, 0)["alg"]).toBe("HS256");
      expect(signJsonPayloadSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    const WITHHELD_CASES: Array<[string, Date | null]> = [
      ["has expired", new Date(NOW.getTime() - DAY_IN_MS)],
      ["expires this very second", NOW],
      ["has no expiry", null],
    ];

    test.each(WITHHELD_CASES)(
      "is withheld (null) when the license %s",
      (_label: string, expiresAt: Date | null) => {
        expect(
          LicenseSigner.signOnlineToken(subjectFor({ expiresAt }), NOW),
        ).toBeNull();
        expect(signJsonPayloadSpy).not.toHaveBeenCalled();
      },
    );
  });

  const LEGACY_CASES: Array<
    [string, string | undefined, Array<TrustedLicenseKey>]
  > = [
    ["no signing key", undefined, [TRUSTED]],
    ["a signing key this build does not trust", SIGNING_PEM, []],
    ["an unparseable signing key", "garbage", [TRUSTED]],
  ];

  describe.each(LEGACY_CASES)(
    "with %s (legacy HS256)",
    (
      _label: string,
      rawKey: string | undefined,
      trustedKeys: Array<TrustedLicenseKey>,
    ) => {
      beforeEach(() => {
        initSignerWith({ rawKey, trustedKeys });
      });

      test("signs the unchanged legacy payload with the server secret, valid until the license expires", () => {
        LicenseSigner.signOnlineToken(subjectFor(), NOW);

        expect(signJsonPayloadSpy).toHaveBeenCalledTimes(1);
        expect(signJsonPayloadSpy).toHaveBeenCalledWith(
          {
            companyName: "Acme Inc",
            expiresAt: LICENSE_EXPIRES_AT.toISOString(),
            licenseKey: "acme-license-key",
            userLimit: 150,
          },
          Math.floor((LICENSE_EXPIRES_AT.getTime() - NOW.getTime()) / 1000),
        );
      });

      test("an installation reads it as an unverified legacy license, valid from its stored expiry", () => {
        const token: string = LicenseSigner.signOnlineToken(
          subjectFor(),
          NOW,
        ) as string;
        const classification: LicenseTokenClassification =
          classifyAsInstallation({ token });

        expect(classification.reason).toBe("unverified");
        expect(classification.verification).toBe("unverified");
        expect(classification.status).toBe("valid");
      });

      test("withholds it for an expired license", () => {
        expect(
          LicenseSigner.signOnlineToken(
            subjectFor({ expiresAt: new Date(NOW.getTime() - 1000) }),
            NOW,
          ),
        ).toBeNull();
        expect(signJsonPayloadSpy).not.toHaveBeenCalled();
      });

      test("cannot issue an offline token, and says why", () => {
        expect(() => {
          return LicenseSigner.signOfflineToken({
            subject: subjectFor(),
            instanceId: INSTANCE_ID,
            now: NOW,
          });
        }).toThrow(BadDataException);
        expect(LicenseSigner.getOfflineUnavailableMessage()).toContain(
          ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV,
        );
      });
    },
  );
});

describe("offline tokens", () => {
  beforeEach(() => {
    initSignerWith({ rawKey: SIGNING_PEM, trustedKeys: [TRUSTED] });
  });

  test("are bound to the instance they were issued for", () => {
    const token: string = LicenseSigner.signOfflineToken({
      subject: subjectFor(),
      instanceId: INSTANCE_ID,
      now: NOW,
    });

    expect(decodeTokenPart(token, 1)["instanceId"]).toBe(INSTANCE_ID);

    const onTheRightInstance: LicenseTokenClassification =
      classifyAsInstallation({ token, localInstanceId: INSTANCE_ID });

    expect(onTheRightInstance.status).toBe("valid");
    expect(onTheRightInstance.verification).toBe("verified");
    expect(onTheRightInstance.instanceId).toBe(INSTANCE_ID);
  });

  test("are invalid on any other instance, or one that does not know its id", () => {
    const token: string = LicenseSigner.signOfflineToken({
      subject: subjectFor(),
      instanceId: INSTANCE_ID,
      now: NOW,
    });

    const elsewhere: LicenseTokenClassification = classifyAsInstallation({
      token,
      localInstanceId: OTHER_INSTANCE_ID,
    });

    expect(elsewhere.status).toBe("invalid");
    expect(elsewhere.reason).toBe("instance-mismatch");
    expect(
      classifyAsInstallation({ token, localInstanceId: null }).status,
    ).toBe("invalid");
  });

  test("expire with the license", () => {
    const token: string = LicenseSigner.signOfflineToken({
      subject: subjectFor(),
      instanceId: INSTANCE_ID,
      now: NOW,
    });

    expect(decodeTokenPart(token, 1)["exp"]).toBe(
      Math.floor(LICENSE_EXPIRES_AT.getTime() / 1000),
    );
  });

  test("are refused for an expired license or one with no expiry", () => {
    for (const expiresAt of [new Date(NOW.getTime() - 1000), null]) {
      expect(() => {
        return LicenseSigner.signOfflineToken({
          subject: subjectFor({ expiresAt }),
          instanceId: INSTANCE_ID,
          now: NOW,
        });
      }).toThrow("Renew it before issuing an offline license token");
    }
  });

  test("never appear in a log line", () => {
    const token: string = LicenseSigner.signOfflineToken({
      subject: subjectFor(),
      instanceId: INSTANCE_ID,
      now: NOW,
    });
    const onlineToken: string = LicenseSigner.signOnlineToken(
      subjectFor(),
      NOW,
    ) as string;

    const logged: string = loggedText();

    expect(logged).not.toContain(token);
    expect(logged).not.toContain(token.split(".")[2] as string);
    expect(logged).not.toContain(onlineToken.split(".")[2] as string);
  });
});
