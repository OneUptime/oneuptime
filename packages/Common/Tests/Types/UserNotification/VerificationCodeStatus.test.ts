import VerificationCodeStatusJSON, {
  VerificationCodeState,
  VerificationCodeStatus,
} from "../../../Types/UserNotification/VerificationCodeStatus";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * The wire format of a verification-status answer, shared by the server
 * (which writes it) and the dashboard's verify dialog (which reads it). The
 * dialog acts on what it reads - it offers the code field only for an active
 * code - so a malformed answer must read as "nothing waiting", never as a
 * code that is.
 */

const SENT_AT: Date = new Date("2026-10-08T10:00:00.000Z");
const EXPIRES_AT: Date = new Date("2026-10-08T10:15:00.000Z");

const ACTIVE: VerificationCodeStatus = {
  isVerified: false,
  codeState: VerificationCodeState.Active,
  codeSentAt: SENT_AT,
  codeExpiresAt: EXPIRES_AT,
  resendAvailableInSeconds: 42,
  cannotSendReason: null,
};

describe("VerificationCodeStatusJSON", () => {
  test("the three states are named as the wire names them", () => {
    expect(Object.values(VerificationCodeState)).toEqual([
      "active",
      "expired",
      "none",
    ]);
  });

  test("times go over the wire as ISO 8601", () => {
    expect(VerificationCodeStatusJSON.toJSON(ACTIVE)).toEqual({
      isVerified: false,
      codeState: "active",
      codeSentAt: "2026-10-08T10:00:00.000Z",
      codeExpiresAt: "2026-10-08T10:15:00.000Z",
      resendAvailableInSeconds: 42,
      cannotSendReason: null,
    });
  });

  test("reads back what it wrote, through JSON", () => {
    const wire: JSONObject = JSON.parse(
      JSON.stringify(VerificationCodeStatusJSON.toJSON(ACTIVE)),
    );

    expect(VerificationCodeStatusJSON.fromJSON(wire)).toEqual(ACTIVE);
  });

  test("keeps the reason no code can be sent", () => {
    expect(
      VerificationCodeStatusJSON.fromJSON({
        codeState: "none",
        cannotSendReason: "No Twilio account is set up to send SMS.",
      }).cannotSendReason,
    ).toBe("No Twilio account is set up to send SMS.");
  });

  test("nothing, or an answer from an older server, reads as no code and nothing known", () => {
    const expected: VerificationCodeStatus = {
      isVerified: false,
      codeState: VerificationCodeState.None,
      codeSentAt: null,
      codeExpiresAt: null,
      resendAvailableInSeconds: 0,
      cannotSendReason: null,
    };

    expect(VerificationCodeStatusJSON.fromJSON(undefined)).toEqual(expected);
    expect(VerificationCodeStatusJSON.fromJSON(null)).toEqual(expected);
    expect(VerificationCodeStatusJSON.fromJSON({})).toEqual(expected);
  });

  test("a state it does not know is no code, not an active one", () => {
    expect(
      VerificationCodeStatusJSON.fromJSON({ codeState: "pending" }).codeState,
    ).toBe(VerificationCodeState.None);
    expect(
      VerificationCodeStatusJSON.fromJSON({ codeState: 1 as unknown as string })
        .codeState,
    ).toBe(VerificationCodeState.None);
  });

  test("only a real true is verified", () => {
    expect(
      VerificationCodeStatusJSON.fromJSON({ isVerified: "true" }).isVerified,
    ).toBe(false);
    expect(
      VerificationCodeStatusJSON.fromJSON({ isVerified: true }).isVerified,
    ).toBe(true);
  });

  test("an unreadable time is no time", () => {
    const status: VerificationCodeStatus = VerificationCodeStatusJSON.fromJSON({
      codeState: "active",
      codeSentAt: "not a date",
      codeExpiresAt: 12 as unknown as string,
    });

    expect(status.codeSentAt).toBeNull();
    expect(status.codeExpiresAt).toBeNull();
  });

  test("the cooldown is whole seconds, never negative and never nonsense", () => {
    const cooldownOf: (value: unknown) => number = (value: unknown): number => {
      return VerificationCodeStatusJSON.fromJSON({
        resendAvailableInSeconds: value as number,
      }).resendAvailableInSeconds;
    };

    expect(cooldownOf(41.2)).toBe(42);
    expect(cooldownOf(-5)).toBe(0);
    expect(cooldownOf("abc")).toBe(0);
    expect(cooldownOf(Number.POSITIVE_INFINITY)).toBe(0);
    expect(cooldownOf(undefined)).toBe(0);
  });

  test("a blank reason is no reason", () => {
    expect(
      VerificationCodeStatusJSON.fromJSON({ cannotSendReason: "   " })
        .cannotSendReason,
    ).toBeNull();
  });
});
