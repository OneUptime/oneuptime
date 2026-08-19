import ChannelVerification, {
  ChannelVerificationOutcome,
  ChannelVerificationResult,
  MAX_VERIFICATION_ATTEMPTS,
  RESEND_COOLDOWN_SECONDS,
  VERIFICATION_CODE_EXPIRY_MINUTES,
  VerifiableChannelFields,
} from "../../../Server/Utils/ChannelVerification";
import VerificationCode from "../../../Server/Utils/VerificationCode";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ObjectID from "../../../Types/ObjectID";
import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

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
 * GHSA-5cr8-vph4-3hrf — the four controls that replace "compare the column".
 *
 * These run against a fake row store rather than mocks-that-assert, because
 * the interesting claims are about STATE: that an attempt is consumed even
 * when the request racing it also consumed one, that crossing the limit burns
 * the stored challenge rather than merely refusing the request in front of it,
 * and that a used code stops working. A test that only checked which methods
 * were called would pass against a version that did none of those things.
 */

const ITEM_ID: ObjectID = new ObjectID("4c1e0c8e-1111-4111-8111-111111111111");
const OWNER_ID: ObjectID = new ObjectID("4c1e0c8e-2222-4222-8222-222222222222");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "4c1e0c8e-3333-4333-8333-333333333333",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "4c1e0c8e-4444-4444-8444-444444444444",
);

interface StoredRow extends VerifiableChannelFields {
  _id?: string | undefined;
}

/*
 * A stand-in for one channel service. findOneById/updateOneById read and
 * write the row; the increment really increments, so concurrency can be
 * exercised rather than asserted about.
 */
class FakeChannelService {
  public row: StoredRow | null = null;
  public updateCalls: Array<Record<string, unknown>> = [];
  public incrementCalls: number = 0;

  public async findOneById(): Promise<StoredRow | null> {
    if (!this.row) {
      return null;
    }

    /* A copy, so the caller cannot accidentally mutate the store. */
    return { ...this.row };
  }

  public async updateOneById(data: {
    id: ObjectID;
    data: Record<string, unknown>;
  }): Promise<number> {
    this.updateCalls.push(data.data);

    if (this.row) {
      this.row = { ...this.row, ...(data.data as StoredRow) };
    }

    return 1;
  }

  public async atomicIncrementColumnValueByOneAndGetValue(data: {
    columnName: string;
  }): Promise<number> {
    this.incrementCalls++;

    if (!this.row) {
      throw new Error("row not found");
    }

    const next: number =
      ((this.row as unknown as Record<string, number>)[data.columnName] || 0) +
      1;

    (this.row as unknown as Record<string, number>)[data.columnName] = next;

    return next;
  }

  public getModel(): { tableName: string } {
    return { tableName: "UserEmail" };
  }
}

type ServiceUnderTest = DatabaseService<UserEmail>;

const asService: (fake: FakeChannelService) => ServiceUnderTest = (
  fake: FakeChannelService,
) => {
  return fake as unknown as ServiceUnderTest;
};

const buildLiveRow: (overrides?: Partial<StoredRow>) => StoredRow = (
  overrides: Partial<StoredRow> = {},
) => {
  return {
    _id: ITEM_ID.toString(),
    userId: OWNER_ID,
    projectId: PROJECT_ID,
    isVerified: false,
    verificationCode: VerificationCode.hashCode({
      code: "123456",
      channelId: ITEM_ID,
    }),
    verificationCodeExpiresAt: ChannelVerification.getExpiresAt(),
    verificationFailedAttempts: 0,
    verificationCodeSentAt: new Date(),
    ...overrides,
  };
};

const verify: (
  fake: FakeChannelService,
  code: string,
  userId?: ObjectID,
) => Promise<ChannelVerificationResult> = (
  fake: FakeChannelService,
  code: string,
  userId?: ObjectID,
) => {
  return ChannelVerification.verifyCode({
    service: asService(fake),
    itemId: ITEM_ID,
    userId: userId || OWNER_ID,
    code,
  });
};

