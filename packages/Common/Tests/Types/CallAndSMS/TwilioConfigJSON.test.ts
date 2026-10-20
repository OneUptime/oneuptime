import TwilioConfig from "../../../Types/CallAndSMS/TwilioConfig";
import TwilioConfigJSON from "../../../Types/CallAndSMS/TwilioConfigJSON";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import Phone from "../../../Types/Phone";
import { describe, expect, test } from "@jest/globals";

/*
 * A TWILIO CONFIG ON ITS WAY TO THE NOTIFICATION SERVICE.
 *
 * Every SMS and call the server sends through a project's own Twilio config
 * (its default, a status page's) is posted to the Notification service's
 * /sms/send or /call/make-call with the config in the body. The lists of
 * numbers used to travel as an array's toString() - one comma-separated
 * string - and were read back as if they were still an array, so a config
 * with secondary numbers had every SMS and call through it fail with
 * "secondaryPhoneNumbersToPickFrom.map is not a function". The SMS numbers
 * travel the same way, so the lists now go as arrays, and a string - what a
 * sender of the older shape posts - is read as a list too.
 *
 * These read a config the way the route does: JSON over the wire, then
 * JSONFunctions.deserialize, then TwilioConfigJSON.fromJSON.
 */

const SG_NATIONAL: string = "+6561234567";
const SG_MOBILE: string = "+6581234567";
const UK: string = "+447700900123";
const SE: string = "+46701234567";

function fullConfig(): TwilioConfig {
  return {
    accountSid: "AC00000000000000000000000000000001",
    authToken: "auth-token",
    primaryPhoneNumber: new Phone(SG_NATIONAL),
    secondaryPhoneNumbers: [new Phone(UK)],
    smsPhoneNumbers: [new Phone(SG_MOBILE), new Phone(SE), new Phone(UK)],
  };
}

// As the route reads a body: parsed from the wire, then deserialized.
function overTheWire(json: JSONObject): unknown {
  const body: JSONObject = JSONFunctions.deserialize(
    JSON.parse(JSON.stringify({ customTwilioConfig: json })) as JSONObject,
  );

  return body["customTwilioConfig"];
}

function asText(config: TwilioConfig | undefined): Record<string, unknown> {
  if (!config) {
    return {};
  }

  return {
    accountSid: config.accountSid,
    authToken: config.authToken,
    primaryPhoneNumber: config.primaryPhoneNumber.toString(),
    secondaryPhoneNumbers: config.secondaryPhoneNumbers.map(
      (phone: Phone): string => {
        return phone.toString();
      },
    ),
    smsPhoneNumbers: config.smsPhoneNumbers?.map((phone: Phone): string => {
      return phone.toString();
    }),
  };
}

describe("a Twilio config, sent", () => {
  test("carries its lists of numbers as arrays, the SMS numbers in their order", () => {
    expect(TwilioConfigJSON.toJSON(fullConfig())).toEqual({
      accountSid: "AC00000000000000000000000000000001",
      authToken: "auth-token",
      primaryPhoneNumber: SG_NATIONAL,
      secondaryPhoneNumbers: [UK],
      smsPhoneNumbers: [SG_MOBILE, SE, UK],
    });
  });

  test("leaves out the SMS numbers a config does not have", () => {
    for (const smsPhoneNumbers of [undefined, [] as Array<Phone>]) {
      const config: TwilioConfig = {
        accountSid: "AC1",
        authToken: "token",
        primaryPhoneNumber: new Phone(SG_NATIONAL),
        secondaryPhoneNumbers: [],
      };

      if (smsPhoneNumbers) {
        config.smsPhoneNumbers = smsPhoneNumbers;
      }

      const json: JSONObject = TwilioConfigJSON.toJSON(config);

      expect(json).toEqual({
        accountSid: "AC1",
        authToken: "token",
        primaryPhoneNumber: SG_NATIONAL,
        secondaryPhoneNumbers: [],
      });
      expect("smsPhoneNumbers" in json).toBe(false);
    }
  });

  test("comes back, over the wire, as the config that was sent", () => {
    const sent: TwilioConfig = fullConfig();
    const received: TwilioConfig | undefined = TwilioConfigJSON.fromJSON(
      overTheWire(TwilioConfigJSON.toJSON(sent)),
    );

    expect(asText(received)).toEqual(asText(sent));
    expect(received!.primaryPhoneNumber).toBeInstanceOf(Phone);
    expect(received!.secondaryPhoneNumbers[0]).toBeInstanceOf(Phone);
    expect(received!.smsPhoneNumbers![0]).toBeInstanceOf(Phone);
    expect(received!.smsPhoneNumbers![2]).toBeInstanceOf(Phone);
  });

  test("a config without SMS numbers comes back without them", () => {
    const received: TwilioConfig | undefined = TwilioConfigJSON.fromJSON(
      overTheWire(
        TwilioConfigJSON.toJSON({
          accountSid: "AC1",
          authToken: "token",
          primaryPhoneNumber: new Phone(SG_NATIONAL),
          secondaryPhoneNumbers: [new Phone(UK)],
        }),
      ),
    );

    expect(received!.smsPhoneNumbers).toBeUndefined();
    expect("smsPhoneNumbers" in received!).toBe(false);
    expect(received!.secondaryPhoneNumbers.map(String)).toEqual([UK]);
  });
});

