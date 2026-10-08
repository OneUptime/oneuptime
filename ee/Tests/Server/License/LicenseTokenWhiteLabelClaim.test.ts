import { describe, expect, test } from "@jest/globals";
import crypto from "crypto";
import {
  ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
  ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
} from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";
import LicenseToken, {
  classifyLicenseToken,
  LICENSE_TOKEN_MAX_LENGTH,
  LicenseTokenClaims,
  LicenseTokenClassification,
} from "../../../Server/License/LicenseToken";
import { TrustedLicenseKey } from "../../../Server/License/TrustedLicenseKeys";
import LicenseInputsUtil from "../../../Server/License/LicenseInputs";
import {
  claimsFor,
  DAY_IN_MS,
  generateEd25519,
  KeyPair,
  legacyToken,
  signLicense,
  trustedEntryFor,
} from "./Helpers/LicenseTestKit";

/*
 * The canBeWhiteLabelled claim: the one way an installation learns that its
 * license lets it white-label itself.
 *
 * What these pin:
 *   - it is read ONLY from a verified token: a signed claim nobody can add
 *     without the signing key. An unverified legacy token, a token signed by
 *     a key this build does not know, a tampered token and a token bound to
 *     another installation never carry the right, whatever they say;
 *   - a token without the claim - every token issued before it existed - is
 *     "not allowed";
 *   - only `true` grants it, and any other value withholds just the right:
 *     the license itself stays valid (a newer license server's richer shape
 *     must never switch off SCIM and audit logging on an older install);
 *   - the signer writes the claim only when it is true, so the token of a
 *     license without the switch is byte for byte what it was.
 */

const SIGNING_KEY: KeyPair = generateEd25519();
const UNKNOWN_KEY: KeyPair = generateEd25519();
const TRUSTED: ReadonlyArray<TrustedLicenseKey> = [trustedEntryFor(SIGNING_KEY)];
const INSTANCE_ID: string = "0b6d8f7e-1c2a-4e3b-9d4f-5a6b7c8d9e0f";
const OTHER_INSTANCE_ID: string = "11111111-2222-4333-8444-555555555555";

const classify: (
  token: string | null,
  options?: {
    now?: Date;
    trustedKeys?: ReadonlyArray<TrustedLicenseKey>;
    localInstanceId?: string | null;
  },
) => LicenseTokenClassification = (
  token: string | null,
  options?: {
    now?: Date;
    trustedKeys?: ReadonlyArray<TrustedLicenseKey>;
    localInstanceId?: string | null;
  },
): LicenseTokenClassification => {
  return classifyLicenseToken({
    token,
    storedColumns: {
      expiresAt: new Date(Date.now() + 100 * DAY_IN_MS),
      companyName: "Acme Inc",
      userLimit: 50,
      isEvaluation: false,
      enterpriseEditionFirstSeenAt: new Date(Date.now() - DAY_IN_MS),
    },
    now: options?.now || new Date(),
    trustedKeys: options?.trustedKeys || TRUSTED,
    localInstanceId:
      options?.localInstanceId === undefined
        ? INSTANCE_ID
        : options.localInstanceId,
    graceDays: ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
    trialDays: ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
    acceptUnverified: true,
  });
};

const base64url: (value: string | Buffer) => string = (
  value: string | Buffer,
): string => {
  return Buffer.from(value).toString("base64url");
};

