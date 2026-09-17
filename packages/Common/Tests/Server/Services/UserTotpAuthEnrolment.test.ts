import UserTotpAuthService from "../../../Server/Services/UserTotpAuthService";
import UserService from "../../../Server/Services/UserService";
import TotpAuth from "../../../Server/Utils/TotpAuth";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import UserTotpAuth from "../../../Models/DatabaseModels/UserTotpAuth";
import User from "../../../Models/DatabaseModels/User";
import * as OTPAuth from "otpauth";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Enrolment — the moment a secret is minted and the QR code the user is about
 * to scan is frozen into `twoFactorOtpUrl`.
 *
 * This is where issue #3275 was born. The URL written here is the ONLY thing
 * the authenticator app ever sees; nothing downstream can renegotiate it. If
 * it advertises an algorithm the app will not honour, the enrolment is dead on
 * arrival and no amount of retrying at verification time can rescue it. So the
 * property under test is not "a URL was produced" but "the code an app
 * computes from this URL is the code the server will accept" — asserted by
 * going through the round trip rather than by string-matching.
 */

jest.mock("../../../Server/Services/UserService");

const USER_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const USER_EMAIL: Email = new Email("enrolling.user@example.com");

/*
 * `signedInUserId: null` models a request that reached the service with no
 * authenticated user on it.
 */
type BuildCreateByFunction = (options?: {
  signedInUserId?: ObjectID | null;
}) => CreateBy<UserTotpAuth>;

const buildCreateBy: BuildCreateByFunction = (options?: {
  signedInUserId?: ObjectID | null;
}): CreateBy<UserTotpAuth> => {
  const model: UserTotpAuth = new UserTotpAuth();
  model.name = "Google Authenticator";

  const signedInUserId: ObjectID | null =
    options && "signedInUserId" in options
      ? (options.signedInUserId as ObjectID | null)
      : USER_ID;

  return {
    data: model,
    props: {
      userId: signedInUserId === null ? undefined : signedInUserId,
    },
  } as unknown as CreateBy<UserTotpAuth>;
};

type RunOnBeforeCreateFunction = (
  createBy: CreateBy<UserTotpAuth>,
) => Promise<OnCreate<UserTotpAuth>>;

const runOnBeforeCreate: RunOnBeforeCreateFunction = async (
  createBy: CreateBy<UserTotpAuth>,
): Promise<OnCreate<UserTotpAuth>> => {
  return (await (
    UserTotpAuthService as unknown as {
      onBeforeCreate: RunOnBeforeCreateFunction;
    }
  ).onBeforeCreate(createBy)) as OnCreate<UserTotpAuth>;
};

describe("UserTotpAuthService enrolment", () => {
  beforeEach(() => {
    const user: User = new User();
    user.id = USER_ID;
    user.email = USER_EMAIL;

    UserService.findOneById = jest.fn().mockResolvedValue(user) as never;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("the QR code it freezes into the row", () => {
    test("advertises SHA1, so Google Authenticator computes what the server checks", async () => {
      const result: OnCreate<UserTotpAuth> =
        await runOnBeforeCreate(buildCreateBy());

      const url: string = result.createBy.data.twoFactorOtpUrl!;

      expect(url).toContain("algorithm=SHA1");
      expect(url).not.toContain("SHA256");
    });

    /*
     * The end-to-end property, and the one that actually matters: take the URL
     * exactly as the phone would read it, produce a code from it, and hand
     * that code to the same verifier the validate endpoint uses.
     */
    test("produces a QR code whose codes the verifier accepts", async () => {
      const result: OnCreate<UserTotpAuth> =
        await runOnBeforeCreate(buildCreateBy());

      const scanned: OTPAuth.TOTP = OTPAuth.URI.parse(
        result.createBy.data.twoFactorOtpUrl!,
      ) as OTPAuth.TOTP;

      expect(
        TotpAuth.verifyToken({
          secret: result.createBy.data.twoFactorSecret!,
          token: scanned.generate(),
          email: USER_EMAIL,
        }),
      ).toBe(true);
    });

    test("labels the entry with the enrolling user's email", async () => {
      const result: OnCreate<UserTotpAuth> =
        await runOnBeforeCreate(buildCreateBy());

      expect(
        decodeURIComponent(result.createBy.data.twoFactorOtpUrl!),
      ).toContain("enrolling.user@example.com");
    });

    test("embeds the same secret it stores on the row", async () => {
      const result: OnCreate<UserTotpAuth> =
        await runOnBeforeCreate(buildCreateBy());

      const scanned: OTPAuth.TOTP = OTPAuth.URI.parse(
        result.createBy.data.twoFactorOtpUrl!,
      ) as OTPAuth.TOTP;

      expect(scanned.secret.base32).toBe(result.createBy.data.twoFactorSecret);
    });
  });

  describe("the row it writes", () => {
    test("mints a fresh secret rather than trusting anything from the client", async () => {
      const createBy: CreateBy<UserTotpAuth> = buildCreateBy();

      (createBy.data as UserTotpAuth).twoFactorSecret =
        "ATTACKERCHOSENSECRETAAAAAAAAAAAA";

      const result: OnCreate<UserTotpAuth> = await runOnBeforeCreate(createBy);

      expect(result.createBy.data.twoFactorSecret).not.toBe(
        "ATTACKERCHOSENSECRETAAAAAAAAAAAA",
      );
    });

    test("issues a different secret to every enrolment", async () => {
      const first: OnCreate<UserTotpAuth> =
        await runOnBeforeCreate(buildCreateBy());
      const second: OnCreate<UserTotpAuth> =
        await runOnBeforeCreate(buildCreateBy());

      expect(first.createBy.data.twoFactorSecret).not.toBe(
        second.createBy.data.twoFactorSecret,
      );
    });

    /*
     * A newly created row is a claim, not a second factor. It only becomes one
     * once the user proves they scanned it — otherwise anyone could create a
     * row and count it as their 2FA method.
     */
    test("starts unverified no matter what the client asked for", async () => {
      const createBy: CreateBy<UserTotpAuth> = buildCreateBy();
      (createBy.data as UserTotpAuth).isVerified = true;

      const result: OnCreate<UserTotpAuth> = await runOnBeforeCreate(createBy);

      expect(result.createBy.data.isVerified).toBe(false);
    });

    test("binds the row to the signed-in user, not to a client-supplied id", async () => {
      const createBy: CreateBy<UserTotpAuth> = buildCreateBy();

      (createBy.data as UserTotpAuth).userId = new ObjectID(
        "55555555-5555-4555-8555-555555555555",
      );

      const result: OnCreate<UserTotpAuth> = await runOnBeforeCreate(createBy);

      expect(result.createBy.data.userId).toBe(USER_ID);
    });
  });

  describe("when it cannot enrol", () => {
    test("refuses without a signed-in user", async () => {
      await expect(
        runOnBeforeCreate(buildCreateBy({ signedInUserId: null })),
      ).rejects.toThrow(BadDataException);
    });

    test("refuses when the user record has gone", async () => {
      UserService.findOneById = jest.fn().mockResolvedValue(null) as never;

      await expect(runOnBeforeCreate(buildCreateBy())).rejects.toThrow(
        BadDataException,
      );
    });

    test("refuses when the user has no email to label the entry with", async () => {
      const emailless: User = new User();
      emailless.id = USER_ID;

      UserService.findOneById = jest.fn().mockResolvedValue(emailless) as never;

      await expect(runOnBeforeCreate(buildCreateBy())).rejects.toThrow(
        BadDataException,
      );
    });
  });
});
