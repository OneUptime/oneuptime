import TwilioConfigWrite, {
  TWILIO_USE_AND_NUMBERS_KEYS,
  TwilioUseAndNumbers,
} from "../../../Types/CallAndSMS/TwilioConfigWrite";
import { TwilioConfigUse } from "../../../Types/CallAndSMS/TwilioConfigUse";
import Phone from "../../../Types/Phone";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT A WRITE OF A TWILIO CONFIG MUST LEAVE IT WITH.
 *
 * A config is used for calls and SMS, SMS only or calls only, and must hold
 * the numbers that takes. The server holds a project's config and its own
 * to it on every create, and on every update that changes what the config
 * is used for, its number or its SMS numbers - never on one that changes
 * none of them, so a rename, making a config the default, or an API or
 * Terraform write that sends every field back as it was goes through
 * whatever a row made before the rule holds.
 */

const US: string = "+14155550100";
const SG_MOBILE: string = "+6581234567";
const UK: string = "+447700900123";

const callsAndSms: TwilioUseAndNumbers = {
  use: TwilioConfigUse.CallsAndSms,
  primaryPhoneNumber: new Phone(US),
  smsPhoneNumbers: null,
};

const smsOnly: TwilioUseAndNumbers = {
  use: TwilioConfigUse.SmsOnly,
  primaryPhoneNumber: null,
  smsPhoneNumbers: `${SG_MOBILE}, ${UK}`,
};

const callsOnly: TwilioUseAndNumbers = {
  use: TwilioConfigUse.CallsOnly,
  primaryPhoneNumber: new Phone(US),
  smsPhoneNumbers: null,
};

// A config made through the API before the rule, with no number at all.
const legacyWithoutNumbers: TwilioUseAndNumbers = {
  use: TwilioConfigUse.CallsAndSms,
  primaryPhoneNumber: null,
  smsPhoneNumbers: null,
};

describe("what a config holds", () => {
  test("a number to make calls from: a Phone or its text, not blank", () => {
    expect(TwilioConfigWrite.hasPrimaryPhoneNumber(new Phone(US))).toBe(true);
    expect(TwilioConfigWrite.hasPrimaryPhoneNumber(US)).toBe(true);

    for (const none of [undefined, null, "", "   "]) {
      expect(TwilioConfigWrite.hasPrimaryPhoneNumber(none)).toBe(false);
    }
  });

  test("SMS numbers: a list with at least one number in it", () => {
    expect(TwilioConfigWrite.hasSmsPhoneNumbers(SG_MOBILE)).toBe(true);
    expect(TwilioConfigWrite.hasSmsPhoneNumbers(` , ${SG_MOBILE};`)).toBe(true);

    for (const none of [undefined, null, "", " , ", ";\n", [SG_MOBILE], 65]) {
      expect(TwilioConfigWrite.hasSmsPhoneNumbers(none)).toBe(false);
    }
  });

  test("the numbers its use takes, as the use's rule says", () => {
    expect(TwilioConfigWrite.getMissingNumberError(callsAndSms)).toBeNull();
    expect(TwilioConfigWrite.getMissingNumberError(smsOnly)).toBeNull();
    expect(TwilioConfigWrite.getMissingNumberError(callsOnly)).toBeNull();
    expect(TwilioConfigWrite.getMissingNumberError(legacyWithoutNumbers)).toBe(
      "A Twilio config used for calls and SMS needs a Twilio Primary Phone Number: calls go out from it.",
    );
    expect(
      TwilioConfigWrite.getMissingNumberError({
        use: TwilioConfigUse.SmsOnly,
        primaryPhoneNumber: new Phone(US),
        smsPhoneNumbers: " , ",
      }),
    ).toBe(
      "A Twilio config used for SMS only needs at least one number in Twilio SMS Phone Numbers: every SMS goes out from one of them.",
    );
  });
});