const decodePayload: (token: string) => Record<string, unknown> = (
  token: string,
): Record<string, unknown> => {
  return JSON.parse(
    Buffer.from(token.split(".")[1] as string, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
};

// A token signed exactly as LicenseToken.sign does, but with any payload at all.
const signRawPayload: (
  keyPair: KeyPair,
  payload: Record<string, unknown>,
) => string = (
  keyPair: KeyPair,
  payload: Record<string, unknown>,
): string => {
  const header: string = base64url(
    JSON.stringify({
      alg: "EdDSA",
      typ: "JWT",
      kid: LicenseToken.computeKeyId(keyPair.privateKey),
    }),
  );
  const body: string = base64url(JSON.stringify(payload));
  const signature: Buffer = crypto.sign(
    null,
    Buffer.from(`${header}.${body}`, "utf8"),
    keyPair.privateKey,
  );

  return `${header}.${body}.${signature.toString("base64url")}`;
};

describe("a signed license with the canBeWhiteLabelled claim", () => {
  test("verifies, stays valid, and carries the right", () => {
    const classification: LicenseTokenClassification = classify(
      signLicense(SIGNING_KEY, { canBeWhiteLabelled: true }),
    );

    expect(classification.reason).toBe("verified");
    expect(classification.status).toBe("valid");
    expect(classification.verification).toBe("verified");
    expect(classification.canBeWhiteLabelled).toBe(true);
  });

  test("carries the right in an instance-bound (offline) token on its own instance", () => {
    const classification: LicenseTokenClassification = classify(
      signLicense(SIGNING_KEY, {
        canBeWhiteLabelled: true,
        instanceId: INSTANCE_ID,
      }),
    );

    expect(classification.reason).toBe("verified");
    expect(classification.instanceId).toBe(INSTANCE_ID);
    expect(classification.canBeWhiteLabelled).toBe(true);
  });

  test("carries nothing on another instance: the token is invalid there", () => {
    const classification: LicenseTokenClassification = classify(
      signLicense(SIGNING_KEY, {
        canBeWhiteLabelled: true,
        instanceId: OTHER_INSTANCE_ID,
      }),
    );

    expect(classification.reason).toBe("instance-mismatch");
    expect(classification.status).toBe("invalid");
    expect(classification.canBeWhiteLabelled).toBeUndefined();
  });

  test("still says the license has the right once it has expired (usability is decided apart)", () => {
    const classification: LicenseTokenClassification = classify(
      signLicense(SIGNING_KEY, { canBeWhiteLabelled: true, daysFromNow: -5 }),
    );

    expect(classification.status).toBe("grace");
    expect(classification.canBeWhiteLabelled).toBe(true);
  });

  test("the snapshot core reads never carries the right: it stays in ee", () => {
    const classification: LicenseTokenClassification = classify(
      signLicense(SIGNING_KEY, { canBeWhiteLabelled: true }),
    );

    expect(
      Object.keys(LicenseInputsUtil.toSnapshot(classification)),
    ).not.toContain("canBeWhiteLabelled");
  });
});

describe("a license without the right", () => {
  test("a signed token with no claim: every token issued before it existed", () => {
    const classification: LicenseTokenClassification = classify(
      signLicense(SIGNING_KEY),
    );

    expect(classification.reason).toBe("verified");
    expect(classification.status).toBe("valid");
    expect(classification.canBeWhiteLabelled).toBe(false);
  });

  test("a signed token that says false", () => {
    const token: string = signRawPayload(SIGNING_KEY, {
      ...claimsFor(),
      canBeWhiteLabelled: false,
    });

    const classification: LicenseTokenClassification = classify(token);

    expect(classification.status).toBe("valid");
    expect(classification.canBeWhiteLabelled).toBe(false);
  });

  test.each([
    ["the string true", "true"],
    ["the number 1", 1],
    ["an object", { logo: true, name: true }],
    ["null", null],
    ["a list", [true]],
  ])(
    "a claim that is %s withholds the right and leaves the license valid",
    (_label: string, value: unknown) => {
      const token: string = signRawPayload(SIGNING_KEY, {
        ...claimsFor(),
        canBeWhiteLabelled: value,
      });

      const classification: LicenseTokenClassification = classify(token);

      expect(classification.reason).toBe("verified");
      expect(classification.status).toBe("valid");
      expect(classification.canBeWhiteLabelled).toBe(false);
    },
  );

  test("a tampered token - the claim added after signing - is invalid and carries nothing", () => {
    const original: string = signLicense(SIGNING_KEY);
    const [header, , signature] = original.split(".") as [
      string,
      string,
      string,
    ];
    const forgedPayload: string = base64url(
      JSON.stringify({ ...decodePayload(original), canBeWhiteLabelled: true }),
    );

    const classification: LicenseTokenClassification = classify(
      `${header}.${forgedPayload}.${signature}`,
    );

    expect(classification.reason).toBe("bad-signature");
    expect(classification.status).toBe("invalid");
    expect(classification.canBeWhiteLabelled).toBeUndefined();
  });

  test("a token signed by a key this build does not trust carries nothing, whatever it claims", () => {
    const classification: LicenseTokenClassification = classify(
      signLicense(UNKNOWN_KEY, { canBeWhiteLabelled: true }),
    );

    expect(classification.verification).toBe("unverified");
    // Still usable as an unverified legacy license, but never white-labelled.
    expect(classification.status).toBe("valid");
    expect(classification.canBeWhiteLabelled).toBeUndefined();
  });

  test("a legacy HS256 token carries nothing", () => {
    const classification: LicenseTokenClassification = classify(
      legacyToken("OU-LEGACY-WHITE-LABEL"),
    );

    expect(classification.verification).toBe("unverified");
    expect(classification.canBeWhiteLabelled).toBeUndefined();
  });

  test("no token at all (the unlicensed trial) carries nothing", () => {
    const classification: LicenseTokenClassification = classify(null);

    expect(classification.status).toBe("grace");
    expect(classification.graceReason).toBe("unlicensed");
    expect(classification.canBeWhiteLabelled).toBeUndefined();
  });
});

describe("LicenseToken.validateClaims and sign", () => {
  test("validateClaims keeps true and drops everything else", () => {
    expect(
      LicenseToken.validateClaims({
        ...claimsFor(),
        canBeWhiteLabelled: true,
      } as unknown as Record<string, unknown>).canBeWhiteLabelled,
    ).toBe(true);

    for (const value of [false, "true", 1, null, undefined, {}]) {
      expect(
        LicenseToken.validateClaims({
          ...claimsFor(),
          canBeWhiteLabelled: value,
        } as unknown as Record<string, unknown>).canBeWhiteLabelled,
      ).toBeUndefined();
    }
  });

  test("a token signed without the claim has no such key in its payload", () => {
    const claims: LicenseTokenClaims = claimsFor();

    expect(decodePayload(LicenseToken.sign(claims, SIGNING_KEY.privateKey))).not.toHaveProperty(
      "canBeWhiteLabelled",
    );
  });

  test("a token signed with the claim carries exactly true", () => {
    expect(
      decodePayload(
        LicenseToken.sign(
          claimsFor({ canBeWhiteLabelled: true }),
          SIGNING_KEY.privateKey,
        ),
      )["canBeWhiteLabelled"],
    ).toBe(true);
  });

  test("the claim keeps a large license well inside the token size limit", () => {
    const token: string = LicenseToken.sign(
      claimsFor({
        canBeWhiteLabelled: true,
        companyName: "A".repeat(200),
        instanceId: INSTANCE_ID,
      }),
      SIGNING_KEY.privateKey,
    );

    expect(token.length).toBeLessThan(LICENSE_TOKEN_MAX_LENGTH);
  });
});
