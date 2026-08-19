import UserEmailService from "../../../Server/Services/UserEmailService";
import MailService from "../../../Server/Services/MailService";
import ChannelVerification, {
  RESEND_COOLDOWN_SECONDS,
} from "../../../Server/Utils/ChannelVerification";
import VerificationCode from "../../../Server/Utils/VerificationCode";
import ObjectID from "../../../Types/ObjectID";
import Email from "../../../Types/Email";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import Exception from "../../../Types/Exception/Exception";
import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import { beforeEach, describe, expect, it } from "@jest/globals";

jest.mock("../../../Server/Services/MailService");
jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

/*
 * GHSA-5cr8-vph4-3hrf, issuance side.
 *
 * The verify route is only half the story. The other half is what a code's
 * life looks like: it must be minted fresh, stored as a digest, sent in
 * plaintext exactly once, and NOT re-issuable on demand — because "spend the
 * five attempts, ask for another code, repeat" is otherwise a free bypass of
 * the attempt limit, paid for by whoever owns the address in unsolicited
 * messages.
 *
 * UserEmailService stands in for all five channels here. The three that go
 * over Twilio/WhatsApp wrap the identical calls in project balance checks; the
 * shared behaviour lives in ChannelVerification and is what these exercise.
 */

const ITEM_ID: ObjectID = new ObjectID("2c4e6a80-1111-4111-8111-111111111111");
const USER_ID: ObjectID = new ObjectID("2c4e6a80-2222-4222-8222-222222222222");
const PROJECT_ID: ObjectID = new ObjectID(
  "2c4e6a80-3333-4333-8333-333333333333",
);

type AnyRecord = Record<string, unknown>;

const buildItem: (overrides?: Partial<UserEmail>) => UserEmail = (
  overrides: Partial<UserEmail> = {},
) => {
  return {
    _id: ITEM_ID.toString(),
    id: ITEM_ID,
    userId: USER_ID,
    projectId: PROJECT_ID,
    email: Email.fromString("responder@example.com"),
    isVerified: false,
    ...overrides,
  } as UserEmail;
};

