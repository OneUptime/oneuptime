import Phone from "../Phone";
import { TwilioConfigUse } from "./TwilioConfigUse";

/*
 * A Twilio account and the numbers SMS and calls go out from: a project's
 * Twilio config (ProjectCallSMSConfig) or the OneUptime server's own
 * (GlobalConfig, Admin Dashboard > Settings > Call and SMS).
 *
 * A config is used for calls and SMS, for SMS only or for calls only
 * (TwilioConfigUse), and holds the numbers that takes. Calls go out from
 * the primary number, or from a secondary number in the recipient's
 * country. So do SMS, unless the config has SMS numbers: a Twilio number
 * can make calls and send SMS, or only one of the two (Twilio sells "Voice
 * Enabled Only" and "SMS Enabled Only" numbers), and in some countries no
 * one number does both - in Singapore, national numbers are voice-only and
 * SMS need a mobile number. Once a config has SMS numbers, every SMS goes
 * out from one of them: the one in the recipient's country, or else the
 * first (TwilioPhoneNumbers.getSenderNumbers). A config used for SMS only
 * has SMS numbers and needs no primary number; it never makes a call, and a
 * config used for calls only never sends an SMS.
 */
export default interface TwilioConfig {
  accountSid: string;
  authToken: string;
  // What it is used for: calls and SMS when left out, as every config was.
  use?: TwilioConfigUse | undefined;
  // The number calls go out from. A config used for SMS only has none.
  primaryPhoneNumber?: Phone | undefined;
  secondaryPhoneNumbers: Phone[];
  // The numbers every SMS goes out from, when there are any.
  smsPhoneNumbers?: Phone[] | undefined;
}
