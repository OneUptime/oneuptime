import TwilioConfigUses, {
  DEFAULT_TWILIO_CONFIG_USE,
  PRIMARY_PHONE_NUMBER_TITLE,
  SMS_PHONE_NUMBERS_TITLE,
  TWILIO_CONFIG_USES,
  TwilioConfigUse,
  USED_FOR_TITLE,
} from "../../../Types/CallAndSMS/TwilioConfigUse";
import { MAX_REFUSED_VALUE_LENGTH } from "../../../Utils/RefusedValue";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT A TWILIO CONFIG IS USED FOR: CALLS AND SMS, SMS ONLY, OR CALLS ONLY.
 *
 * A customer's Twilio account sent only SMS, from a mobile number
 * registered for it, yet the config made them type in a number to make
 * calls from. So a config says what it is used for, and needs only the
 * numbers that takes. These pin the rule every other piece reads: the
 * forms, the server's write checks, the senders and the docs.
 */

describe("the uses", () => {
  test("are calls and SMS, SMS only and calls only, in the order the forms offer them", () => {
    expect(TWILIO_CONFIG_USES).toEqual([
      TwilioConfigUse.CallsAndSms,
      TwilioConfigUse.SmsOnly,
      TwilioConfigUse.CallsOnly,
    ]);
    // Stored, sent over the API and Terraform as these words.
    expect([...TWILIO_CONFIG_USES]).toEqual([
      "Calls and SMS",
      "SMS only",
      "Calls only",
    ]);
  });

  test("a config that says nothing is used for calls and SMS, as every config was", () => {
    expect(DEFAULT_TWILIO_CONFIG_USE).toBe(TwilioConfigUse.CallsAndSms);

    for (const unset of [undefined, null, ""]) {
      expect(TwilioConfigUses.getUse(unset)).toBe(TwilioConfigUse.CallsAndSms);
    }
  });

  test("a value that is not a use reads as calls and SMS, so a row edited by hand keeps sending", () => {
    for (const notAUse of [
      "sms only",
      "SMS",
      "Calls",
      "calls and sms",
      " SMS only",
      0,
      1,
      true,
      {},
      [],
      ["SMS only"],
    ]) {
      expect({ value: notAUse, use: TwilioConfigUses.getUse(notAUse) }).toEqual(
        { value: notAUse, use: TwilioConfigUse.CallsAndSms },
      );
      expect(TwilioConfigUses.isUse(notAUse)).toBe(false);
    }
  });

  test("each use reads as itself", () => {
    for (const use of TWILIO_CONFIG_USES) {
      expect(TwilioConfigUses.isUse(use)).toBe(true);
      expect(TwilioConfigUses.getUse(use)).toBe(use);
    }
  });

  test("the column titles the forms and the API reference name", () => {
    expect(USED_FOR_TITLE).toBe("Used For");
    expect(PRIMARY_PHONE_NUMBER_TITLE).toBe("Twilio Primary Phone Number");
    expect(SMS_PHONE_NUMBERS_TITLE).toBe("Twilio SMS Phone Numbers");
  });
});

describe("what each use sends", () => {
  test.each([
    [TwilioConfigUse.CallsAndSms, true, true],
    [TwilioConfigUse.SmsOnly, true, false],
    [TwilioConfigUse.CallsOnly, false, true],
    [undefined, true, true],
    [null, true, true],
  ] as Array<[TwilioConfigUse | null | undefined, boolean, boolean]>)(
    "%s: SMS %s, calls %s",
    (
      use: TwilioConfigUse | null | undefined,
      sendsSms: boolean,
      makesCalls: boolean,
    ) => {
      expect(TwilioConfigUses.sendsSms(use)).toBe(sendsSms);
      expect(TwilioConfigUses.makesCalls(use)).toBe(makesCalls);
    },
  );

  test("every use sends something, and only calls and SMS sends both", () => {
    for (const use of TWILIO_CONFIG_USES) {
      expect(
        TwilioConfigUses.sendsSms(use) || TwilioConfigUses.makesCalls(use),
      ).toBe(true);
      expect(
        TwilioConfigUses.sendsSms(use) && TwilioConfigUses.makesCalls(use),
      ).toBe(use === TwilioConfigUse.CallsAndSms);
    }
  });

  test("is said in a sentence in lower case, SMS kept as written", () => {
    expect(
      TWILIO_CONFIG_USES.map((use: TwilioConfigUse): string => {
        return TwilioConfigUses.getUseInSentence(use);
      }),
    ).toEqual(["calls and SMS", "SMS only", "calls only"]);
    expect(TwilioConfigUses.getUseInSentence(undefined)).toBe("calls and SMS");
  });
});

