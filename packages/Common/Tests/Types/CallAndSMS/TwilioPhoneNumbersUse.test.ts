import TwilioConfig from "../../../Types/CallAndSMS/TwilioConfig";
import TwilioPhoneNumbers, {
  TwilioSenderNumbers,
} from "../../../Types/CallAndSMS/TwilioPhoneNumbers";
import {
  TWILIO_CONFIG_USES,
  TwilioConfigUse,
} from "../../../Types/CallAndSMS/TwilioConfigUse";
import BadDataException from "../../../Types/Exception/BadDataException";
import Phone from "../../../Types/Phone";
import { TwilioMessageKind } from "../../../Utils/Project/TwilioAccount";
import { describe, expect, test } from "@jest/globals";

/*
 * WHICH NUMBERS A CONFIG SENDS FROM, BY WHAT IT IS USED FOR.
 *
 * A config is used for calls and SMS, SMS only or calls only
 * (TwilioConfigUse). Every sender asks TwilioPhoneNumbers which of its
 * numbers a message goes out from - and now whether it sends that message
 * at all (canSend):
 *
 *   - calls and SMS - every config made before the choice - sends exactly
 *     as it always did;
 *   - SMS only sends every SMS from its SMS numbers, and no call - not even
 *     from a number it keeps;
 *   - calls only makes calls from its primary and secondary numbers, and
 *     sends no SMS - not even from SMS numbers it keeps.
 *
 * A message a config does not send goes as it would without the config
 * (the Notification service's senders).
 */

const US: string = "+14155550100";
const UK_LANDLINE: string = "+442071234567";
const SG_MOBILE: string = "+6581234567";
const UK_MOBILE: string = "+447700900123";

const RECIPIENTS: Array<string> = [
  "+12025550199",
  "+447911123456",
  "+6590665484",
  "+33612345678",
];

type Options = {
  use?: TwilioConfigUse | undefined;
  primary?: string | undefined;
  secondary?: Array<string>;
  sms?: Array<string>;
};

function config(options: Options = {}): TwilioConfig {
  const built: TwilioConfig = {
    accountSid: "AC00000000000000000000000000000001",
    authToken: "auth-token",
    secondaryPhoneNumbers: (options.secondary || []).map(
      (phone: string): Phone => {
        return new Phone(phone);
      },
    ),
  };

  if (options.use) {
    built.use = options.use;
  }

  if (options.primary) {
    built.primaryPhoneNumber = new Phone(options.primary);
  }

  if (options.sms) {
    built.smsPhoneNumbers = options.sms.map((phone: string): Phone => {
      return new Phone(phone);
    });
  }

  return built;
}