describe("a Twilio config, received", () => {
  /*
   * What the server's senders posted until now: each list as an array's
   * toString(). Read as a list, not handed on as a string a sender would
   * call .map on.
   */
  test("reads a list sent as one comma-separated string - the older senders' shape", () => {
    const received: TwilioConfig | undefined = TwilioConfigJSON.fromJSON(
      overTheWire({
        accountSid: "AC1",
        authToken: "token",
        primaryPhoneNumber: SG_NATIONAL,
        secondaryPhoneNumbers: [new Phone(UK), new Phone(SE)].toString(),
        smsPhoneNumbers: [new Phone(SG_MOBILE), new Phone(UK)].toString(),
      }),
    );

    expect(Array.isArray(received!.secondaryPhoneNumbers)).toBe(true);
    expect(received!.secondaryPhoneNumbers.map(String)).toEqual([UK, SE]);
    expect(received!.smsPhoneNumbers!.map(String)).toEqual([SG_MOBILE, UK]);
  });

  test("reads an empty string, as an older sender posted no numbers, as no numbers", () => {
    const received: TwilioConfig | undefined = TwilioConfigJSON.fromJSON(
      overTheWire({
        accountSid: "AC1",
        authToken: "token",
        primaryPhoneNumber: SG_NATIONAL,
        secondaryPhoneNumbers: ([] as Array<Phone>).toString(),
        smsPhoneNumbers: "",
      }),
    );

    expect(received!.secondaryPhoneNumbers).toEqual([]);
    expect(received!.smsPhoneNumbers).toBeUndefined();
  });

  test("reads a list with no numbers at all as an empty one", () => {
    const received: TwilioConfig | undefined = TwilioConfigJSON.fromJSON({
      accountSid: "AC1",
      authToken: "token",
      primaryPhoneNumber: SG_NATIONAL,
    });

    expect(received!.secondaryPhoneNumbers).toEqual([]);
    expect(received!.smsPhoneNumbers).toBeUndefined();
  });

  test("reads numbers given as Phones, or as serialized Phones", () => {
    const received: TwilioConfig | undefined = TwilioConfigJSON.fromJSON({
      accountSid: "AC1",
      authToken: "token",
      primaryPhoneNumber: new Phone(SG_NATIONAL) as unknown as string,
      secondaryPhoneNumbers: [new Phone(UK).toJSON()],
      smsPhoneNumbers: [new Phone(SG_MOBILE).toJSON()],
    });

    expect(received!.primaryPhoneNumber.toString()).toBe(SG_NATIONAL);
    expect(received!.secondaryPhoneNumbers.map(String)).toEqual([UK]);
    expect(received!.smsPhoneNumbers!.map(String)).toEqual([SG_MOBILE]);
  });

  test("carries none when the request carries none: the server's own account is used", () => {
    expect(TwilioConfigJSON.fromJSON(undefined)).toBeUndefined();
    expect(TwilioConfigJSON.fromJSON(null)).toBeUndefined();
  });

  /*
   * Dropping a config it cannot read would send the message through the
   * OneUptime server's own account instead - paid from the project's
   * balance, through an account the project did not choose.
   */
  test("refuses a config it cannot read rather than falling back to the server's account", () => {
    expect(() => {
      TwilioConfigJSON.fromJSON("AC1,token");
    }).toThrow(BadDataException);
    expect(() => {
      TwilioConfigJSON.fromJSON([SG_NATIONAL]);
    }).toThrow("The Twilio config sent is not an object.");

    for (const missing of ["accountSid", "authToken", "primaryPhoneNumber"]) {
      const json: JSONObject = {
        accountSid: "AC1",
        authToken: "token",
        primaryPhoneNumber: SG_NATIONAL,
      };
      delete json[missing];

      expect(() => {
        TwilioConfigJSON.fromJSON(json);
      }).toThrow(
        "The Twilio config sent has no account SID, auth token or primary phone number.",
      );
    }

    expect(() => {
      TwilioConfigJSON.fromJSON({
        accountSid: "AC1",
        authToken: "token",
        primaryPhoneNumber: "   ",
      });
    }).toThrow(BadDataException);
  });

  test("refuses a number that is not one, naming it", () => {
    expect(() => {
      TwilioConfigJSON.fromJSON({
        accountSid: "AC1",
        authToken: "token",
        primaryPhoneNumber: SG_NATIONAL,
        smsPhoneNumbers: [UK, "not-a-number"],
      });
    }).toThrow('"not-a-number" is not a phone number.');
    expect(() => {
      TwilioConfigJSON.fromJSON({
        accountSid: "AC1",
        authToken: "token",
        primaryPhoneNumber: SG_NATIONAL,
        smsPhoneNumbers: "letters",
      });
    }).toThrow(BadDataException);
  });
});
