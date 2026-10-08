import ChannelVerification, {
  ChannelVerificationStatus,
  MAX_VERIFICATION_ATTEMPTS,
  RESEND_COOLDOWN_SECONDS,
  VerifiableChannelFields,
  VerificationCodeState,
} from "../../../Server/Utils/ChannelVerification";
import VerificationCode from "../../../Server/Utils/VerificationCode";
import DatabaseService from "../../../Server/Services/DatabaseService";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ErrorClass, {
  declaredErrorClass,
} from "../../../Types/Telemetry/ErrorClass";
import VerificationCodeStatusJSON from "../../../Types/UserNotification/VerificationCodeStatus";
import UserSMS from "../../../Models/DatabaseModels/UserSMS";
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
 * TELLING THE TRUTH ABOUT A VERIFICATION CODE.
 *
 * A self-hosted customer added their phone number with no Twilio account
 * set up. The code was issued, the SMS was sent fire-and-forget, the send
 * failed in the background - and the verify dialog said "We have sent a SMS
 * with your verification code". These pin the shared pieces that replaced
 * that:
 *
 *   - issueAndSendCode waits for the send, and a failed one comes back as
 *     the person's answer - with the reason - and leaves no live code;
 *   - sendFirstCodeOrRemoveItem takes a number whose first code could not
 *     be sent out again, so it does not sit in the list unverifiable;
 *   - getStatus says where a row's code stands, which is what the dialog
 *     now shows instead of a fixed sentence.
 *
 * Run against a fake row store, as ChannelVerification.test.ts is: the
 * claims are about the state a row is left in.
 */

const ITEM_ID: ObjectID = new ObjectID("6d2f0a1b-1111-4111-8111-111111111111");
const DESTINATION: string = "+15551230100";
const NOW: Date = new Date("2026-10-08T10:00:00.000Z");

interface StoredRow extends VerifiableChannelFields {
  _id?: string | undefined;
}

class FakeChannelService {
  public row: StoredRow | null = { _id: ITEM_ID.toString() };
  public updateCalls: Array<Record<string, unknown>> = [];
  public deleteCalls: Array<{ id: ObjectID; props: { isRoot: boolean } }> =
    [];

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

  public async deleteOneById(data: {
    id: ObjectID;
    props: { isRoot: boolean };
  }): Promise<number> {
    this.deleteCalls.push(data);
    this.row = null;
    return 1;
  }

  public getModel(): { tableName: string } {
    return { tableName: "FakeChannel" };
  }
}

const asService: (
  fake: FakeChannelService,
) => DatabaseService<UserSMS> = (
  fake: FakeChannelService,
): DatabaseService<UserSMS> => {
  return fake as unknown as DatabaseService<UserSMS>;
};

const notificationServiceRefusal: (message: string) => HTTPErrorResponse = (
  message: string,
): HTTPErrorResponse => {
  return new HTTPErrorResponse(400, { error: message }, {});
};

