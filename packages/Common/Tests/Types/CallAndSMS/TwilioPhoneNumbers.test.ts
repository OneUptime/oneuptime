import TwilioConfig from "../../../Types/CallAndSMS/TwilioConfig";
import TwilioPhoneNumbers, {
  PHONE_NUMBER_LIST_EXAMPLE,
  TwilioSenderNumbers,
} from "../../../Types/CallAndSMS/TwilioPhoneNumbers";
import BadDataException from "../../../Types/Exception/BadDataException";
import Phone from "../../../Types/Phone";
import { TwilioMessageKind } from "../../../Utils/Project/TwilioAccount";
import { MAX_REFUSED_VALUE_LENGTH } from "../../../Utils/RefusedValue";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * WHICH OF A TWILIO CONFIG'S NUMBERS AN SMS OR A CALL GOES OUT FROM.
 *
 * A Twilio number can make calls and send SMS, or only one of the two:
 * Twilio sells "Voice Enabled Only" and "SMS Enabled Only" numbers, and
 * lists Singapore's national numbers (+65 3 or 6) as voice-only - SMS there
 * need a mobile number (+65 8). A customer there could not use OneUptime:
 * every SMS went out from the config's one primary number, which could only
 * make calls.
 *
 * Now a config can list numbers for SMS. These pin the rules every sender
 * follows (the Notification service's SmsService and CallService pick
 * through pickSenderNumber):
 *
 *   - calls: the primary number, or a secondary one in the recipient's
 *     country - whatever SMS numbers the config lists;
 *   - SMS, while the config lists no SMS numbers: exactly the numbers calls
 *     go out from - every config made before them sends as it did;
 *   - SMS, once it lists some: one of them alone - the one in the
 *     recipient's country, or else the first - and never a number kept for
 *     calls.
 *
 * And the lists of numbers a config keeps, read and refused the same way on
 * the server and in the forms.
 */

// Singapore: a national number for calls, a mobile number for SMS.
const SG_NATIONAL: string = "+6561234567";
const SG_MOBILE: string = "+6581234567";
const SG_RECIPIENT: string = "+6590665484";

// An installation that sends to several countries.
const US_DUAL: string = "+14155550100";
const UK_DUAL: string = "+447700900123";
const UK_LANDLINE: string = "+442071234567";
const SE_DUAL: string = "+46701234567";
const US_RECIPIENT: string = "+12025550199";
const UK_RECIPIENT: string = "+447911123456";
const FR_RECIPIENT: string = "+33612345678";

type ConfigOptions = {
  primary?: string;
  secondary?: Array<string>;
  sms?: Array<string> | undefined;
};

function config(options: ConfigOptions = {}): TwilioConfig {
  const built: TwilioConfig = {
    accountSid: "AC00000000000000000000000000000001",
    authToken: "auth-token",
    primaryPhoneNumber: new Phone(options.primary || US_DUAL),
    secondaryPhoneNumbers: (options.secondary || []).map(
      (phone: string): Phone => {
        return new Phone(phone);
      },
    ),
  };

  if (options.sms) {
    built.smsPhoneNumbers = options.sms.map((phone: string): Phone => {
      return new Phone(phone);
    });
  }

  return built;
}

function numbers(sender: TwilioSenderNumbers | null): {
  primary: string;
  secondary: Array<string>;
} {
  // Every config here is used for calls and SMS, and sends both.
  if (!sender) {
    throw new Error("The config sends no message of this kind.");
  }

  return {
    primary: sender.primaryPhoneNumber.toString(),
    secondary: sender.secondaryPhoneNumbers.map((phone: Phone): string => {
      return phone.toString();
    }),
  };
}

function from(
  twilioConfig: TwilioConfig,
  kind: TwilioMessageKind,
  to: string,
): string {
  return TwilioPhoneNumbers.pickSenderNumber({
    config: twilioConfig,
    kind: kind,
    to: to,
  }).toString();
}

const SMS: TwilioMessageKind = TwilioMessageKind.SMS;
const CALL: TwilioMessageKind = TwilioMessageKind.Call;

// A North American number in 555-0100 to 555-0199, kept for fiction.
const NANP_FICTION_NUMBER: RegExp = /^\+1\d{3}55501\d{2}$/;

// A UK mobile number in 07700 900000 to 900999, kept for drama.
const UK_DRAMA_NUMBER: RegExp = /^\+447700900\d{3}$/;

const RECIPIENTS: Array<string> = [
  SG_RECIPIENT,
  SG_NATIONAL,
  US_RECIPIENT,
  UK_RECIPIENT,
  FR_RECIPIENT,
];

