import Phone from "Common/Types/Phone";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Which numbers a project's Twilio config sends SMS and calls from, on
 * Project Settings > Notifications > Notification Settings > Twilio Config.
 *
 * A Twilio number can make calls and send SMS, or only one of the two, and
 * in some countries no one number does both: in Singapore, calls need a
 * national number and SMS a mobile number. So a config can send SMS from
 * numbers of their own - the Twilio SMS Phone Number in place of the
 * primary number, and the Twilio SMS Secondary Phone Numbers in place of
 * the secondary ones (Common/Types/CallAndSMS/TwilioPhoneNumbers). Most
 * configs need neither, so both are under More fields, with the secondary
 * numbers they stand beside.
 *
 * Kept free of React, so App/Tests can read these exact strings. Every
 * sentence is wrapped in translationKey() so npm run i18n:extract finds it;
 * the table and its form translate them where they draw them.
 */

export const TwilioConfigNumbersCopy: {
  // The primary number's help: what goes out from it.
  primaryPhoneNumberDescription: string;
  // The SMS number's help: when to set one, and what it changes.
  smsPhoneNumberDescription: string;
  // The secondary numbers' help.
  secondaryPhoneNumbersDescription: string;
  // The SMS secondary numbers' help.
  smsSecondaryPhoneNumbersDescription: string;
  /*
   * What a number in that column is for, when calls and SMS have their own:
   * "Phone Calls", not "Calls", which the locales word as calls of code.
   */
  callsLabel: string;
  smsLabel: string;
} = {
  primaryPhoneNumberDescription: translationKey(
    "Calls go out from this number, and SMS too unless you set an SMS phone number under More fields.",
  ),
  smsPhoneNumberDescription: translationKey(
    "Send SMS from this number instead of the primary one, if the primary number can only make calls. In Singapore, for example, calls need a national number and SMS a mobile number.",
  ),
  secondaryPhoneNumbersDescription: translationKey(
    "Numbers to use instead of the primary one when they match the recipient's country code.",
  ),
  smsSecondaryPhoneNumbersDescription: translationKey(
    "Numbers to send SMS from instead of the secondary ones when they match the recipient's country code.",
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
 * and SMS go out from it, or with its SMS number when SMS have their own -
 * each then saying which it sends. English labels; the cell translates them.
 */
export const getTwilioConfigNumberLines: (config: {
  twilioPrimaryPhoneNumber?: Phone | string | null | undefined;
  twilioSmsPhoneNumber?: Phone | string | null | undefined;
}) => Array<TwilioConfigNumberLine> = (config: {
  twilioPrimaryPhoneNumber?: Phone | string | null | undefined;
  twilioSmsPhoneNumber?: Phone | string | null | undefined;
}): Array<TwilioConfigNumberLine> => {
  const primary: string = config.twilioPrimaryPhoneNumber
    ? config.twilioPrimaryPhoneNumber.toString()
    : "";
  const sms: string = config.twilioSmsPhoneNumber
    ? config.twilioSmsPhoneNumber.toString()
    : "";

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