describe("issueAndSendCode", () => {
  let fake: FakeChannelService;

  beforeEach(() => {
    fake = new FakeChannelService();
  });

  it("hands the plaintext to the sender and stores only its digest", async () => {
    let sentCode: string = "";

    await ChannelVerification.issueAndSendCode({
      service: asService(fake),
      itemId: ITEM_ID,
      destination: DESTINATION,
      send: async (plainCode: string): Promise<void> => {
        sentCode = plainCode;
      },
    });

    expect(sentCode).toMatch(/^[0-9]{6}$/);
    expect(fake.row?.verificationCode).not.toBe(sentCode);
    expect(
      VerificationCode.isHashEqual(
        VerificationCode.hashCode({ code: sentCode, channelId: ITEM_ID }),
        fake.row?.verificationCode || "",
      ),
    ).toBe(true);
    expect(fake.row?.verificationCodeExpiresAt).toBeInstanceOf(Date);
  });

  it("a code that went out is left live, and the row written once", async () => {
    await ChannelVerification.issueAndSendCode({
      service: asService(fake),
      itemId: ITEM_ID,
      destination: DESTINATION,
      send: async (): Promise<void> => {},
    });

    expect(fake.updateCalls).toHaveLength(1);
    expect(
      ChannelVerification.isCodeExpired({
        expiresAt: fake.row?.verificationCodeExpiresAt,
      }),
    ).toBe(false);
  });

  it("a send that fails comes back to the caller, with where it was going and why", async () => {
    await expect(
      ChannelVerification.issueAndSendCode({
        service: asService(fake),
        itemId: ITEM_ID,
        destination: DESTINATION,
        send: async (): Promise<void> => {
          ChannelVerification.throwIfNotSent(
            notificationServiceRefusal(
              "No Twilio account is set up to send SMS.",
            ),
          );
        },
      }),
    ).rejects.toThrow(
      "The verification code was not sent to +15551230100. No Twilio account is set up to send SMS.",
    );
  });

  it("the failure is a BadDataException the person can read, classed as their setup, not a defect", async () => {
    let caught: unknown = null;

    try {
      await ChannelVerification.issueAndSendCode({
        service: asService(fake),
        itemId: ITEM_ID,
        destination: DESTINATION,
        send: async (): Promise<void> => {
          throw new Error("Twilio is down");
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BadDataException);
    expect(declaredErrorClass(caught)?.errorClass).toBe(ErrorClass.UserError);
  });

  /*
   * Nobody can know a code that was never delivered, so all a live one could
   * do is soak up guesses. The row is left with no code, and the dialog says
   * there is none rather than that one is waiting.
   */
  it("a code that never went out is not left live on the row", async () => {
    await expect(
      ChannelVerification.issueAndSendCode({
        service: asService(fake),
        itemId: ITEM_ID,
        destination: DESTINATION,
        send: async (): Promise<void> => {
          throw new Error("Twilio is down");
        },
      }),
    ).rejects.toThrow();

    expect(fake.updateCalls).toHaveLength(2);
    expect(fake.row?.verificationCodeExpiresAt).toBeNull();
    expect(fake.row?.verificationCode).toMatch(/^[0-9a-f]{64}$/);
    expect(
      ChannelVerification.getStatus({ item: fake.row!, now: NOW }).codeState,
    ).toBe(VerificationCodeState.None);
  });

  /*
   * The Notification service may fail after the message went out (recording
   * it, charging for it), and the cooldown is what stands between the resend
   * button and somebody's phone - so a failed send still counts.
   */
  it("the resend cooldown still counts from the attempt", async () => {
    await expect(
      ChannelVerification.issueAndSendCode({
        service: asService(fake),
        itemId: ITEM_ID,
        destination: DESTINATION,
        send: async (): Promise<void> => {
          throw new Error("Twilio is down");
        },
      }),
    ).rejects.toThrow();

    expect(fake.row?.verificationCodeSentAt).toBeInstanceOf(Date);
    expect(
      ChannelVerification.getResendRetryAfterSeconds({
        lastSentAt: fake.row?.verificationCodeSentAt,
      }),
    ).toBeGreaterThan(0);
  });

  it("still reports the send failure if clearing the code fails too", async () => {
    let calls: number = 0;
    fake.updateOneById = async (): Promise<number> => {
      calls++;

      if (calls === 2) {
        throw new Error("database unavailable");
      }

      return 1;
    };

    await expect(
      ChannelVerification.issueAndSendCode({
        service: asService(fake),
        itemId: ITEM_ID,
        destination: DESTINATION,
        send: async (): Promise<void> => {
          throw new Error("Twilio is down");
        },
      }),
    ).rejects.toThrow(
      "The verification code was not sent to +15551230100. Twilio is down.",
    );
  });
});

describe("sendFirstCodeOrRemoveItem", () => {
  let fake: FakeChannelService;

  beforeEach(() => {
    fake = new FakeChannelService();
  });

  it("keeps a number whose first code went out", async () => {
    await ChannelVerification.sendFirstCodeOrRemoveItem({
      service: asService(fake),
      itemId: ITEM_ID,
      issueAndSend: async (): Promise<void> => {},
    });

    expect(fake.deleteCalls).toHaveLength(0);
    expect(fake.row).not.toBeNull();
  });

  it("takes out a number whose first code could not be sent, and refuses the add with the reason", async () => {
    const failure: BadDataException = new BadDataException(
      "The verification code was not sent to +15551230100. No Twilio account is set up to send SMS.",
    );

    await expect(
      ChannelVerification.sendFirstCodeOrRemoveItem({
        service: asService(fake),
        itemId: ITEM_ID,
        issueAndSend: async (): Promise<void> => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);

    expect(fake.deleteCalls).toHaveLength(1);
    expect(fake.deleteCalls[0]!.id.toString()).toBe(ITEM_ID.toString());
    // As OneUptime: the person may not delete it themselves mid-create.
    expect(fake.deleteCalls[0]!.props.isRoot).toBe(true);
    expect(fake.row).toBeNull();
  });

  it("still refuses with the send's reason if taking the number out fails", async () => {
    fake.deleteOneById = async (): Promise<number> => {
      throw new Error("database unavailable");
    };

    await expect(
      ChannelVerification.sendFirstCodeOrRemoveItem({
        service: asService(fake),
        itemId: ITEM_ID,
        issueAndSend: async (): Promise<void> => {
          throw new BadDataException("The verification code was not sent.");
        },
      }),
    ).rejects.toThrow("The verification code was not sent.");
  });
});

describe("markVerified", () => {
  it("writes what a correct code writes: verified, no attempts, no code", async () => {
    const fake: FakeChannelService = new FakeChannelService();
    fake.row = {
      _id: ITEM_ID.toString(),
      isVerified: false,
      verificationFailedAttempts: 3,
      verificationCodeExpiresAt: new Date(NOW.getTime() + 60000),
    };

    await ChannelVerification.markVerified({
      service: asService(fake),
      itemId: ITEM_ID,
    });

    expect(fake.row.isVerified).toBe(true);
    expect(fake.row.verificationFailedAttempts).toBe(0);
    expect(fake.row.verificationCodeExpiresAt).toBeNull();
    expect(fake.row.verificationCode).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("throwIfNotSent", () => {
  it("throws the Notification service's refusal", () => {
    const refusal: HTTPErrorResponse = notificationServiceRefusal("Nope");

    expect(() => {
      ChannelVerification.throwIfNotSent(refusal);
    }).toThrow();

    try {
      ChannelVerification.throwIfNotSent(refusal);
    } catch (error) {
      expect(error).toBe(refusal);
    }
  });

  it("lets an answer that took the message through", () => {
    expect(() => {
      ChannelVerification.throwIfNotSent(
        new HTTPResponse<JSONObject>(200, {}, {}),
      );
    }).not.toThrow();
  });
});

describe("getSendFailureReason", () => {
  it("is what the Notification service said", () => {
    expect(
      ChannelVerification.getSendFailureReason(
        notificationServiceRefusal(
          "Twilio could not send this SMS: The 'To' number is not a valid phone number (Twilio error 21211).",
        ),
      ),
    ).toBe(
      "Twilio could not send this SMS: The 'To' number is not a valid phone number (Twilio error 21211).",
    );
  });

  it("is the thrown error's message, or the thrown text", () => {
    expect(
      ChannelVerification.getSendFailureReason(new Error("socket hang up.")),
    ).toBe("socket hang up.");
    expect(ChannelVerification.getSendFailureReason("Timed out!")).toBe(
      "Timed out!",
    );
  });

  it("always ends as a sentence", () => {
    expect(
      ChannelVerification.getSendFailureReason(new Error("socket hang up")),
    ).toBe("socket hang up.");
  });

  it("never 'Server Error' or nothing: a failure it cannot explain says to try again", () => {
    const retry: string =
      "Something went wrong while sending it. Please try again in a moment.";

    expect(
      ChannelVerification.getSendFailureReason(
        new HTTPErrorResponse(500, { error: "Server Error" }, {}),
      ),
    ).toBe(retry);
    expect(ChannelVerification.getSendFailureReason(new Error(""))).toBe(retry);
    expect(ChannelVerification.getSendFailureReason(undefined)).toBe(retry);
    expect(ChannelVerification.getSendFailureReason({ status: 500 })).toBe(
      retry,
    );
  });
});

describe("getStatus", () => {
  const sentAt: Date = new Date(NOW.getTime() - 20 * 1000);
  const expiresAt: Date = new Date(NOW.getTime() + 14 * 60 * 1000);

  it("a code that can still be entered: active, with when it went out and until when it works", () => {
    const status: ChannelVerificationStatus = ChannelVerification.getStatus({
      item: {
        isVerified: false,
        verificationCodeSentAt: sentAt,
        verificationCodeExpiresAt: expiresAt,
        verificationFailedAttempts: 1,
      },
      now: NOW,
    });

    expect(status).toEqual({
      isVerified: false,
      codeState: VerificationCodeState.Active,
      codeSentAt: sentAt,
      codeExpiresAt: expiresAt,
      resendAvailableInSeconds: RESEND_COOLDOWN_SECONDS - 20,
      cannotSendReason: null,
    });
  });

  it("a code whose time ran out: expired, and another may be sent", () => {
    const status: ChannelVerificationStatus = ChannelVerification.getStatus({
      item: {
        isVerified: false,
        verificationCodeSentAt: new Date(NOW.getTime() - 3600 * 1000),
        verificationCodeExpiresAt: new Date(NOW.getTime() - 2700 * 1000),
      },
      now: NOW,
    });

    expect(status.codeState).toBe(VerificationCodeState.Expired);
    expect(status.codeExpiresAt).toEqual(
      new Date(NOW.getTime() - 2700 * 1000),
    );
    expect(status.resendAvailableInSeconds).toBe(0);
  });

  it("no code on the row: none, and no times are claimed", () => {
    const status: ChannelVerificationStatus = ChannelVerification.getStatus({
      item: {
        isVerified: false,
        verificationCodeSentAt: sentAt,
        verificationCodeExpiresAt: undefined,
      },
      now: NOW,
    });

    expect(status.codeState).toBe(VerificationCodeState.None);
    expect(status.codeSentAt).toBeNull();
    expect(status.codeExpiresAt).toBeNull();
    // The cooldown still runs from the attempt.
    expect(status.resendAvailableInSeconds).toBe(RESEND_COOLDOWN_SECONDS - 20);
  });

  it("a code whose attempts are spent is no code, even before it is cleared", () => {
    const status: ChannelVerificationStatus = ChannelVerification.getStatus({
      item: {
        isVerified: false,
        verificationCodeSentAt: sentAt,
        verificationCodeExpiresAt: expiresAt,
        verificationFailedAttempts: MAX_VERIFICATION_ATTEMPTS,
      },
      now: NOW,
    });

    expect(status.codeState).toBe(VerificationCodeState.None);
  });

  it("carries why no code can be sent, from the channel's service", () => {
    expect(
      ChannelVerification.getStatus({
        item: { isVerified: false },
        cannotSendReason: "No Twilio account is set up to send SMS.",
        now: NOW,
      }).cannotSendReason,
    ).toBe("No Twilio account is set up to send SMS.");

    expect(
      ChannelVerification.getStatus({
        item: { isVerified: false },
        cannotSendReason: "",
        now: NOW,
      }).cannotSendReason,
    ).toBeNull();
  });

  it("a verified row has nothing waiting and nothing to refuse", () => {
    expect(
      ChannelVerification.getStatus({
        item: {
          isVerified: true,
          verificationCodeSentAt: sentAt,
          verificationCodeExpiresAt: expiresAt,
        },
        cannotSendReason: "SMS is off in this project.",
        now: NOW,
      }),
    ).toEqual({
      isVerified: true,
      codeState: VerificationCodeState.None,
      codeSentAt: null,
      codeExpiresAt: null,
      resendAvailableInSeconds: 0,
      cannotSendReason: null,
    });
  });

  it("goes over the wire with ISO times, and reads back the same", () => {
    const status: ChannelVerificationStatus = ChannelVerification.getStatus({
      item: {
        isVerified: false,
        verificationCodeSentAt: sentAt,
        verificationCodeExpiresAt: expiresAt,
      },
      now: NOW,
    });

    const json: JSONObject = ChannelVerification.statusToJSON(status);

    expect(json).toEqual({
      isVerified: false,
      codeState: "active",
      codeSentAt: sentAt.toISOString(),
      codeExpiresAt: expiresAt.toISOString(),
      resendAvailableInSeconds: RESEND_COOLDOWN_SECONDS - 20,
      cannotSendReason: null,
    });
    expect(
      VerificationCodeStatusJSON.fromJSON(JSON.parse(JSON.stringify(json))),
    ).toEqual(status);
  });
});