describe("the numbers a config sends each kind of message from", () => {
  test("calls go out from the primary and secondary numbers, whatever SMS numbers the config lists", () => {
    const withSmsNumbers: TwilioConfig = config({
      primary: SG_NATIONAL,
      secondary: [UK_DUAL],
      sms: [SG_MOBILE, SE_DUAL],
    });

    expect(
      numbers(TwilioPhoneNumbers.getSenderNumbers(withSmsNumbers, CALL)),
    ).toEqual({ primary: SG_NATIONAL, secondary: [UK_DUAL] });
  });

  test("a config without SMS numbers sends SMS from the numbers calls go out from, as every config did", () => {
    const plain: TwilioConfig = config({
      primary: US_DUAL,
      secondary: [UK_DUAL, SE_DUAL],
    });

    expect(numbers(TwilioPhoneNumbers.getSenderNumbers(plain, SMS))).toEqual(
      numbers(TwilioPhoneNumbers.getSenderNumbers(plain, CALL)),
    );
    expect(numbers(TwilioPhoneNumbers.getSenderNumbers(plain, SMS))).toEqual({
      primary: US_DUAL,
      secondary: [UK_DUAL, SE_DUAL],
    });
  });

  test("one SMS number sends every SMS", () => {
    expect(
      numbers(
        TwilioPhoneNumbers.getSenderNumbers(
          config({ primary: SG_NATIONAL, sms: [SG_MOBILE] }),
          SMS,
        ),
      ),
    ).toEqual({ primary: SG_MOBILE, secondary: [] });
  });

  test("several SMS numbers: the first is the default, the rest are picked by country", () => {
    expect(
      numbers(
        TwilioPhoneNumbers.getSenderNumbers(
          config({ primary: SG_NATIONAL, sms: [SG_MOBILE, UK_DUAL, SE_DUAL] }),
          SMS,
        ),
      ),
    ).toEqual({ primary: SG_MOBILE, secondary: [UK_DUAL, SE_DUAL] });
  });

  test("once a config lists SMS numbers, its secondary numbers send no SMS either", () => {
    expect(
      numbers(
        TwilioPhoneNumbers.getSenderNumbers(
          config({
            primary: US_DUAL,
            secondary: [UK_LANDLINE, SG_NATIONAL],
            sms: [SG_MOBILE],
          }),
          SMS,
        ),
      ),
    ).toEqual({ primary: SG_MOBILE, secondary: [] });
  });

  test("an empty list of SMS numbers is no list at all", () => {
    expect(
      numbers(
        TwilioPhoneNumbers.getSenderNumbers(
          config({ primary: US_DUAL, secondary: [UK_DUAL], sms: [] }),
          SMS,
        ),
      ),
    ).toEqual({ primary: US_DUAL, secondary: [UK_DUAL] });
  });

  test("a config read before secondary numbers were a list - none at all - still sends", () => {
    const old: TwilioConfig = config({ primary: US_DUAL });
    (old as unknown as Record<string, unknown>)["secondaryPhoneNumbers"] =
      undefined;

    expect(numbers(TwilioPhoneNumbers.getSenderNumbers(old, SMS))).toEqual({
      primary: US_DUAL,
      secondary: [],
    });
    expect(numbers(TwilioPhoneNumbers.getSenderNumbers(old, CALL))).toEqual({
      primary: US_DUAL,
      secondary: [],
    });
  });

  test("hasSmsNumbers is whether the config lists any number for SMS", () => {
    expect(TwilioPhoneNumbers.hasSmsNumbers(config())).toBe(false);
    expect(TwilioPhoneNumbers.hasSmsNumbers(config({ sms: [] }))).toBe(false);
    expect(TwilioPhoneNumbers.hasSmsNumbers(config({ sms: [SG_MOBILE] }))).toBe(
      true,
    );
    expect(
      TwilioPhoneNumbers.hasSmsNumbers(config({ sms: [SG_MOBILE, UK_DUAL] })),
    ).toBe(true);
  });
});

