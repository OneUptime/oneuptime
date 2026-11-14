import GlobalConfig from "../../Models/DatabaseModels/GlobalConfig";
import ServerTwilioEnvironment, {
  ServerTwilioEnvironmentReading,
} from "../../Types/CallAndSMS/ServerTwilioEnvironment";
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
 * with GLOBAL_TWILIO_CONFIG_SELECT - unless the GLOBAL_TWILIO_ environment
 * variables set it (Types/CallAndSMS/ServerTwilioEnvironment, #7515): once
 * GLOBAL_TWILIO_ACCOUNT_SID is set, the account is the one they describe,
 * whatever the row holds, and with something wrong with them it sends
 * nothing. It is set up once it has an account SID, an auth token and the
 * numbers what it is used for takes (Types/CallAndSMS/TwilioConfigUse): a
 * number to make calls from, unless it is used for SMS only - it then lists
 * the numbers every SMS goes out from. The Notification service sends
 * through it (Notification/Config getTwilioConfig), and the checks made
 * before a verification code is sent ask whether it could
 * (TwilioAccountAvailability), as does the server's sending status
 * (ServerChannelSetup) - one reading for all of them, so the variables
 * reach every one.
 *
 * An account used for SMS only makes no calls, and one used for calls only
 * sends no SMS (TwilioPhoneNumbers.canSend): such a message has no account
 * on the server to go through.
 */

// The columns of the account, as the row holds them and the variables give them.
type ServerTwilioColumns = {
  [Column in
    | "twilioUsedFor"
    | "twilioAccountSID"
    | "twilioAuthToken"
    | "twilioPrimaryPhoneNumber"
    | "twilioSecondaryPhoneNumbers"
    | "twilioSmsPhoneNumbers"]?: GlobalConfig[Column] | undefined;
};

/*
 * The GLOBAL_TWILIO_ variables as this server was started with them, read
 * again on every call: a test, or a process that sets them, is read as it
 * is now.
 */
export const getServerTwilioEnvironment: () => ServerTwilioEnvironmentReading =
  (): ServerTwilioEnvironmentReading => {
    return ServerTwilioEnvironment.read(process.env);
  };

const toTwilioConfig: (
  columns: ServerTwilioColumns | null | undefined,
) => TwilioConfig | null = (
  columns: ServerTwilioColumns | null | undefined,
): TwilioConfig | null => {
  if (!columns || !columns.twilioAccountSID || !columns.twilioAuthToken) {
    return null;
  }

  const use: TwilioConfigUse = TwilioConfigUses.getUse(columns.twilioUsedFor);

  if (!columns.twilioPrimaryPhoneNumber && use !== TwilioConfigUse.SmsOnly) {
    return null;
  }

  const twilioConfig: TwilioConfig = {
    accountSid: columns.twilioAccountSID,
    authToken: columns.twilioAuthToken,
    secondaryPhoneNumbers: TwilioPhoneNumbers.parseList(
      columns.twilioSecondaryPhoneNumbers,
    ),
  };

  // Left out for calls and SMS, as every installation's account was.
  if (use !== TwilioConfigUse.CallsAndSms) {
    twilioConfig.use = use;
  }

  if (columns.twilioPrimaryPhoneNumber) {
    twilioConfig.primaryPhoneNumber = columns.twilioPrimaryPhoneNumber;
  }

  // Every SMS goes out from one of these, when the server lists them.
  const smsPhoneNumbers: Array<Phone> = TwilioPhoneNumbers.parseList(
    columns.twilioSmsPhoneNumbers,
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

export const toServerTwilioConfig: (
  globalConfig: GlobalConfig | null | undefined,
) => TwilioConfig | null = (
  globalConfig: GlobalConfig | null | undefined,
): TwilioConfig | null => {
  const environment: ServerTwilioEnvironmentReading =
    getServerTwilioEnvironment();

  if (environment.isSet) {
    // The variables are the whole account, and one with a problem sends nothing.
    return ServerTwilioEnvironment.isUsable(environment)
      ? toTwilioConfig(environment.account)
      : null;
  }

  return toTwilioConfig(globalConfig);
};

export default toServerTwilioConfig;
