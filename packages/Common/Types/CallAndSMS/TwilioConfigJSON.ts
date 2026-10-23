import TwilioConfig from "./TwilioConfig";
import TwilioConfigUses, { TwilioConfigUse } from "./TwilioConfigUse";
import TwilioPhoneNumbers from "./TwilioPhoneNumbers";
import BadDataException from "../Exception/BadDataException";
import { JSONObject } from "../JSON";
import Phone from "../Phone";
import { refusedValue } from "../../Utils/RefusedValue";

/*
 * A Twilio config as it travels from the server's senders (Common's
 * SmsService and CallService) to the Notification service's /sms/send and
 * /call/make-call routes, as plain JSON.
 *
 * The lists of numbers used to be sent as an array's toString() - one
 * comma-separated string - and read back as if they were an array, so a
 * project config with secondary numbers had every SMS and call through it
 * fail with "secondaryPhoneNumbersToPickFrom.map is not a function". Now
 * they travel as arrays of numbers, and a comma-separated string - what an
 * older sender sends - is read as a list too.
 *
 * What a config is used for (TwilioConfigUse) travels with it when it is
 * not calls and SMS: a config used for SMS only has no number to make calls
 * from, and the Notification service sends nothing through a config that is
 * not used for the message - that message goes as it would without one. A
 * config used for calls and SMS - every config made before the choice -
 * travels exactly as it always did.
 */
export default class TwilioConfigJSON {
  public static toJSON(config: TwilioConfig): JSONObject {
    const json: JSONObject = {
      accountSid: config.accountSid,
      authToken: config.authToken,
    };

    // Left out when it is calls and SMS, as an older receiver expects.
    const use: TwilioConfigUse = TwilioConfigUses.getUse(config.use);

    if (use !== TwilioConfigUse.CallsAndSms) {
      json["use"] = use;
    }

    // A config used for SMS only has none.
    if (config.primaryPhoneNumber) {
      json["primaryPhoneNumber"] = config.primaryPhoneNumber.toString();
    }

    json["secondaryPhoneNumbers"] = TwilioConfigJSON.listToJSON(
      config.secondaryPhoneNumbers,
    );

    const smsPhoneNumbers: Array<string> = TwilioConfigJSON.listToJSON(
      config.smsPhoneNumbers,
    );

    // Left out when there are none, as an older receiver expects.
    if (smsPhoneNumbers.length > 0) {
      json["smsPhoneNumbers"] = smsPhoneNumbers;
    }

    return json;
  }

  /*
   * The config a request carries, or undefined when it carries none - the
   * message then goes through the OneUptime server's own account. A config
   * that is there but cannot be read is refused rather than dropped: sent
   * through the server's account instead, the message would be paid from
   * the project's balance through an account the project did not choose.
   */
  public static fromJSON(value: unknown): TwilioConfig | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (typeof value !== "object" || Array.isArray(value)) {
      throw new BadDataException("The Twilio config sent is not an object.");
    }

    const json: JSONObject = value as JSONObject;

    // Unset: calls and SMS, as every config was. Anything else is refused.
    const use: TwilioConfigUse = TwilioConfigJSON.useOf(json["use"]);

    const accountSid: string = TwilioConfigJSON.textOf(json["accountSid"]);
    const authToken: string = TwilioConfigJSON.textOf(json["authToken"]);
    const primaryPhoneNumber: string = TwilioConfigJSON.textOf(
      json["primaryPhoneNumber"],
    );

    // A config used for SMS only needs no number to make calls from.
    if (
      !accountSid ||
      !authToken ||
      (!primaryPhoneNumber && use !== TwilioConfigUse.SmsOnly)
    ) {
      throw new BadDataException(
        "The Twilio config sent has no account SID, auth token or primary phone number.",
      );
    }

    const config: TwilioConfig = {
      accountSid: accountSid,
      authToken: authToken,
      secondaryPhoneNumbers: TwilioConfigJSON.listFromJSON(
        json["secondaryPhoneNumbers"],
      ),
    };

    if (use !== TwilioConfigUse.CallsAndSms) {
      config.use = use;
    }

    if (primaryPhoneNumber) {
      config.primaryPhoneNumber = new Phone(primaryPhoneNumber);
    }

    const smsPhoneNumbers: Array<Phone> = TwilioConfigJSON.listFromJSON(
      json["smsPhoneNumbers"],
    );

    if (smsPhoneNumbers.length > 0) {
      config.smsPhoneNumbers = smsPhoneNumbers;
    }

    // Used for SMS only, it sends every SMS from these: it must have one.
    if (use === TwilioConfigUse.SmsOnly && smsPhoneNumbers.length === 0) {
      throw new BadDataException(
        "The Twilio config sent is used for SMS only and has no SMS phone numbers.",
      );
    }

    return config;
  }

  // What a config sent says it is used for.
  private static useOf(value: unknown): TwilioConfigUse {
    if (value === undefined || value === null || value === "") {
      return TwilioConfigUse.CallsAndSms;
    }

    if (TwilioConfigUses.isUse(value)) {
      return value;
    }

    /*
     * Read as calls and SMS, a config meant for one of the two would send
     * the other through an account the project did not choose for it.
     */
    throw new BadDataException(
      `The Twilio config sent says it is used for "${refusedValue(value)}", which is not one of "${TwilioConfigUse.CallsAndSms}", "${TwilioConfigUse.SmsOnly}" or "${TwilioConfigUse.CallsOnly}".`,
    );
  }

  private static listToJSON(
    numbers: Array<Phone> | undefined | null,
  ): Array<string> {
    return (numbers || []).map((phone: Phone): string => {
      return phone.toString();
    });
  }

  // An array of numbers, or one comma-separated string of them.
  private static listFromJSON(value: unknown): Array<Phone> {
    if (Array.isArray(value)) {
      return TwilioPhoneNumbers.parseList(
        value
          .map((entry: unknown): string => {
            return TwilioConfigJSON.textOf(entry);
          })
          .join(","),
      );
    }

    return TwilioPhoneNumbers.parseList(TwilioConfigJSON.textOf(value));
  }

  // A string, a Phone or a { _type: "Phone", value } as text; "" otherwise.
  private static textOf(value: unknown): string {
    if (typeof value === "string") {
      return value.trim();
    }

    if (value instanceof Phone) {
      return value.toString();
    }

    if (
      value &&
      typeof value === "object" &&
      typeof (value as JSONObject)["value"] === "string"
    ) {
      return ((value as JSONObject)["value"] as string).trim();
    }

    return "";
  }
}