describe("the number each message goes out from", () => {
  /*
   * The customer's case, from Twilio Singapore: "We don't support both
   * voice and SMS on the same number. You can have separate numbers for
   * Voice (National, series 3 or 6) and SMS (mobile numbers)."
   */
  test("Singapore: calls from the national number, SMS from the mobile one", () => {
    const singapore: TwilioConfig = config({
      primary: SG_NATIONAL,
      sms: [SG_MOBILE],
    });

    expect(from(singapore, CALL, SG_RECIPIENT)).toBe(SG_NATIONAL);
    expect(from(singapore, SMS, SG_RECIPIENT)).toBe(SG_MOBILE);
    // A recipient abroad gets their SMS from the mobile number too.
    expect(from(singapore, SMS, UK_RECIPIENT)).toBe(SG_MOBILE);
    expect(from(singapore, CALL, UK_RECIPIENT)).toBe(SG_NATIONAL);
  });

  test("once a config lists SMS numbers, no SMS goes out from a number kept for calls, to any recipient", () => {
    const callNumbers: Array<string> = [SG_NATIONAL, UK_LANDLINE];
    const mixed: TwilioConfig = config({
      primary: SG_NATIONAL,
      secondary: [UK_LANDLINE],
      sms: [SG_MOBILE],
    });

    for (const recipient of RECIPIENTS) {
      const sender: string = from(mixed, SMS, recipient);

      expect({
        recipient,
        fromACallNumber: callNumbers.includes(sender),
      }).toEqual({ recipient, fromACallNumber: false });
      expect({ recipient, sender }).toEqual({ recipient, sender: SG_MOBILE });
    }
  });

  test("and every call still goes out from a call number, never from an SMS one", () => {
    const mixed: TwilioConfig = config({
      primary: SG_NATIONAL,
      secondary: [UK_LANDLINE],
      sms: [SG_MOBILE, UK_DUAL],
    });

    expect(from(mixed, CALL, SG_RECIPIENT)).toBe(SG_NATIONAL);
    expect(from(mixed, CALL, UK_RECIPIENT)).toBe(UK_LANDLINE);
    expect(from(mixed, CALL, US_RECIPIENT)).toBe(SG_NATIONAL);
    expect(from(mixed, CALL, FR_RECIPIENT)).toBe(SG_NATIONAL);
  });

  /*
   * An installation that sends to several countries (OneUptime Cloud's own
   * account, say): a US number for both, a UK landline for calls to the UK,
   * Singapore's national number for calls to Singapore - and, for SMS, the
   * US number, a UK mobile and Singapore's mobile number.
   */
  test("several countries: each kind of message from the number of its recipient's country, or else its first", () => {
    const cloud: TwilioConfig = config({
      primary: US_DUAL,
      secondary: [UK_LANDLINE, SG_NATIONAL],
      sms: [US_DUAL, UK_DUAL, SG_MOBILE],
    });

    expect(from(cloud, CALL, SG_RECIPIENT)).toBe(SG_NATIONAL);
    expect(from(cloud, SMS, SG_RECIPIENT)).toBe(SG_MOBILE);
    expect(from(cloud, CALL, UK_RECIPIENT)).toBe(UK_LANDLINE);
    expect(from(cloud, SMS, UK_RECIPIENT)).toBe(UK_DUAL);
    expect(from(cloud, CALL, US_RECIPIENT)).toBe(US_DUAL);
    expect(from(cloud, SMS, US_RECIPIENT)).toBe(US_DUAL);
    expect(from(cloud, CALL, FR_RECIPIENT)).toBe(US_DUAL);
    expect(from(cloud, SMS, FR_RECIPIENT)).toBe(US_DUAL);
  });

  test("a recipient in no SMS number's country gets their SMS from the first SMS number", () => {
    const listed: TwilioConfig = config({
      primary: SG_NATIONAL,
      sms: [SG_MOBILE, UK_DUAL],
    });

    expect(from(listed, SMS, FR_RECIPIENT)).toBe(SG_MOBILE);
    expect(from(listed, SMS, US_RECIPIENT)).toBe(SG_MOBILE);
    expect(from(listed, SMS, UK_RECIPIENT)).toBe(UK_DUAL);
  });

  test("a config without SMS numbers picks exactly what it picked before, for both kinds", () => {
    const plain: TwilioConfig = config({
      primary: US_DUAL,
      secondary: [UK_DUAL, SG_MOBILE],
    });

    for (const recipient of RECIPIENTS) {
      const before: string = Phone.pickPhoneNumberToSendSMSOrCallFrom({
        to: recipient,
        primaryPhoneNumberToPickFrom: US_DUAL,
        secondaryPhoneNumbersToPickFrom: [UK_DUAL, SG_MOBILE],
      }).toString();

      expect({ recipient, sms: from(plain, SMS, recipient) }).toEqual({
        recipient,
        sms: before,
      });
      expect({ recipient, call: from(plain, CALL, recipient) }).toEqual({
        recipient,
        call: before,
      });
    }
  });

  test("the recipient can be given as text or as a Phone", () => {
    const singapore: TwilioConfig = config({
      primary: SG_NATIONAL,
      sms: [SG_MOBILE],
    });

    expect(
      TwilioPhoneNumbers.pickSenderNumber({
        config: singapore,
        kind: SMS,
        to: new Phone(SG_RECIPIENT),
      }).toString(),
    ).toBe(SG_MOBILE);
  });
});