describe("what a write gives", () => {
  test("names the three values it can change, and only those it sends", () => {
    expect([...TWILIO_USE_AND_NUMBERS_KEYS]).toEqual([
      "use",
      "primaryPhoneNumber",
      "smsPhoneNumbers",
    ]);
    expect(TwilioConfigWrite.getWrittenKeys({})).toEqual([]);
    expect(TwilioConfigWrite.getWrittenKeys({ smsPhoneNumbers: null })).toEqual(
      ["smsPhoneNumbers"],
    );
    expect(
      TwilioConfigWrite.getWrittenKeys({
        use: TwilioConfigUse.SmsOnly,
        primaryPhoneNumber: undefined,
      }),
    ).toEqual(["use"]);
  });

  test("compares a use, a number and a list by what they mean", () => {
    expect(TwilioConfigWrite.getComparableValue("use", undefined)).toBe(
      TwilioConfigWrite.getComparableValue("use", TwilioConfigUse.CallsAndSms),
    );
    expect(TwilioConfigWrite.getComparableValue("use", "nonsense")).toBe(
      TwilioConfigUse.CallsAndSms,
    );
    expect(
      TwilioConfigWrite.getComparableValue("primaryPhoneNumber", new Phone(US)),
    ).toBe(TwilioConfigWrite.getComparableValue("primaryPhoneNumber", US));
    expect(
      TwilioConfigWrite.getComparableValue("primaryPhoneNumber", null),
    ).toBe("");
    expect(
      TwilioConfigWrite.getComparableValue(
        "smsPhoneNumbers",
        `${SG_MOBILE},${UK}`,
      ),
    ).toBe(
      TwilioConfigWrite.getComparableValue(
        "smsPhoneNumbers",
        ` ${SG_MOBILE} ; ${UK}, `,
      ),
    );
    expect(TwilioConfigWrite.getComparableValue("smsPhoneNumbers", null)).toBe(
      TwilioConfigWrite.getComparableValue("smsPhoneNumbers", " , "),
    );
  });

  test("leaves the config as what it writes over what is stored", () => {
    expect(
      TwilioConfigWrite.getConfigAsWritten({
        stored: callsAndSms,
        written: { use: TwilioConfigUse.SmsOnly, smsPhoneNumbers: SG_MOBILE },
      }),
    ).toEqual({
      use: TwilioConfigUse.SmsOnly,
      primaryPhoneNumber: callsAndSms.primaryPhoneNumber,
      smsPhoneNumbers: SG_MOBILE,
    });
    // A value left out keeps what is stored; null writes null.
    expect(
      TwilioConfigWrite.getConfigAsWritten({
        stored: smsOnly,
        written: { smsPhoneNumbers: null },
      }),
    ).toEqual({ ...smsOnly, smsPhoneNumbers: null });
  });
});