function asText(sender: TwilioSenderNumbers | null): unknown {
  if (!sender) {
    return null;
  }

  return {
    primary: sender.primaryPhoneNumber.toString(),
    secondary: sender.secondaryPhoneNumbers.map(String),
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

describe("a config used for calls and SMS", () => {
  test("sends both, as every config did before the choice - whether it says so or not", () => {
    for (const use of [undefined, TwilioConfigUse.CallsAndSms]) {
      const twilioConfig: TwilioConfig = config({
        use: use,
        primary: US,
        secondary: [UK_LANDLINE],
      });

      expect(
        TwilioPhoneNumbers.canSend(twilioConfig, TwilioMessageKind.SMS),
      ).toBe(true);
      expect(
        TwilioPhoneNumbers.canSend(twilioConfig, TwilioMessageKind.Call),
      ).toBe(true);
      expect(
        asText(
          TwilioPhoneNumbers.getSenderNumbers(
            twilioConfig,
            TwilioMessageKind.SMS,
          ),
        ),
      ).toEqual({ primary: US, secondary: [UK_LANDLINE] });
      expect(
        TwilioPhoneNumbers.getCannotSendReason(
          twilioConfig,
          TwilioMessageKind.Call,
        ),
      ).toBeNull();
    }
  });

  test("picks the same number for every recipient whether it says it is used for calls and SMS or says nothing", () => {
    const silent: TwilioConfig = config({
      primary: US,
      secondary: [UK_LANDLINE],
      sms: [SG_MOBILE],
    });
    const said: TwilioConfig = {
      ...silent,
      use: TwilioConfigUse.CallsAndSms,
    };

    for (const recipient of RECIPIENTS) {
      for (const kind of [TwilioMessageKind.SMS, TwilioMessageKind.Call]) {
        expect(from(said, kind, recipient)).toBe(from(silent, kind, recipient));
      }
    }
  });

  test("without a number to make calls from, sends nothing: a row made before the rule", () => {
    const noNumber: TwilioConfig = config({ sms: [SG_MOBILE] });

    expect(TwilioPhoneNumbers.canSend(noNumber, TwilioMessageKind.Call)).toBe(
      false,
    );
    // Its SMS numbers still send its SMS.
    expect(TwilioPhoneNumbers.canSend(noNumber, TwilioMessageKind.SMS)).toBe(
      true,
    );
    expect(
      TwilioPhoneNumbers.getCannotSendReason(noNumber, TwilioMessageKind.Call),
    ).toBe("This Twilio config has no number to make calls from.");
    expect(TwilioPhoneNumbers.canSend(config({}), TwilioMessageKind.SMS)).toBe(
      false,
    );
    expect(
      TwilioPhoneNumbers.getCannotSendReason(config({}), TwilioMessageKind.SMS),
    ).toBe("This Twilio config has no number to send SMS from.");
  });
});

describe("a config used for SMS only", () => {
  const smsOnly: TwilioConfig = config({
    use: TwilioConfigUse.SmsOnly,
    sms: [SG_MOBILE, UK_MOBILE],
  });

  test("sends every SMS from its SMS numbers: the one in the recipient's country, or else the first", () => {
    expect(TwilioPhoneNumbers.canSend(smsOnly, TwilioMessageKind.SMS)).toBe(
      true,
    );
    expect(from(smsOnly, TwilioMessageKind.SMS, "+447911123456")).toBe(
      UK_MOBILE,
    );
    expect(from(smsOnly, TwilioMessageKind.SMS, "+33612345678")).toBe(
      SG_MOBILE,
    );
    expect(
      asText(
        TwilioPhoneNumbers.getSenderNumbers(smsOnly, TwilioMessageKind.SMS),
      ),
    ).toEqual({ primary: SG_MOBILE, secondary: [UK_MOBILE] });
  });

  test("makes no call, and says why", () => {
    expect(TwilioPhoneNumbers.canSend(smsOnly, TwilioMessageKind.Call)).toBe(
      false,
    );
    expect(
      TwilioPhoneNumbers.getSenderNumbers(smsOnly, TwilioMessageKind.Call),
    ).toBeNull();
    expect(
      TwilioPhoneNumbers.getCannotSendReason(smsOnly, TwilioMessageKind.Call),
    ).toBe("This Twilio config is used for SMS only, so it makes no calls.");
    expect(() => {
      from(smsOnly, TwilioMessageKind.Call, RECIPIENTS[0]!);
    }).toThrow(
      new BadDataException(
        "This Twilio config is used for SMS only, so it makes no calls.",
      ),
    );
  });

  test("makes no call even from a number it keeps", () => {
    const keepsANumber: TwilioConfig = {
      ...smsOnly,
      primaryPhoneNumber: new Phone(US),
      secondaryPhoneNumbers: [new Phone(UK_LANDLINE)],
    };

    for (const recipient of RECIPIENTS) {
      expect(
        TwilioPhoneNumbers.canSend(keepsANumber, TwilioMessageKind.Call),
      ).toBe(false);
      // And never sends an SMS from it either.
      expect(from(keepsANumber, TwilioMessageKind.SMS, recipient)).not.toBe(US);
      expect(from(keepsANumber, TwilioMessageKind.SMS, recipient)).not.toBe(
        UK_LANDLINE,
      );
    }
  });

  test("without SMS numbers sends nothing at all - not from a number it keeps for calls", () => {
    const noSmsNumbers: TwilioConfig = config({
      use: TwilioConfigUse.SmsOnly,
      primary: US,
    });

    expect(
      TwilioPhoneNumbers.canSend(noSmsNumbers, TwilioMessageKind.SMS),
    ).toBe(false);
    expect(
      TwilioPhoneNumbers.getCannotSendReason(
        noSmsNumbers,
        TwilioMessageKind.SMS,
      ),
    ).toBe("This Twilio config has no number to send SMS from.");
  });
});

describe("a config used for calls only", () => {
  const callsOnly: TwilioConfig = config({
    use: TwilioConfigUse.CallsOnly,
    primary: US,
    secondary: [UK_LANDLINE],
  });

  test("makes calls from its primary and secondary numbers, as a config for both does", () => {
    const both: TwilioConfig = {
      ...callsOnly,
      use: TwilioConfigUse.CallsAndSms,
    };

    expect(TwilioPhoneNumbers.canSend(callsOnly, TwilioMessageKind.Call)).toBe(
      true,
    );

    for (const recipient of RECIPIENTS) {
      expect(from(callsOnly, TwilioMessageKind.Call, recipient)).toBe(
        from(both, TwilioMessageKind.Call, recipient),
      );
    }

    expect(from(callsOnly, TwilioMessageKind.Call, "+442079460000")).toBe(
      UK_LANDLINE,
    );
  });

  test("sends no SMS - not even from SMS numbers it keeps - and says why", () => {
    const keepsSmsNumbers: TwilioConfig = {
      ...callsOnly,
      smsPhoneNumbers: [new Phone(SG_MOBILE)],
    };

    for (const twilioConfig of [callsOnly, keepsSmsNumbers]) {
      expect(
        TwilioPhoneNumbers.canSend(twilioConfig, TwilioMessageKind.SMS),
      ).toBe(false);
      expect(
        TwilioPhoneNumbers.getSenderNumbers(
          twilioConfig,
          TwilioMessageKind.SMS,
        ),
      ).toBeNull();
      expect(
        TwilioPhoneNumbers.getCannotSendReason(
          twilioConfig,
          TwilioMessageKind.SMS,
        ),
      ).toBe("This Twilio config is used for calls only, so it sends no SMS.");
    }

    expect(() => {
      from(keepsSmsNumbers, TwilioMessageKind.SMS, "+6590665484");
    }).toThrow(BadDataException);
  });
});

describe("asking whether a config sends a message", () => {
  test("no config sends nothing", () => {
    for (const kind of [TwilioMessageKind.SMS, TwilioMessageKind.Call]) {
      expect(TwilioPhoneNumbers.canSend(undefined, kind)).toBe(false);
      expect(TwilioPhoneNumbers.canSend(null, kind)).toBe(false);
    }
  });

  test("a config is used for a kind exactly as its use says", () => {
    for (const use of TWILIO_CONFIG_USES) {
      expect(TwilioPhoneNumbers.isUsedFor(use, TwilioMessageKind.SMS)).toBe(
        use !== TwilioConfigUse.CallsOnly,
      );
      expect(TwilioPhoneNumbers.isUsedFor(use, TwilioMessageKind.Call)).toBe(
        use !== TwilioConfigUse.SmsOnly,
      );
    }
  });

  test("a config with every number sends exactly the kinds its use names", () => {
    for (const use of TWILIO_CONFIG_USES) {
      const everyNumber: TwilioConfig = config({
        use: use,
        primary: US,
        secondary: [UK_LANDLINE],
        sms: [SG_MOBILE],
      });

      expect({
        use,
        sms: TwilioPhoneNumbers.canSend(everyNumber, TwilioMessageKind.SMS),
        calls: TwilioPhoneNumbers.canSend(everyNumber, TwilioMessageKind.Call),
      }).toEqual({
        use,
        sms: use !== TwilioConfigUse.CallsOnly,
        calls: use !== TwilioConfigUse.SmsOnly,
      });
    }
  });
});
