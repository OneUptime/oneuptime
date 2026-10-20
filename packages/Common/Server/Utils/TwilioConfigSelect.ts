import Select from "../Types/Database/Select";
import GlobalConfig from "../../Models/DatabaseModels/GlobalConfig";
import ProjectCallSMSConfig from "../../Models/DatabaseModels/ProjectCallSMSConfig";

/*
 * THE COLUMNS A TWILIO CONFIG IS READ WITH, TO SEND THROUGH IT.
 *
 * Everything an SMS or a call needs: the account and every number it may go
 * out from - the SMS numbers included (Types/CallAndSMS/TwilioPhoneNumbers).
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
  twilioAccountSID: true,
  twilioAuthToken: true,
  twilioPrimaryPhoneNumber: true,
  twilioSecondaryPhoneNumbers: true,
  twilioSmsPhoneNumbers: true,
};

// The OneUptime server's own account (Admin Dashboard > Settings > Call and SMS).
export const GLOBAL_TWILIO_CONFIG_SELECT: Select<GlobalConfig> = {
  twilioAccountSID: true,
  twilioAuthToken: true,
  twilioPrimaryPhoneNumber: true,
  twilioSecondaryPhoneNumbers: true,
  twilioSmsPhoneNumbers: true,
};
