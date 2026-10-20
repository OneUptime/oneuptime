import TwilioConfig from "./TwilioConfig";
import TwilioPhoneNumbers from "./TwilioPhoneNumbers";
import BadDataException from "../Exception/BadDataException";
import { JSONObject } from "../JSON";
import Phone from "../Phone";

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
 */
export default class TwilioConfigJSON {
  public static toJSON(config: TwilioConfig): JSONObject {
    const json: JSONObject = {
      accountSid: config.accountSid,
      authToken: config.authToken,
      primaryPhoneNumber: config.primaryPhoneNumber.toString(),
      secondaryPhoneNumbers: TwilioConfigJSON.listToJSON(
        config.secondaryPhoneNumbers,
      ),
    };

    if (config.smsPhoneNumber) {
      json["smsPhoneNumber"] = config.smsPhoneNumber.toString();
    }

    const smsSecondaryPhoneNumbers: Array<string> = TwilioConfigJSON.listToJSON(
      config.smsSecondaryPhoneNumbers,
    );

    if (smsSecondaryPhoneNumbers.length > 0) {
      json["smsSecondaryPhoneNumbers"] = smsSecondaryPhoneNumbers;
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

    const accountSid: string = TwilioConfigJSON.textOf(json["accountSid"]);
    const authToken: string = TwilioConfigJSON.textOf(json["authToken"]);
    const primaryPhoneNumber: string = TwilioConfigJSON.textOf(
      json["primaryPhoneNumber"],
    );

    if (!accountSid || !authToken || !primaryPhoneNumber) {
      throw new BadDataException(
        "The Twilio config sent has no account SID, auth token or primary phone number.",
      );
    }

    const config: TwilioConfig = {
      accountSid: accountSid,
      authToken: authToken,
      primaryPhoneNumber: new Phone(primaryPhoneNumber),
      secondaryPhoneNumbers: TwilioConfigJSON.listFromJSON(
        json["secondaryPhoneNumbers"],
      ),
    };

    const smsPhoneNumber: string = TwilioConfigJSON.textOf(
      json["smsPhoneNumber"],
    );

    if (smsPhoneNumber) {
      config.smsPhoneNumber = new Phone(smsPhoneNumber);
    }

    const smsSecondaryPhoneNumbers: Array<Phone> =
      TwilioConfigJSON.listFromJSON(json["smsSecondaryPhoneNumbers"]);

    if (smsSecondaryPhoneNumbers.length > 0) {
      config.smsSecondaryPhoneNumbers = smsSecondaryPhoneNumbers;
    }

    return config;
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