describe("notification channel verification code issuance", () => {
  let updateOneById: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    updateOneById = jest.fn().mockResolvedValue(1);
    UserEmailService.updateOneById = updateOneById as never;

    (MailService.sendMail as unknown as jest.Mock).mockResolvedValue(
      undefined as never,
    );
  });

  describe("issueAndSendVerificationCode", () => {
    it("stores a digest and never the code itself", async () => {
      await UserEmailService.issueAndSendVerificationCode(buildItem());

      const written: AnyRecord = (
        updateOneById.mock.calls[0]?.[0] as { data: AnyRecord }
      ).data;

      const sentCode: string = (
        (MailService.sendMail as unknown as jest.Mock).mock.calls[0]?.[0] as {
          vars: Record<string, string>;
        }
      ).vars["code"] as string;

      expect(sentCode).toMatch(/^[0-9]{6}$/);
      expect(written["verificationCode"]).not.toBe(sentCode);
      expect(written["verificationCode"]).toMatch(/^[0-9a-f]{64}$/);
    });

    it("stores a digest the sent code actually verifies against", async () => {
      await UserEmailService.issueAndSendVerificationCode(buildItem());

      const written: AnyRecord = (
        updateOneById.mock.calls[0]?.[0] as { data: AnyRecord }
      ).data;

      const sentCode: string = (
        (MailService.sendMail as unknown as jest.Mock).mock.calls[0]?.[0] as {
          vars: Record<string, string>;
        }
      ).vars["code"] as string;

      expect(
        VerificationCode.isHashEqual(
          VerificationCode.hashCode({
            code: sentCode,
            channelId: ITEM_ID,
          }),
          written["verificationCode"] as string,
        ),
      ).toBe(true);
    });

    it("sets an expiry and zeroes the attempt counter", async () => {
      await UserEmailService.issueAndSendVerificationCode(buildItem());

      const written: AnyRecord = (
        updateOneById.mock.calls[0]?.[0] as { data: AnyRecord }
      ).data;

      expect(written["verificationFailedAttempts"]).toBe(0);
      expect(written["verificationCodeExpiresAt"]).toBeInstanceOf(Date);
      expect(
        (written["verificationCodeExpiresAt"] as Date).getTime(),
      ).toBeGreaterThan(Date.now());
      expect(written["verificationCodeSentAt"]).toBeInstanceOf(Date);
    });

    it("mints a different code every time", async () => {
      const codes: Set<string> = new Set<string>();

      for (let i: number = 0; i < 25; i++) {
        await UserEmailService.issueAndSendVerificationCode(buildItem());
      }

      for (const call of (MailService.sendMail as unknown as jest.Mock).mock
        .calls) {
        codes.add(
          ((call as Array<unknown>)[0] as { vars: Record<string, string> })
            .vars["code"] as string,
        );
      }

      expect(codes.size).toBeGreaterThan(20);
    });

    it("sends to the address on the row", async () => {
      await UserEmailService.issueAndSendVerificationCode(buildItem());

      const mail: AnyRecord = (MailService.sendMail as unknown as jest.Mock)
        .mock.calls[0]?.[0] as AnyRecord;

      expect(mail["toEmail"]?.toString()).toBe("responder@example.com");
    });
  });

  describe("resendVerificationCode", () => {
    const stubFind: (item: UserEmail | null) => void = (
      item: UserEmail | null,
    ) => {
      UserEmailService.findOneById = jest
        .fn()
        .mockResolvedValue(item as never) as never;
    };

    it("refuses an unknown item", async () => {
      stubFind(null);

      await expect(
        UserEmailService.resendVerificationCode(ITEM_ID),
      ).rejects.toThrow("not found");
    });

    it("refuses a row that is already verified", async () => {
      stubFind(buildItem({ isVerified: true }));

      await expect(
        UserEmailService.resendVerificationCode(ITEM_ID),
      ).rejects.toThrow("already verified");

      expect(MailService.sendMail).not.toHaveBeenCalled();
    });

    it("sends when no code has been sent before", async () => {
      stubFind(buildItem());

      await UserEmailService.resendVerificationCode(ITEM_ID);

      expect(MailService.sendMail).toHaveBeenCalled();
    });

    /*
     * The control on "burn the attempts, request a new code, repeat" — and on
     * using the resend button to message somebody repeatedly.
     */
    it("refuses a resend inside the cooldown", async () => {
      stubFind(
        buildItem({
          verificationCodeSentAt: new Date(Date.now() - 5000),
        }),
      );

      let thrown: Exception | undefined = undefined;

      try {
        await UserEmailService.resendVerificationCode(ITEM_ID);
      } catch (err) {
        thrown = err as Exception;
      }

      expect(thrown?.code).toBe(ExceptionCode.TooManyRequestsException);
      expect(thrown?.message).toContain("Please wait");
      expect(MailService.sendMail).not.toHaveBeenCalled();
    });

    it("does not issue a new code when it refuses the resend", async () => {
      stubFind(
        buildItem({
          verificationCodeSentAt: new Date(Date.now() - 1000),
        }),
      );

      await expect(
        UserEmailService.resendVerificationCode(ITEM_ID),
      ).rejects.toThrow();

      expect(updateOneById).not.toHaveBeenCalled();
    });

    it("allows a resend once the cooldown has elapsed", async () => {
      stubFind(
        buildItem({
          verificationCodeSentAt: new Date(
            Date.now() - (RESEND_COOLDOWN_SECONDS + 5) * 1000,
          ),
        }),
      );

      await UserEmailService.resendVerificationCode(ITEM_ID);

      expect(MailService.sendMail).toHaveBeenCalled();
    });

    /*
     * A resend must hand out a NEW code. Re-sending the same one would make
     * the attempt counter worthless — the attacker resumes against the value
     * they were already working on.
     */
    it("issues a fresh code rather than resending the old one", async () => {
      const previousDigest: string = VerificationCode.hashCode({
        code: "123456",
        channelId: ITEM_ID,
      });

      stubFind(
        buildItem({
          verificationCode: previousDigest,
          verificationCodeExpiresAt: ChannelVerification.getExpiresAt(),
        }),
      );

      await UserEmailService.resendVerificationCode(ITEM_ID);

      const written: AnyRecord = (
        updateOneById.mock.calls[0]?.[0] as { data: AnyRecord }
      ).data;

      expect(written["verificationCode"]).not.toBe(previousDigest);
      expect(written["verificationFailedAttempts"]).toBe(0);
    });

    /*
     * The row is looked up without asking for the code column at all — the
     * send no longer needs it, because the plaintext is produced at issue
     * time and never read back.
     */
    it("does not read the stored code back in order to send it", async () => {
      stubFind(buildItem());

      await UserEmailService.resendVerificationCode(ITEM_ID);

      const select: AnyRecord = (
        (UserEmailService.findOneById as unknown as jest.Mock).mock
          .calls[0]?.[0] as { select: AnyRecord }
      ).select;

      expect(select["verificationCode"]).toBeUndefined();
    });
  });
});
