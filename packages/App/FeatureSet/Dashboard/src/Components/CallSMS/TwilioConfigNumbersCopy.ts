import Phone from "Common/Types/Phone";
import TwilioPhoneNumbers from "Common/Types/CallAndSMS/TwilioPhoneNumbers";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Which numbers a project's Twilio config sends SMS and calls from, on
 * Project Settings > Notifications > Notification Settings > Twilio Config.
 *
 * A Twilio number can make calls and send SMS, or only one of the two, and
 * in some countries no one number does both: in Singapore, national numbers
 * are voice-only and SMS need a mobile number. So a config can list Twilio
 * SMS Phone Numbers: once it does, every SMS goes out from one of them - the
 * one in the recipient's country, or else the first - and calls keep going
 * out from the primary and secondary numbers
 * (Common/Types/CallAndSMS/TwilioPhoneNumbers). Most configs need none, so
 * the list is under More fields, with the secondary numbers.
 *
 * Kept free of React, so App/Tests can read these exact strings. Every
 * sentence is wrapped in translationKey() so npm run i18n:extract finds it;
 * the table and its form translate them where they draw them.
 */

export const TwilioConfigNumbersCopy: {
  // The primary number's help: what goes out from it.
  primaryPhoneNumberDescription: string;
  // The SMS numbers' help: when to list them, and what they change.
  smsPhoneNumbersDescription: string;
  // The secondary numbers' help.
  secondaryPhoneNumbersDescription: string;
  /*
   * What a number in the Phone Numbers column is for, when calls and SMS go
   * out from different numbers: "Phone Calls", not "Calls", which the
   * locales word as calls of code.
   */
  callsLabel: string;
  smsLabel: string;
} = {
  primaryPhoneNumberDescription: translationKey(
    "Calls go out from this number, and SMS too unless you add SMS phone numbers under More fields.",
  ),
  smsPhoneNumbersDescription: translationKey(
    "If your Twilio numbers can't send SMS (in Singapore, national numbers are voice-only), add numbers that can. Every SMS then goes out from the one in the recipient's country, or else the first.",
  ),
  secondaryPhoneNumbersDescription: translationKey(
    "Numbers to use instead of the primary one when they match the recipient's country code.",
  ),
  callsLabel: translationKey("Phone Calls"),
  smsLabel: translationKey("SMS"),
};

// A number the table shows for a config, and what it sends.
export interface TwilioConfigNumberLine {
  phoneNumber: string;
  // Calls or SMS, when the config sends them from different numbers.
  label: string | null;
}

/*
 * The numbers a config's row shows: its primary number, alone when calls
 * and SMS go out from it, or with its first SMS number when SMS have their
 * own - each then saying which it sends. The rest of either list is in the
 * config's Edit dialog. English labels; the cell translates them.
 */
export const getTwilioConfigNumberLines: (config: {
  twilioPrimaryPhoneNumber?: Phone | string | null | undefined;
  twilioSmsPhoneNumbers?: string | null | undefined;
}) => Array<TwilioConfigNumberLine> = (config: {
  twilioPrimaryPhoneNumber?: Phone | string | null | undefined;
  twilioSmsPhoneNumbers?: string | null | undefined;
}): Array<TwilioConfigNumberLine> => {
  const primary: string = config.twilioPrimaryPhoneNumber
    ? config.twilioPrimaryPhoneNumber.toString()
    : "";

  // The first entry as it was typed: the server checked it when it was saved.
  const sms: string =
    TwilioPhoneNumbers.getListEntries(config.twilioSmsPhoneNumbers)[0] || "";

  if (!sms) {
    return primary ? [{ phoneNumber: primary, label: null }] : [];
  }

  const lines: Array<TwilioConfigNumberLine> = [];

  if (primary) {
    lines.push({
      phoneNumber: primary,
      label: TwilioConfigNumbersCopy.callsLabel,
    });
  }

  lines.push({ phoneNumber: sms, label: TwilioConfigNumbersCopy.smsLabel });

  return lines;
};

export default TwilioConfigNumbersCopy;
