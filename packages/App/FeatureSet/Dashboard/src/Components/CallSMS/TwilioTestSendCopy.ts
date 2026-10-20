import { TEST_SEND_FROM_PHONE_NUMBER_FIELD } from "Common/Types/CallAndSMS/TwilioPhoneNumbers";
import { JSONObject } from "Common/Types/JSON";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What the Send Test SMS and Send Test Call dialogs of a Twilio config say,
 * on Project Settings > Notifications > Notification Settings > Twilio
 * Config: the row actions that check a config works - and, since a config
 * can send SMS from numbers of their own (TwilioConfigNumbersCopy), which
 * number it sends from.
 *
 * A test answered with success went out: the Notification service refuses
 * a test it did not hand to Twilio (the project has SMS or calls turned
 * off), and answers with the number Twilio sends it from - the one a real
 * SMS or call to the same phone would go out from - which the dialog names.
 *
 * Kept free of React, so App/Tests can read these exact strings. Every
 * sentence is wrapped in translationKey() so npm run i18n:extract finds it;
 * the table translates them where it draws them.
 */

export enum TwilioTestSendKind {
  SMS = "SMS",
  Call = "Call",
}

export const TwilioTestSendCopy: {
  // Under each dialog's title: what the test is for.
  smsDescription: string;
  callDescription: string;
  // The dialog that says a test went out.
  smsSentTitle: string;
  callPlacedTitle: string;
  // What went out, and from which number, when the answer names it.
  smsSentFrom: string;
  smsSent: string;
  callPlacedFrom: string;
  callPlaced: string;
} = {
  smsDescription: translationKey(
    "Send a test SMS to check this Twilio config.",
  ),
  callDescription: translationKey(
    "Make a test call to check this Twilio config.",
  ),
  smsSentTitle: translationKey("Test SMS Sent"),
  callPlacedTitle: translationKey("Test Call Placed"),
  smsSentFrom: translationKey(
    "Twilio accepted the test SMS from {{phoneNumber}}. It should arrive within a few minutes.",
  ),
  smsSent: translationKey(
    "Twilio accepted the test SMS. It should arrive within a few minutes.",
  ),
  callPlacedFrom: translationKey(
    "Twilio is calling from {{phoneNumber}}. Your phone should ring within a minute.",
  ),
  callPlaced: translationKey(
    "Twilio is placing the test call. Your phone should ring within a minute.",
  ),
};

/*
 * The number a successful test went out from, as the Notification service
 * answered it, or an empty string when the answer names none (a service
 * from before it did): the dialog then says what went out without it.
 */
export const getTestSendFromPhoneNumber: (data: unknown) => string = (
  data: unknown,
): string => {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return "";
  }

  const value: unknown = (data as JSONObject)[
    TEST_SEND_FROM_PHONE_NUMBER_FIELD
  ];

  return typeof value === "string" ? value.trim() : "";
};

// What the dialog says went out: the sentence and the number in it.
export interface TwilioTestSentMessage {
  template: string;
  phoneNumber: string;
}

export const getTestSentMessage: (data: {
  kind: TwilioTestSendKind;
  fromPhoneNumber: string;
}) => TwilioTestSentMessage = (data: {
  kind: TwilioTestSendKind;
  fromPhoneNumber: string;
}): TwilioTestSentMessage => {
  const isSms: boolean = data.kind === TwilioTestSendKind.SMS;

  if (!data.fromPhoneNumber) {
    return {
      template: isSms
        ? TwilioTestSendCopy.smsSent
        : TwilioTestSendCopy.callPlaced,
      phoneNumber: "",
    };
  }

  return {
    template: isSms
      ? TwilioTestSendCopy.smsSentFrom
      : TwilioTestSendCopy.callPlacedFrom,
    phoneNumber: data.fromPhoneNumber,
  };
};

export default TwilioTestSendCopy;
