import {
  OPERATOR_ENCRYPTION_SECRET,
  SHIPPED_ENCRYPTION_SECRETS,
  ShippedEncryptionSecret,
  restoreEncryptionSecret,
  setEncryptionSecret,
} from "Common/Tests/Server/TestingUtils/ShippedEncryptionSecrets";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import crypto from "crypto";

/*
 * The Identity feature set's two signatures that are not JWTs, on an
 * installation whose ENCRYPTION_SECRET is a value this repository ships:
 *
 *   - the verification-email resend token a freshly signed-up browser holds;
 *   - the signature on a project SSO sign-in confirmation link, which binds
 *     the mailed token to one project and one provider.
 *
 * Both used to be HMACs keyed with ENCRYPTION_SECRET, so on such an
 * installation anybody could make one. Both now use TokenSigningKey: one made
 * with the public value is refused, and the ones the server makes still
 * verify. On an installation whose operator set ENCRYPTION_SECRET, the ones it
 * handed out before the upgrade still verify.
 *
 * Each configuration is a fresh module registry, so EnvironmentConfig reads
 * that ENCRYPTION_SECRET.
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
const USER_EMAIL: string = "new-user@example.com";
const PROJECT_ID: string = "99999999-9999-4999-8999-999999999999";
const PROVIDER_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONFIRMATION_TOKEN: string = "c0ffee00-c0ff-4c0f-8c0f-c0ffeec0ffee";

// The labels the two modules sign under, restated on purpose.
const RESEND_TOKEN_LABEL: string =
  "oneuptime:identity:verification-email-resend-token:v1";
const CONFIRMATION_PURPOSE: string = "project-sso-sign-in-confirmation";

type ResendTokenClass =
  typeof import("../../../FeatureSet/Identity/Utils/VerificationEmailResendToken").default;
type ConfirmationClass =
  typeof import("../../../FeatureSet/Identity/Utils/ProjectSsoSignInConfirmation").default;

interface Identity {
  encryptionSecret: string;
  ResendToken: ResendTokenClass;
  Confirmation: ConfirmationClass;
  ObjectID: typeof import("Common/Types/ObjectID").default;
  Email: typeof import("Common/Types/Email").default;
  kind: string;
}

async function identityWith(
  encryptionSecret: string | undefined,
): Promise<Identity> {
  setEncryptionSecret(encryptionSecret);
  jest.resetModules();

  const config: { EncryptionSecret: { toString: () => string } } =
    await import("Common/Server/EnvironmentConfig");
  const confirmationModule: {
    default: ConfirmationClass;
    ProjectSsoKind: Record<string, string>;
  } = (await import(
    "../../../FeatureSet/Identity/Utils/ProjectSsoSignInConfirmation"
  )) as never;

  return {
    encryptionSecret: config.EncryptionSecret.toString(),
    ResendToken: (
      await import(
        "../../../FeatureSet/Identity/Utils/VerificationEmailResendToken"
      )
    ).default,
    Confirmation: confirmationModule.default,
    ObjectID: (await import("Common/Types/ObjectID")).default,
    Email: (await import("Common/Types/Email")).default,
    kind: confirmationModule.ProjectSsoKind["SAML"] as string,
  };
}

function useIdentity(encryptionSecret: string | undefined): () => Identity {
  let identity: Identity | null = null;

  beforeAll(async () => {
    identity = await identityWith(encryptionSecret);
  });

  afterAll(() => {
    restoreEncryptionSecret();
    jest.resetModules();
  });

  return (): Identity => {
    if (!identity) {
      throw new Error("The Identity modules did not load");
    }

    return identity;
  };
}

// The keys somebody who knows only what the repository ships could sign with.
function publicKeysOf(identity: Identity): Array<string> {
  return Array.from(
    new Set([identity.encryptionSecret, identity.encryptionSecret.trim()]),
  ).filter((key: string) => {
    return key.length > 0;
  });
}

// A resend token as the module writes one, signed under `rootKey`.
function resendTokenSignedWith(rootKey: string): string {
  const now: number = Date.now();
  const payloadB64: string = Buffer.from(
    JSON.stringify({
      v: 1,
      u: USER_ID,
      e: USER_EMAIL,
      i: now,
      x: now + 60 * 60 * 1000,
    }),
    "utf8",
  ).toString("base64url");
  const key: Buffer = crypto
    .createHmac("sha256", rootKey)
    .update(RESEND_TOKEN_LABEL)
    .digest();

  return `v1.${payloadB64}.${crypto
    .createHmac("sha256", key)
    .update(`v1.${payloadB64}`)
    .digest("base64url")}`;
}

// A confirmation link's signature, as the module computes one, under `key`.
function confirmationSignedWith(key: string, kind: string): string {
  return crypto
    .createHmac("sha256", key)
    .update(
      [CONFIRMATION_PURPOSE, CONFIRMATION_TOKEN, kind, PROJECT_ID, PROVIDER_ID].join(
        ":",
      ),
    )
    .digest("hex");
}

function isConfirmationValid(identity: Identity, signature: string): boolean {
  return identity.Confirmation.isSignatureValid({
    token: CONFIRMATION_TOKEN,
    signature,
    kind: identity.kind as never,
    projectId: PROJECT_ID,
    providerId: PROVIDER_ID,
  });
}

describe.each(SHIPPED_ENCRYPTION_SECRETS)(
  "an installation whose ENCRYPTION_SECRET is $label",
  ({ value }: ShippedEncryptionSecret) => {
    const identity: () => Identity = useIdentity(value);

    test("refuses a resend token signed under that value", () => {
      for (const key of publicKeysOf(identity())) {
        expect({
          key,
          claims: identity().ResendToken.verify(resendTokenSignedWith(key)),
        }).toEqual({ key, claims: null });
      }
    });

    test("still accepts the resend tokens it makes", () => {
      const token: string | null = identity().ResendToken.generate({
        userId: new (identity().ObjectID)(USER_ID),
        email: new (identity().Email)(USER_EMAIL),
      });

      expect(token).not.toBeNull();
      expect(
        identity().ResendToken.verify(token as string)?.userId.toString(),
      ).toBe(USER_ID);
    });

    test("refuses a confirmation link signed under that value", () => {
      for (const key of publicKeysOf(identity())) {
        expect({
          key,
          valid: isConfirmationValid(
            identity(),
            confirmationSignedWith(key, identity().kind),
          ),
        }).toEqual({ key, valid: false });
      }
    });

    test("still accepts the confirmation links it signs", () => {
      expect(
        isConfirmationValid(
          identity(),
          identity().Confirmation.getSignature({
            token: CONFIRMATION_TOKEN,
            kind: identity().kind as never,
            projectId: PROJECT_ID,
            providerId: PROVIDER_ID,
          }),
        ),
      ).toBe(true);
    });
  },
);

describe("an installation whose operator set ENCRYPTION_SECRET", () => {
  const identity: () => Identity = useIdentity(OPERATOR_ENCRYPTION_SECRET);

  test("still accepts a resend token it handed out before the upgrade", () => {
    expect(
      identity()
        .ResendToken.verify(resendTokenSignedWith(OPERATOR_ENCRYPTION_SECRET))
        ?.userId.toString(),
    ).toBe(USER_ID);
  });

  test("still accepts a confirmation link it mailed before the upgrade", () => {
    expect(
      isConfirmationValid(
        identity(),
        confirmationSignedWith(OPERATOR_ENCRYPTION_SECRET, identity().kind),
      ),
    ).toBe(true);
  });

  test("refuses both when signed under a value this repository ships", () => {
    for (const shipped of ["secret", "please-change-this-to-random-value"]) {
      expect(
        identity().ResendToken.verify(resendTokenSignedWith(shipped)),
      ).toBeNull();
      expect(
        isConfirmationValid(
          identity(),
          confirmationSignedWith(shipped, identity().kind),
        ),
      ).toBe(false);
    }
  });
});
