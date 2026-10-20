import Phone from "../Phone";

/*
 * A Twilio account and the numbers SMS and calls go out from: a project's
 * Twilio config (ProjectCallSMSConfig) or the OneUptime server's own
 * (GlobalConfig, Admin Dashboard > Settings > Call and SMS).
 *
 * Calls go out from the primary number, or from a secondary number in the
 * recipient's country. So do SMS, unless the config has SMS numbers of its
 * own: a Twilio number can make calls and send SMS, or only one of the two
 * (Twilio sells "Voice Enabled Only" and "SMS Enabled Only" numbers), and in
 * some countries no one number does both - in Singapore, calls need a
 * national number and SMS a mobile number. Each SMS number list takes the
 * place of its counterpart for SMS (TwilioPhoneNumbers.getSenderNumbers).
 */
export default interface TwilioConfig {
  accountSid: string;
  authToken: string;
  primaryPhoneNumber: Phone;
  secondaryPhoneNumbers: Phone[];
  // SMS go out from this number instead of the primary one.
  smsPhoneNumber?: Phone | undefined;
  // SMS go out from these instead of the secondary numbers, by country.
  smsSecondaryPhoneNumbers?: Phone[] | undefined;
}
