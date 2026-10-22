import GlobalConfig from "../../Models/DatabaseModels/GlobalConfig";
import TwilioConfig from "../../Types/CallAndSMS/TwilioConfig";
import TwilioConfigUses, {
  TwilioConfigUse,
} from "../../Types/CallAndSMS/TwilioConfigUse";
import TwilioPhoneNumbers from "../../Types/CallAndSMS/TwilioPhoneNumbers";
import Phone from "../../Types/Phone";

/*
 * THE ONEUPTIME SERVER'S OWN TWILIO ACCOUNT, AS THE SENDERS TAKE IT.
 *
 * Admin Dashboard > Settings > Call and SMS keeps it in GlobalConfig, read
 * with GLOBAL_TWILIO_CONFIG_SELECT. It is set up once it has an account SID,
 * an auth token and the numbers what it is used for takes
 * (Types/CallAndSMS/TwilioConfigUse): a number to make calls from, unless it
 * is used for SMS only - it then lists the numbers every SMS goes out from.
 * The Notification service sends through it (Notification/Config
 * getTwilioConfig), and the checks made before a verification code is sent
 * ask whether it could (TwilioAccountAvailability) - one reading for both.
 *
 * An account used for SMS only makes no calls, and one used for calls only
 * sends no SMS (TwilioPhoneNumbers.canSend): such a message has no account
 * on the server to go through.
 */
export const toServerTwilioConfig: (
  globalConfig: GlobalConfig | null | undefined,
) => TwilioConfig | null = (
  globalConfig: GlobalConfig | null | undefined,
): TwilioConfig | null => {
  if (
    !globalConfig ||
    !globalConfig.twilioAccountSID ||
    !globalConfig.twilioAuthToken
  ) {
    return null;
  }

  const use: TwilioConfigUse = TwilioConfigUses.getUse(
    globalConfig.twilioUsedFor,
  );

  if (!globalConfig.twilioPrimaryPhoneNumber && use !== TwilioConfigUse.SmsOnly) {
    return null;
  }

  const twilioConfig: TwilioConfig = {
    accountSid: globalConfig.twilioAccountSID,
    authToken: globalConfig.twilioAuthToken,
    secondaryPhoneNumbers: TwilioPhoneNumbers.parseList(
      globalConfig.twilioSecondaryPhoneNumbers,
    ),
  };

  // Left out for calls and SMS, as every installation's account was.
  if (use !== TwilioConfigUse.CallsAndSms) {
    twilioConfig.use = use;
  }

  if (globalConfig.twilioPrimaryPhoneNumber) {
    twilioConfig.primaryPhoneNumber = globalConfig.twilioPrimaryPhoneNumber;
  }

  // Every SMS goes out from one of these, when the server lists them.
  const smsPhoneNumbers: Array<Phone> = TwilioPhoneNumbers.parseList(
    globalConfig.twilioSmsPhoneNumbers,
  );

  if (smsPhoneNumbers.length > 0) {
    twilioConfig.smsPhoneNumbers = smsPhoneNumbers;
  }

  // Used for SMS only, it sends every SMS from these: without one, nothing.
  if (use === TwilioConfigUse.SmsOnly && smsPhoneNumbers.length === 0) {
    return null;
  }

  return twilioConfig;
};

export default toServerTwilioConfig;