describe("a value a write gives for what a config is used for", () => {
  test("is taken when it is one of the uses, or not given at all", () => {
    for (const value of [...TWILIO_CONFIG_USES, undefined, null]) {
      expect(TwilioConfigUses.getUseError(value)).toBeNull();
    }
  });

  test("is refused, naming the three, when it is any other text", () => {
    expect(TwilioConfigUses.getUseError("SMS")).toBe(
      'Used For must be "Calls and SMS", "SMS only" or "Calls only", not "SMS".',
    );
    expect(TwilioConfigUses.getUseError("")).toBe(
      'Used For must be "Calls and SMS", "SMS only" or "Calls only", not "".',
    );
    expect(TwilioConfigUses.getUseError("sms only")).toContain(
      'not "sms only".',
    );
  });

  test("repeats no more of a long value than a refusal does", () => {
    const long: string = "x".repeat(10000);
    const error: string = TwilioConfigUses.getUseError(long) || "";

    expect(error.length).toBeLessThan(MAX_REFUSED_VALUE_LENGTH + 120);
    expect(error).toContain("…");
  });

  test("is refused, without repeating it, when it is not text at all", () => {
    for (const value of [1, true, {}, ["SMS only"]]) {
      expect(TwilioConfigUses.getUseError(value)).toBe(
        'Used For must be "Calls and SMS", "SMS only" or "Calls only".',
      );
    }
  });
});

describe("the numbers each use takes", () => {
  const has: (
    use: unknown,
    numbers: { primary: boolean; sms: boolean },
  ) => string | null = (
    use: unknown,
    numbers: { primary: boolean; sms: boolean },
  ): string | null => {
    return TwilioConfigUses.getMissingNumberError({
      use: use,
      hasPrimaryPhoneNumber: numbers.primary,
      hasSmsPhoneNumbers: numbers.sms,
    });
  };

  test("calls and SMS takes a number to make calls from; SMS numbers are optional", () => {
    expect(
      has(TwilioConfigUse.CallsAndSms, { primary: true, sms: false }),
    ).toBe(null);
    expect(has(TwilioConfigUse.CallsAndSms, { primary: true, sms: true })).toBe(
      null,
    );
    expect(
      has(TwilioConfigUse.CallsAndSms, { primary: false, sms: true }),
    ).toBe(
      "A Twilio config used for calls and SMS needs a Twilio Primary Phone Number: calls go out from it.",
    );
    expect(
      has(TwilioConfigUse.CallsAndSms, { primary: false, sms: false }),
    ).not.toBeNull();
  });

  test("SMS only takes SMS numbers, and no number to make calls from", () => {
    expect(has(TwilioConfigUse.SmsOnly, { primary: false, sms: true })).toBe(
      null,
    );
    // A number it keeps but never calls from is no harm.
    expect(has(TwilioConfigUse.SmsOnly, { primary: true, sms: true })).toBe(
      null,
    );
    expect(has(TwilioConfigUse.SmsOnly, { primary: true, sms: false })).toBe(
      "A Twilio config used for SMS only needs at least one number in Twilio SMS Phone Numbers: every SMS goes out from one of them.",
    );
    expect(
      has(TwilioConfigUse.SmsOnly, { primary: false, sms: false }),
    ).not.toBeNull();
  });

  test("calls only takes a number to make calls from, and no SMS numbers", () => {
    expect(has(TwilioConfigUse.CallsOnly, { primary: true, sms: false })).toBe(
      null,
    );
    expect(has(TwilioConfigUse.CallsOnly, { primary: true, sms: true })).toBe(
      null,
    );
    expect(has(TwilioConfigUse.CallsOnly, { primary: false, sms: true })).toBe(
      "A Twilio config used for calls only needs a Twilio Primary Phone Number: calls go out from it.",
    );
  });

  test("a config that says nothing is held to calls and SMS's numbers", () => {
    for (const unset of [undefined, null, "not a use"]) {
      expect(has(unset, { primary: false, sms: true })).toBe(
        has(TwilioConfigUse.CallsAndSms, { primary: false, sms: true }),
      );
      expect(has(unset, { primary: true, sms: false })).toBeNull();
    }
  });

  test("every error names the field to fill in, by the title the forms give it", () => {
    for (const use of TWILIO_CONFIG_USES) {
      const error: string =
        has(use, { primary: false, sms: false }) || "missing error";

      expect(error).toContain(
        use === TwilioConfigUse.SmsOnly
          ? SMS_PHONE_NUMBERS_TITLE
          : PRIMARY_PHONE_NUMBER_TITLE,
      );
      expect(error).toMatch(/^A Twilio config used for /);
      expect(error.endsWith(".")).toBe(true);
    }
  });
});