describe("an update of a stored config", () => {
  test("that changes none of the three goes through, whatever the row holds", () => {
    for (const stored of [
      callsAndSms,
      smsOnly,
      callsOnly,
      legacyWithoutNumbers,
    ]) {
      // A rename, or making the config the default: none of the three.
      expect(
        TwilioConfigWrite.getUpdateError({ stored: stored, written: {} }),
      ).toBeNull();
      // An API or Terraform write that sends every field back as it was.
      expect(
        TwilioConfigWrite.getUpdateError({ stored: stored, written: stored }),
      ).toBeNull();
    }
  });

  test("of a legacy row without numbers, sending the same nothing back again, goes through", () => {
    expect(
      TwilioConfigWrite.getUpdateError({
        stored: legacyWithoutNumbers,
        written: {
          use: TwilioConfigUse.CallsAndSms,
          primaryPhoneNumber: null,
          smsPhoneNumbers: "",
        },
      }),
    ).toBeNull();
    // An unset use is calls and SMS: no change.
    expect(
      TwilioConfigWrite.getUpdateError({
        stored: { ...legacyWithoutNumbers, use: undefined },
        written: { use: TwilioConfigUse.CallsAndSms },
      }),
    ).toBeNull();
  });

  test("that makes a config used for SMS only needs its SMS numbers", () => {
    expect(
      TwilioConfigWrite.getUpdateError({
        stored: callsAndSms,
        written: { use: TwilioConfigUse.SmsOnly },
      }),
    ).toBe(
      "A Twilio config used for SMS only needs at least one number in Twilio SMS Phone Numbers: every SMS goes out from one of them.",
    );
    expect(
      TwilioConfigWrite.getUpdateError({
        stored: callsAndSms,
        written: { use: TwilioConfigUse.SmsOnly, smsPhoneNumbers: SG_MOBILE },
      }),
    ).toBeNull();
    // SMS numbers it already lists are enough.
    expect(
      TwilioConfigWrite.getUpdateError({
        stored: { ...callsAndSms, smsPhoneNumbers: SG_MOBILE },
        written: { use: TwilioConfigUse.SmsOnly },
      }),
    ).toBeNull();
  });

  test("that empties an SMS-only config's numbers is refused", () => {
    for (const emptied of ["", null, " ; "]) {
      expect(
        TwilioConfigWrite.getUpdateError({
          stored: smsOnly,
          written: { smsPhoneNumbers: emptied },
        }),
      ).not.toBeNull();
    }
  });

  test("that makes calls needs a number to make them from", () => {
    for (const use of [
      TwilioConfigUse.CallsAndSms,
      TwilioConfigUse.CallsOnly,
    ]) {
      expect(
        TwilioConfigWrite.getUpdateError({
          stored: smsOnly,
          written: { use: use },
        }),
      ).toContain("needs a Twilio Primary Phone Number");
      expect(
        TwilioConfigWrite.getUpdateError({
          stored: smsOnly,
          written: { use: use, primaryPhoneNumber: new Phone(US) },
        }),
      ).toBeNull();
    }

    expect(
      TwilioConfigWrite.getUpdateError({
        stored: callsOnly,
        written: { primaryPhoneNumber: null },
      }),
    ).toBe(
      "A Twilio config used for calls only needs a Twilio Primary Phone Number: calls go out from it.",
    );
  });

  test("that empties a calls-and-SMS config's SMS numbers leaves SMS going out from its number", () => {
    expect(
      TwilioConfigWrite.getUpdateError({
        stored: { ...callsAndSms, smsPhoneNumbers: SG_MOBILE },
        written: { smsPhoneNumbers: "" },
      }),
    ).toBeNull();
  });

  test("that fixes a legacy row goes through, and one that changes it without fixing it does not", () => {
    expect(
      TwilioConfigWrite.getUpdateError({
        stored: legacyWithoutNumbers,
        written: { primaryPhoneNumber: new Phone(US) },
      }),
    ).toBeNull();
    expect(
      TwilioConfigWrite.getUpdateError({
        stored: legacyWithoutNumbers,
        written: { use: TwilioConfigUse.SmsOnly, smsPhoneNumbers: SG_MOBILE },
      }),
    ).toBeNull();
    expect(
      TwilioConfigWrite.getUpdateError({
        stored: legacyWithoutNumbers,
        written: { smsPhoneNumbers: SG_MOBILE },
      }),
    ).toContain("needs a Twilio Primary Phone Number");
  });

  test("a number it keeps but does not send from may be cleared", () => {
    expect(
      TwilioConfigWrite.getUpdateError({
        stored: { ...smsOnly, primaryPhoneNumber: new Phone(US) },
        written: { primaryPhoneNumber: null },
      }),
    ).toBeNull();
    expect(
      TwilioConfigWrite.getUpdateError({
        stored: { ...callsOnly, smsPhoneNumbers: SG_MOBILE },
        written: { smsPhoneNumbers: null },
      }),
    ).toBeNull();
  });
});