describe("ChannelVerification", () => {
  let service: FakeChannelService;

  beforeEach(() => {
    service = new FakeChannelService();
    service.row = buildLiveRow();
  });

  describe("issueCode", () => {
    it("stores a digest and never the code", () => {
      const issued: {
        plainCode: string;
        fields: VerifiableChannelFields;
      } = ChannelVerification.issueCode({ channelId: ITEM_ID });

      expect(issued.plainCode).toMatch(/^[0-9]{6}$/);
      expect(issued.fields.verificationCode).not.toBe(issued.plainCode);
      expect(issued.fields.verificationCode).toMatch(/^[0-9a-f]{64}$/);
    });

    it("stores a digest that the plaintext verifies against", () => {
      const issued: {
        plainCode: string;
        fields: VerifiableChannelFields;
      } = ChannelVerification.issueCode({ channelId: ITEM_ID });

      expect(
        VerificationCode.isHashEqual(
          VerificationCode.hashCode({
            code: issued.plainCode,
            channelId: ITEM_ID,
          }),
          issued.fields.verificationCode as string,
        ),
      ).toBe(true);
    });

    it("sets an expiry, records the send, and resets the attempt counter", () => {
      const now: Date = new Date("2026-03-01T12:00:00.000Z");

      const issued: {
        plainCode: string;
        fields: VerifiableChannelFields;
      } = ChannelVerification.issueCode({ channelId: ITEM_ID, now });

      expect(issued.fields.verificationCodeExpiresAt).toEqual(
        new Date(now.getTime() + VERIFICATION_CODE_EXPIRY_MINUTES * 60 * 1000),
      );
      expect(issued.fields.verificationCodeSentAt).toEqual(now);
      expect(issued.fields.verificationFailedAttempts).toBe(0);
    });

    /*
     * A resend has to hand the attacker a NEW target, not the same one back.
     * Reissuing the same code would make the attempt counter worthless: burn
     * five, resend, resume against the same value.
     */
    it("issues a different code each time", () => {
      const codes: Set<string> = new Set<string>();

      for (let i: number = 0; i < 200; i++) {
        codes.add(
          ChannelVerification.issueCode({ channelId: ITEM_ID }).plainCode,
        );
      }

      expect(codes.size).toBeGreaterThan(190);
    });
  });

  describe("issueCodeOnItem", () => {
    it("writes the digest, expiry, sent time and a zeroed counter to the row", async () => {
      const plainCode: string = await ChannelVerification.issueCodeOnItem({
        service: asService(service),
        itemId: ITEM_ID,
      });

      const written: Record<string, unknown> = service.updateCalls[0] as Record<
        string,
        unknown
      >;

      expect(Object.keys(written).sort()).toEqual([
        "verificationCode",
        "verificationCodeExpiresAt",
        "verificationCodeSentAt",
        "verificationFailedAttempts",
      ]);
      expect(written["verificationCode"]).not.toBe(plainCode);
      expect(written["verificationFailedAttempts"]).toBe(0);
    });

    it("returns a code that then verifies against the stored row", async () => {
      const plainCode: string = await ChannelVerification.issueCodeOnItem({
        service: asService(service),
        itemId: ITEM_ID,
      });

      const result: ChannelVerificationResult = await verify(
        service,
        plainCode,
      );

      expect(result.outcome).toBe(ChannelVerificationOutcome.Verified);
    });
  });

  describe("isCodeExpired", () => {
    it("treats a future expiry as live", () => {
      expect(
        ChannelVerification.isCodeExpired({
          expiresAt: new Date(Date.now() + 60000),
        }),
      ).toBe(false);
    });

    it("treats a past expiry as expired", () => {
      expect(
        ChannelVerification.isCodeExpired({
          expiresAt: new Date(Date.now() - 1),
        }),
      ).toBe(true);
    });

    it("treats the exact expiry instant as expired", () => {
      const now: Date = new Date("2026-03-01T12:00:00.000Z");

      expect(ChannelVerification.isCodeExpired({ expiresAt: now, now })).toBe(
        true,
      );
    });

    /*
     * Rows written before this column existed carry a plaintext code and no
     * expiry. Reading a missing expiry as "never expires" would leave exactly
     * the vulnerable state in place on every one of them.
     */
    it("treats a missing expiry as expired, not as never-expiring", () => {
      expect(ChannelVerification.isCodeExpired({})).toBe(true);
      expect(ChannelVerification.isCodeExpired({ expiresAt: null })).toBe(true);
      expect(ChannelVerification.isCodeExpired({ expiresAt: undefined })).toBe(
        true,
      );
    });
  });

  describe("getResendRetryAfterSeconds", () => {
    it("allows the first send", () => {
      expect(ChannelVerification.getResendRetryAfterSeconds({})).toBe(0);
    });

    it("allows a send once the cooldown has elapsed", () => {
      expect(
        ChannelVerification.getResendRetryAfterSeconds({
          lastSentAt: new Date(
            Date.now() - RESEND_COOLDOWN_SECONDS * 1000 - 1000,
          ),
        }),
      ).toBe(0);
    });

    it("refuses a send inside the cooldown and says how long to wait", () => {
      const now: Date = new Date("2026-03-01T12:00:30.000Z");
      const lastSentAt: Date = new Date("2026-03-01T12:00:00.000Z");

      expect(
        ChannelVerification.getResendRetryAfterSeconds({ lastSentAt, now }),
      ).toBe(RESEND_COOLDOWN_SECONDS - 30);
    });

    /*
     * A timestamp in the future means a clock moved, not that the caller has
     * earned a free send — reading it as elapsed time would hand out an
     * unlimited resend budget to anybody who could nudge one.
     */
    it("treats a future send time as a full cooldown", () => {
      expect(
        ChannelVerification.getResendRetryAfterSeconds({
          lastSentAt: new Date(Date.now() + 60_000),
        }),
      ).toBe(RESEND_COOLDOWN_SECONDS);
    });
  });

  describe("verifyCode", () => {
    it("accepts the right code and marks the row verified", async () => {
      const result: ChannelVerificationResult = await verify(service, "123456");

      expect(result.outcome).toBe(ChannelVerificationOutcome.Verified);
      expect(result.userId?.toString()).toBe(OWNER_ID.toString());
      expect(result.projectId?.toString()).toBe(PROJECT_ID.toString());
      expect(service.row?.isVerified).toBe(true);
    });

    it("refuses a wrong code", async () => {
      const result: ChannelVerificationResult = await verify(service, "654321");

      expect(result.outcome).toBe(ChannelVerificationOutcome.IncorrectCode);
      expect(service.row?.isVerified).toBeFalsy();
    });

    it("refuses a missing row", async () => {
      service.row = null;

      expect((await verify(service, "123456")).outcome).toBe(
        ChannelVerificationOutcome.NotFound,
      );
    });

    /*
     * The row can legitimately hold somebody else's address — that is how
     * "add my phone" works — so ownership is the check that keeps one user
     * from verifying another user's channel.
     */
    it("refuses a caller who does not own the row", async () => {
      const result: ChannelVerificationResult = await verify(
        service,
        "123456",
        OTHER_USER_ID,
      );

      expect(result.outcome).toBe(ChannelVerificationOutcome.NotOwner);
      expect(service.row?.isVerified).toBeFalsy();
    });

    it("does not spend an attempt when the caller is not the owner", async () => {
      await verify(service, "654321", OTHER_USER_ID);

      expect(service.incrementCalls).toBe(0);
      expect(service.row?.verificationFailedAttempts).toBe(0);
    });

    it("refuses a row that is already verified", async () => {
      service.row = buildLiveRow({ isVerified: true });

      expect((await verify(service, "123456")).outcome).toBe(
        ChannelVerificationOutcome.AlreadyVerified,
      );
    });

    describe("expiry", () => {
      it("refuses a code past its expiry, even the correct one", async () => {
        service.row = buildLiveRow({
          verificationCodeExpiresAt: new Date(Date.now() - 1000),
        });

        const result: ChannelVerificationResult = await verify(
          service,
          "123456",
        );

        expect(result.outcome).toBe(ChannelVerificationOutcome.Expired);
        expect(service.row?.isVerified).toBeFalsy();
      });

      it("refuses a row that has no expiry recorded at all", async () => {
        service.row = buildLiveRow({ verificationCodeExpiresAt: undefined });

        expect((await verify(service, "123456")).outcome).toBe(
          ChannelVerificationOutcome.Expired,
        );
      });

      it("does not spend an attempt on an expired code", async () => {
        service.row = buildLiveRow({
          verificationCodeExpiresAt: new Date(Date.now() - 1000),
        });

        await verify(service, "654321");

        expect(service.incrementCalls).toBe(0);
      });
    });

    describe("attempt limit", () => {
      it("allows exactly MAX_VERIFICATION_ATTEMPTS wrong guesses", async () => {
        for (let i: number = 1; i <= MAX_VERIFICATION_ATTEMPTS; i++) {
          const result: ChannelVerificationResult = await verify(
            service,
            "000000",
          );

          expect(result.outcome).toBe(ChannelVerificationOutcome.IncorrectCode);
        }

        expect((await verify(service, "000000")).outcome).toBe(
          ChannelVerificationOutcome.TooManyAttempts,
        );
      });

      /*
       * The heart of the advisory: a bounded number of guesses per code, so
       * walking a 10^6 space at request speed is not available.
       */
      it("refuses the correct code once the limit is crossed", async () => {
        for (let i: number = 0; i < MAX_VERIFICATION_ATTEMPTS; i++) {
          await verify(service, "000000");
        }

        const result: ChannelVerificationResult = await verify(
          service,
          "123456",
        );

        expect(result.outcome).toBe(ChannelVerificationOutcome.TooManyAttempts);
        expect(service.row?.isVerified).toBeFalsy();
      });

      /*
       * Rotation, not merely refusal. A lockout that leaves the challenge
       * intact is a pause the attacker waits out with the same target still
       * behind it.
       */
      it("burns the stored challenge when the limit is crossed", async () => {
        const originalDigest: string | undefined =
          service.row?.verificationCode;

        for (let i: number = 0; i < MAX_VERIFICATION_ATTEMPTS + 1; i++) {
          await verify(service, "000000");
        }

        expect(service.row?.verificationCode).not.toBe(originalDigest);
        expect(service.row?.verificationCodeExpiresAt).toBeNull();
      });

      it("rewrites the challenge once, not on every request after the limit", async () => {
        for (let i: number = 0; i < MAX_VERIFICATION_ATTEMPTS + 5; i++) {
          await verify(service, "000000");
        }

        /* One write on the crossing, and none for the four requests after it. */
        expect(service.updateCalls).toHaveLength(1);
      });

      /*
       * Concurrency. A read-modify-write counter lets N simultaneous requests
       * all observe the same pre-increment value and all decide they are
       * inside the limit — which is precisely the shape of a brute-force
       * loop. Every attempt must consume its own slot.
       */
      it("consumes a slot per attempt even when attempts run concurrently", async () => {
        const attempts: number = MAX_VERIFICATION_ATTEMPTS + 10;

        const results: Array<ChannelVerificationResult> = await Promise.all(
          Array.from({ length: attempts }, () => {
            return verify(service, "000000");
          }),
        );

        const lockedOut: number = results.filter(
          (result: ChannelVerificationResult) => {
            return (
              result.outcome === ChannelVerificationOutcome.TooManyAttempts
            );
          },
        ).length;

        expect(lockedOut).toBe(attempts - MAX_VERIFICATION_ATTEMPTS);
        expect(service.row?.verificationFailedAttempts).toBe(attempts);
      });

      it("counts an attempt before it reveals whether the code was right", async () => {
        await verify(service, "000000");

        expect(service.row?.verificationFailedAttempts).toBe(1);
      });

      it("gives a fresh attempt budget only by issuing a fresh code", async () => {
        for (let i: number = 0; i < MAX_VERIFICATION_ATTEMPTS + 1; i++) {
          await verify(service, "000000");
        }

        const plainCode: string = await ChannelVerification.issueCodeOnItem({
          service: asService(service),
          itemId: ITEM_ID,
        });

        expect(service.row?.verificationFailedAttempts).toBe(0);
        expect((await verify(service, plainCode)).outcome).toBe(
          ChannelVerificationOutcome.Verified,
        );
      });
    });

    describe("single use", () => {
      it("clears the challenge when a code succeeds", async () => {
        const originalDigest: string | undefined =
          service.row?.verificationCode;

        await verify(service, "123456");

        expect(service.row?.verificationCode).not.toBe(originalDigest);
        expect(service.row?.verificationCodeExpiresAt).toBeNull();
        expect(service.row?.verificationFailedAttempts).toBe(0);
      });

      it("refuses the same code a second time", async () => {
        expect((await verify(service, "123456")).outcome).toBe(
          ChannelVerificationOutcome.Verified,
        );

        expect((await verify(service, "123456")).outcome).toBe(
          ChannelVerificationOutcome.AlreadyVerified,
        );
      });
    });

    describe("comparison", () => {
      /*
       * The stored value is a digest now, so a caller who somehow read the
       * column cannot replay it as the code. This is the test that fails if
       * anyone reintroduces `item.verificationCode === req.body.code`.
       */
      it("does not accept the stored digest as if it were the code", async () => {
        const storedDigest: string = service.row?.verificationCode as string;

        expect((await verify(service, storedDigest)).outcome).toBe(
          ChannelVerificationOutcome.IncorrectCode,
        );
      });

      it("does not accept a code issued for a different row", async () => {
        const otherRowId: ObjectID = new ObjectID(
          "4c1e0c8e-5555-4555-8555-555555555555",
        );

        service.row = buildLiveRow({
          verificationCode: VerificationCode.hashCode({
            code: "123456",
            channelId: otherRowId,
          }),
        });

        expect((await verify(service, "123456")).outcome).toBe(
          ChannelVerificationOutcome.IncorrectCode,
        );
      });

      it("compares codes as strings, so a numeric body still works", async () => {
        const result: ChannelVerificationResult =
          await ChannelVerification.verifyCode({
            service: asService(service),
            itemId: ITEM_ID,
            userId: OWNER_ID,
            code: 123456 as unknown as string,
          });

        expect(result.outcome).toBe(ChannelVerificationOutcome.Verified);
      });

      it("refuses an empty stored digest rather than matching an empty code", async () => {
        service.row = buildLiveRow({ verificationCode: "" });

        expect((await verify(service, "")).outcome).toBe(
          ChannelVerificationOutcome.IncorrectCode,
        );
      });
    });
  });

  describe("getFailureException", () => {
    it("says nothing about whether a wrong code was close", () => {
      expect(
        ChannelVerification.getFailureException(
          ChannelVerificationOutcome.IncorrectCode,
        ).message,
      ).toBe("Invalid code");
    });

    it("tells a user with an expired or exhausted code to ask for a new one", () => {
      expect(
        ChannelVerification.getFailureException(
          ChannelVerificationOutcome.Expired,
        ).message,
      ).toContain("request a new code");

      expect(
        ChannelVerification.getFailureException(
          ChannelVerificationOutcome.TooManyAttempts,
        ).message,
      ).toContain("request a new code");
    });

    it("keeps the original wording for the two pre-existing failures", () => {
      expect(
        ChannelVerification.getFailureException(
          ChannelVerificationOutcome.NotFound,
        ).message,
      ).toBe("Item not found");

      expect(
        ChannelVerification.getFailureException(
          ChannelVerificationOutcome.NotOwner,
        ).message,
      ).toBe("Invalid user ID");
    });
  });

  /*
   * The end-to-end shape of the attack in the advisory, run against the new
   * code: create a row for somebody else's address and walk the code space.
   */
  describe("brute force", () => {
    it("cannot be walked to a verification within one issued code", async () => {
      const plainCode: string = await ChannelVerification.issueCodeOnItem({
        service: asService(service),
        itemId: ITEM_ID,
      });

      let verified: boolean = false;

      for (let guess: number = 0; guess < 1000; guess++) {
        const candidate: string = guess.toString().padStart(6, "0");

        if (candidate === plainCode) {
          continue;
        }

        const result: ChannelVerificationResult = await verify(
          service,
          candidate,
        );

        if (result.outcome === ChannelVerificationOutcome.Verified) {
          verified = true;
          break;
        }
      }

      expect(verified).toBe(false);
      expect(service.row?.isVerified).toBeFalsy();

      /* And the real code is dead too, so the attacker gained nothing. */
      expect((await verify(service, plainCode)).outcome).toBe(
        ChannelVerificationOutcome.TooManyAttempts,
      );
    });
  });
});
