import TwilioConfig from "../../../Types/CallAndSMS/TwilioConfig";
import TwilioConfigJSON from "../../../Types/CallAndSMS/TwilioConfigJSON";
import TwilioPhoneNumbers from "../../../Types/CallAndSMS/TwilioPhoneNumbers";
import { TwilioConfigUse } from "../../../Types/CallAndSMS/TwilioConfigUse";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import Phone from "../../../Types/Phone";
import { TwilioMessageKind } from "../../../Utils/Project/TwilioAccount";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT A TWILIO CONFIG IS USED FOR, ON ITS WAY TO THE NOTIFICATION SERVICE.
 *
 * The server's senders post a project's config (its default, a status
 * page's) to the Notification service with every SMS and call. A config used
 * for SMS only has no number to make calls from, and the Notification
 * service sends nothing through a config that is not used for the message:
 * so what it is used for travels with it. A config used for calls and SMS -
 * every config made before the choice - travels exactly as it always did.
 */

const US: string = "+14155550100";
const SG_MOBILE: string = "+6581234567";
const UK: string = "+447700900123";

// As the route reads a body: parsed from the wire, then deserialized.
function overTheWire(json: JSONObject): unknown {
  const body: JSONObject = JSONFunctions.deserialize(
    JSON.parse(JSON.stringify({ customTwilioConfig: json })) as JSONObject,
  );

  return body["customTwilioConfig"];
}

function smsOnly(): TwilioConfig {
  return {
    accountSid: "AC1",
    authToken: "token",
    use: TwilioConfigUse.SmsOnly,
    secondaryPhoneNumbers: [],
    smsPhoneNumbers: [new Phone(SG_MOBILE), new Phone(UK)],
  };
}

function callsOnly(): TwilioConfig {
  return {
    accountSid: "AC1",
    authToken: "token",
    use: TwilioConfigUse.CallsOnly,
    primaryPhoneNumber: new Phone(US),
    secondaryPhoneNumbers: [new Phone(UK)],
  };
}

describe("a config, sent", () => {
  test("used for calls and SMS travels exactly as before: no use, its number and its lists", () => {
    for (const use of [undefined, TwilioConfigUse.CallsAndSms]) {
      const config: TwilioConfig = {
        accountSid: "AC1",
        authToken: "token",
        primaryPhoneNumber: new Phone(US),
        secondaryPhoneNumbers: [],
      };

      if (use) {
        config.use = use;
      }

      const json: JSONObject = TwilioConfigJSON.toJSON(config);

      expect(json).toEqual({
        accountSid: "AC1",
        authToken: "token",
        primaryPhoneNumber: US,
        secondaryPhoneNumbers: [],
      });
      expect("use" in json).toBe(false);
      // In the order it always had.
      expect(Object.keys(json)).toEqual([
        "accountSid",
        "authToken",
        "primaryPhoneNumber",
        "secondaryPhoneNumbers",
      ]);
    }
  });

  test("used for SMS only says so, and carries no number to make calls from", () => {
    const json: JSONObject = TwilioConfigJSON.toJSON(smsOnly());

    expect(json).toEqual({
      accountSid: "AC1",
      authToken: "token",
      use: "SMS only",
      secondaryPhoneNumbers: [],
      smsPhoneNumbers: [SG_MOBILE, UK],
    });
    expect("primaryPhoneNumber" in json).toBe(false);
  });

  test("used for calls only says so", () => {
    expect(TwilioConfigJSON.toJSON(callsOnly())).toEqual({
      accountSid: "AC1",
      authToken: "token",
      use: "Calls only",
      primaryPhoneNumber: US,
      secondaryPhoneNumbers: [UK],
    });
  });
});

describe("a config, received", () => {
  test("comes back used for what it was sent for, sending what it sent", () => {
    for (const sent of [smsOnly(), callsOnly()]) {
      const received: TwilioConfig | undefined = TwilioConfigJSON.fromJSON(
        overTheWire(TwilioConfigJSON.toJSON(sent)),
      );

      expect(received!.use).toBe(sent.use);

      for (const kind of [TwilioMessageKind.SMS, TwilioMessageKind.Call]) {
        expect({
          use: sent.use,
          kind,
          sends: TwilioPhoneNumbers.canSend(received, kind),
        }).toEqual({
          use: sent.use,
          kind,
          sends: TwilioPhoneNumbers.canSend(sent, kind),
        });
      }
    }
  });

  test("used for SMS only comes back without a number to make calls from, and makes none", () => {
    const received: TwilioConfig | undefined = TwilioConfigJSON.fromJSON(
      overTheWire(TwilioConfigJSON.toJSON(smsOnly())),
    );

    expect(received!.primaryPhoneNumber).toBeUndefined();
    expect("primaryPhoneNumber" in received!).toBe(false);
    expect(received!.smsPhoneNumbers!.map(String)).toEqual([SG_MOBILE, UK]);
    expect(TwilioPhoneNumbers.canSend(received, TwilioMessageKind.Call)).toBe(
      false,
    );
    expect(
      TwilioPhoneNumbers.pickSenderNumber({
        config: received!,
        kind: TwilioMessageKind.SMS,
        to: "+447911123456",
      }).toString(),
    ).toBe(UK);
  });

  test("that says nothing of its use is used for calls and SMS, and carries no use", () => {
    const received: TwilioConfig | undefined = TwilioConfigJSON.fromJSON({
      accountSid: "AC1",
      authToken: "token",
      primaryPhoneNumber: US,
    });

    expect(received!.use).toBeUndefined();
    expect("use" in received!).toBe(false);

    for (const said of [null, "", "Calls and SMS"]) {
      const withUse: TwilioConfig | undefined = TwilioConfigJSON.fromJSON({
        accountSid: "AC1",
        authToken: "token",
        primaryPhoneNumber: US,
        use: said,
      });

      expect("use" in withUse!).toBe(false);
    }
  });

  /*
   * Read as calls and SMS, a config meant for one of the two would send the
   * other through an account the project did not choose for it.
   */
  test("that says it is used for something else is refused", () => {
    for (const use of ["SMS", "sms only", "Email", 3, true, ["SMS only"]]) {
      expect(() => {
        TwilioConfigJSON.fromJSON({
          accountSid: "AC1",
          authToken: "token",
          primaryPhoneNumber: US,
          use: use as string,
        });
      }).toThrow(BadDataException);
    }

    expect(() => {
      TwilioConfigJSON.fromJSON({
        accountSid: "AC1",
        authToken: "token",
        primaryPhoneNumber: US,
        use: "SMS",
      });
    }).toThrow(
      'The Twilio config sent says it is used for "SMS", which is not one of "Calls and SMS", "SMS only" or "Calls only".',
    );
  });

  test("used for SMS only, without SMS numbers, is refused", () => {
    for (const numbers of [undefined, [], ""]) {
      expect(() => {
        TwilioConfigJSON.fromJSON({
          accountSid: "AC1",
          authToken: "token",
          primaryPhoneNumber: US,
          use: TwilioConfigUse.SmsOnly,
          smsPhoneNumbers: numbers as Array<string>,
        });
      }).toThrow(
        "The Twilio config sent is used for SMS only and has no SMS phone numbers.",
      );
    }
  });

  test("used for calls, without a number to make them from, is refused as before", () => {
    for (const use of [
      TwilioConfigUse.CallsOnly,
      TwilioConfigUse.CallsAndSms,
    ]) {
      expect(() => {
        TwilioConfigJSON.fromJSON({
          accountSid: "AC1",
          authToken: "token",
          use: use,
          smsPhoneNumbers: [SG_MOBILE],
        });
      }).toThrow(
        "The Twilio config sent has no account SID, auth token or primary phone number.",
      );
    }
  });

  test("used for SMS only still needs its account and token", () => {
    for (const missing of ["accountSid", "authToken"]) {
      const json: JSONObject = {
        accountSid: "AC1",
        authToken: "token",
        use: TwilioConfigUse.SmsOnly,
        smsPhoneNumbers: [SG_MOBILE],
      };
      delete json[missing];

      expect(() => {
        TwilioConfigJSON.fromJSON(json);
      }).toThrow(BadDataException);
    }
  });
});