describe("a list of numbers, as a config keeps it", () => {
  test("is read entry by entry, whatever separates them and however they are spaced", () => {
    expect(
      TwilioPhoneNumbers.getListEntries(
        " +447700900123, +46701234567;+6581234567\n+14155550100 ",
      ),
    ).toEqual([UK_DUAL, SE_DUAL, SG_MOBILE, US_DUAL]);
  });

  test("leaves out the empty entries a trailing or doubled comma leaves", () => {
    expect(
      TwilioPhoneNumbers.getListEntries("+447700900123,, ,+46701234567,"),
    ).toEqual([UK_DUAL, SE_DUAL]);
    expect(
      TwilioPhoneNumbers.parseList("+447700900123,,+46701234567,").map(
        (phone: Phone): string => {
          return phone.toString();
        },
      ),
    ).toEqual([UK_DUAL, SE_DUAL]);
  });

  test("an empty, missing or non-text list holds no numbers", () => {
    expect(TwilioPhoneNumbers.parseList("")).toEqual([]);
    expect(TwilioPhoneNumbers.parseList("  ,  ")).toEqual([]);
    expect(TwilioPhoneNumbers.parseList(undefined)).toEqual([]);
    expect(TwilioPhoneNumbers.parseList(null)).toEqual([]);
    expect(TwilioPhoneNumbers.getListEntries(42 as unknown as string)).toEqual(
      [],
    );
  });

  test("parses each entry as a Phone", () => {
    const parsed: Array<Phone> = TwilioPhoneNumbers.parseList(
      `${UK_DUAL},${SE_DUAL}`,
    );

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toBeInstanceOf(Phone);
    expect(parsed[1]!.toString()).toBe(SE_DUAL);
  });

  test("refuses an entry that is not a phone number, naming it", () => {
    expect(() => {
      TwilioPhoneNumbers.parseList(`${UK_DUAL}, not-a-number`);
    }).toThrow(BadDataException);
    expect(() => {
      TwilioPhoneNumbers.parseList(`${UK_DUAL}, not-a-number`);
    }).toThrow(
      `"not-a-number" is not a phone number. Write each number with its country code and separate them with commas, like ${PHONE_NUMBER_LIST_EXAMPLE}.`,
    );
  });

  test("getListError says what parseList would refuse, and nothing for a good or empty list", () => {
    expect(TwilioPhoneNumbers.getListError(`${UK_DUAL}, ${SE_DUAL}`)).toBe(
      null,
    );
    expect(TwilioPhoneNumbers.getListError("")).toBe(null);
    expect(TwilioPhoneNumbers.getListError(undefined)).toBe(null);
    expect(TwilioPhoneNumbers.getListError(`${UK_DUAL}, 12`)).toBe(
      TwilioPhoneNumbers.getListEntryError("12"),
    );
    // The first entry that is not a number is the one named.
    expect(TwilioPhoneNumbers.getListError("abc, def")).toContain('"abc"');
  });

  test("a list typed with spaces inside a number is refused, as one number with spaces always was", () => {
    expect(TwilioPhoneNumbers.getListError("+65 8123 4567")).toContain(
      '"+65 8123 4567"',
    );
  });

  test("repeats no more of a long entry than any refused value", () => {
    const long: string = "x".repeat(5000);
    const error: string = TwilioPhoneNumbers.getListEntryError(long);

    expect(error.length).toBeLessThan(MAX_REFUSED_VALUE_LENGTH + 200);
    expect(error).toContain("x".repeat(MAX_REFUSED_VALUE_LENGTH));
    expect(error).not.toContain("x".repeat(MAX_REFUSED_VALUE_LENGTH + 1));
  });

  test("reads a long list in time that grows with its length", () => {
    const entry: string = "+447700900123";
    const list: string = Array.from({ length: 30000 }, (): string => {
      return entry;
    }).join(", ");
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        expect(TwilioPhoneNumbers.getListEntries(list)).toHaveLength(30000);
        expect(TwilioPhoneNumbers.getListError(list)).toBe(null);
      },
      limitInMs: 2000,
    });
    expect(timed.inMs).toBeLessThan(2000);

    // Separators alone, the worst case for the split.
    const separators: string = ",;\n".repeat(140000);
    const timedRun: FastestRun<void> = fastestRun({
      run: (): void => {
        expect(TwilioPhoneNumbers.getListEntries(separators)).toEqual([]);
      },
      limitInMs: 2000,
    });
    expect(timedRun.inMs).toBeLessThan(2000);
  });
});

