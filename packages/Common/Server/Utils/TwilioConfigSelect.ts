import Select from "../Types/Database/Select";
import GlobalConfig from "../../Models/DatabaseModels/GlobalConfig";
import ProjectCallSMSConfig from "../../Models/DatabaseModels/ProjectCallSMSConfig";

/*
 * THE COLUMNS A TWILIO CONFIG IS READ WITH, TO SEND THROUGH IT.
 *
 * Everything an SMS or a call needs: what the config is used for (calls and
 * SMS, SMS only or calls only - Types/CallAndSMS/TwilioConfigUse), the
 * account and every number it may go out from - the SMS numbers included
 * (Types/CallAndSMS/TwilioPhoneNumbers). A reader that left out the use would
 * read a config used for SMS only as one for calls and SMS, which it cannot
 * be: it has no number to make calls from.
 * A reader that listed the columns by hand and left the SMS numbers out
 * would send SMS from a number set aside for calls, which Twilio refuses
 * when the number cannot send SMS. So every read of a config to send
 * through it - a project's default, a status page's, the one a test send
 * or an incoming call policy names, the OneUptime server's own - selects
 * one of these, and TwilioConfigSelectGuard holds every server file to it.
 */

// A project's Twilio config (ProjectCallSMSConfigService.toTwilioConfig).
export const PROJECT_TWILIO_CONFIG_SELECT: Select<ProjectCallSMSConfig> = {
  _id: true,
  usedFor: true,
  twilioAccountSID: true,
  twilioAuthToken: true,
  twilioPrimaryPhoneNumber: true,
  twilioSecondaryPhoneNumbers: true,
  twilioSmsPhoneNumbers: true,
};

// The OneUptime server's own account (Admin Dashboard > Settings > Call and SMS).
export const GLOBAL_TWILIO_CONFIG_SELECT: Select<GlobalConfig> = {
  twilioUsedFor: true,
  twilioAccountSID: true,
  twilioAuthToken: true,
  twilioPrimaryPhoneNumber: true,
  twilioSecondaryPhoneNumbers: true,
  twilioSmsPhoneNumbers: true,
};

/*
 * What a write's check reads of the configs it changes: what each is used
 * for and the numbers that takes (Types/CallAndSMS/TwilioConfigWrite) - no
 * credential, as the check needs none. ProjectCallSMSConfigService and
 * GlobalConfigService refuse a write that would leave a config without the
 * numbers what it is used for takes.
 */
export const PROJECT_TWILIO_CONFIG_USE_SELECT: Select<ProjectCallSMSConfig> = {
  _id: true,
  usedFor: true,
  twilioPrimaryPhoneNumber: true,
  twilioSmsPhoneNumbers: true,
};

// The server's account is asked for its numbers only once it has an account SID.
export const GLOBAL_TWILIO_CONFIG_USE_SELECT: Select<GlobalConfig> = {
  twilioUsedFor: true,
  twilioAccountSID: true,
  twilioPrimaryPhoneNumber: true,
  twilioSmsPhoneNumbers: true,
};

/*
 * What carries the server's SMS and calls, and the gateway's URL and secret
 * for a server that sends through its own (Types/CallAndSMS/
 * CallAndSmsProvider): read by everything that sends through the server's
 * own account or asks whether it could (CallAndSmsGatewayConfig).
 */
export const GLOBAL_CALL_AND_SMS_GATEWAY_SELECT: Select<GlobalConfig> = {
  callAndSmsProvider: true,
  callAndSmsGatewayUrl: true,
  callAndSmsGatewaySecret: true,
};