describe("refusing a list a config is about to store", () => {
  const TITLE: string = "Twilio SMS Phone Numbers";

  test("lets an absent, emptied or good list through", () => {
    expect(() => {
      TwilioPhoneNumbers.assertListIsValid({ title: TITLE, text: undefined });
    }).not.toThrow();
    expect(() => {
      TwilioPhoneNumbers.assertListIsValid({ title: TITLE, text: null });
    }).not.toThrow();
    expect(() => {
      TwilioPhoneNumbers.assertListIsValid({ title: TITLE, text: "" });
    }).not.toThrow();
    expect(() => {
      TwilioPhoneNumbers.assertListIsValid({
        title: TITLE,
        text: `${SG_MOBILE}, ${UK_DUAL}`,
      });
    }).not.toThrow();
  });

  test("refuses one with an entry that is not a phone number, by the field's name", () => {
    expect(() => {
      TwilioPhoneNumbers.assertListIsValid({
        title: TITLE,
        text: `${SG_MOBILE}, call me`,
      });
    }).toThrow(
      new BadDataException(
        `${TITLE}: ${TwilioPhoneNumbers.getListEntryError("call me")}`,
      ),
    );
  });

  test("refuses a value that is not text", () => {
    expect(() => {
      TwilioPhoneNumbers.assertListIsValid({
        title: TITLE,
        text: [SG_MOBILE],
      });
    }).toThrow(`${TITLE} must be phone numbers separated by commas.`);
    expect(() => {
      TwilioPhoneNumbers.assertListIsValid({ title: TITLE, text: 6581234567 });
    }).toThrow(BadDataException);
  });
});

/*
 * THE EXAMPLE A READER IS SHOWN: in the empty Twilio SMS Phone Numbers field
 * of a project's Twilio config and of the Admin Dashboard's Call and SMS
 * settings, and in the error that refuses a list. OneUptime is used
 * worldwide, so the example is no one country's - it once was a Singapore
 * mobile number - but two numbers in two countries, each from a range kept
 * for fiction, so a copied example texts nobody.
 */
describe("the example list a reader is shown", () => {
  const entries: Array<string> = TwilioPhoneNumbers.getListEntries(
    PHONE_NUMBER_LIST_EXAMPLE,
  );

  test("is two phone numbers, separated as the forms ask, that the rule accepts", () => {
    expect(PHONE_NUMBER_LIST_EXAMPLE).toBe("+14155550123, +447700900123");
    expect(entries).toEqual(["+14155550123", "+447700900123"]);
    expect(TwilioPhoneNumbers.getListError(PHONE_NUMBER_LIST_EXAMPLE)).toBe(
      null,
    );
    expect(() => {
      TwilioPhoneNumbers.assertListIsValid({
        title: "Twilio SMS Phone Numbers",
        text: PHONE_NUMBER_LIST_EXAMPLE,
      });
    }).not.toThrow();
  });

  test("takes its numbers only from ranges kept for fiction: North America's 555-0100 to 555-0199 and the UK's 07700 900xxx", () => {
    expect(entries[0]).toMatch(NANP_FICTION_NUMBER);
    expect(entries[1]).toMatch(UK_DRAMA_NUMBER);
  });

  test("is no one country's: an SMS goes out from the number in its recipient's country, or else the first", () => {
    const listed: TwilioConfig = config({ sms: entries });

    // Each number serves its own country...
    expect(from(listed, SMS, US_RECIPIENT)).toBe(entries[0]);
    expect(from(listed, SMS, UK_RECIPIENT)).toBe(entries[1]);
    // ...and the first every other one, as the field's help says.
    expect(from(listed, SMS, FR_RECIPIENT)).toBe(entries[0]);
    expect(from(listed, SMS, SG_RECIPIENT)).toBe(entries[0]);
  });

  test("holds no Singapore number, the country it was once taken from", () => {
    for (const entry of entries) {
      expect(entry.startsWith("+65")).toBe(false);
    }
  });

  test("is the example the error that refuses a list gives", () => {
    expect(TwilioPhoneNumbers.getListEntryError("call me")).toBe(
      '"call me" is not a phone number. Write each number with its country code and separate them with commas, like +14155550123, +447700900123.',
    );
  });
});
