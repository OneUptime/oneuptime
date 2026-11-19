import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import TwilioConfigUses, {
  TWILIO_CONFIG_USES,
  TwilioConfigUse,
} from "Common/Types/CallAndSMS/TwilioConfigUse";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * THE TWILIO CONFIGS AN INCOMING CALL POLICY CAN RUN ON (#8885).
 *
 * A project's Twilio config is used for calls and SMS, SMS only or calls
 * only (Common/Types/CallAndSMS/TwilioConfigUse). The policy's Twilio
 * Configuration picker listed every config, one used for SMS only among
 * them: a policy was set up on an account the project said was not for
 * calls, and nothing said so. Now it lists only the configs that make calls,
 * as a status page's picker lists only the ones that send SMS
 * (SubscriberSettings):
 *
 *   - the picker asks the server for the configs used for calls and SMS, or
 *     calls only, and says that the rest are not listed;
 *   - a project whose configs are all used for SMS only is told so when it
 *     opens the picker, with what to change, rather than that it has none;
 *   - a policy that already runs on a config used for SMS only - the config
 *     was made SMS only after it was picked - keeps it, and its card says so,
 *     with what to change, as a status page's card does for a config later
 *     used for calls only. Calls to the policy's numbers still ring: the
 *     account takes them.
 *
 * Kept free of React, so App/Tests can read these exact strings and the
 * query. Every sentence is wrapped in translationKey() so npm run
 * i18n:extract finds it; the page translates them where it draws them.
 */

// The uses a config the picker lists has: the ones that make calls.
export const INCOMING_CALL_TWILIO_CONFIG_USES: ReadonlyArray<TwilioConfigUse> =
  TWILIO_CONFIG_USES.filter((use: TwilioConfigUse): boolean => {
    return TwilioConfigUses.makesCalls(use);
  });

/*
 * The configs the picker lists, and counts before it opens: those used for
 * calls. Every config has a use - the column is never empty, and a config
 * made before the choice is used for calls and SMS - so none is left out
 * that makes calls.
 */
export const getIncomingCallTwilioConfigQuery: () => Query<ProjectCallSMSConfig> =
  (): Query<ProjectCallSMSConfig> => {
    return {
      usedFor: new Includes([...INCOMING_CALL_TWILIO_CONFIG_USES]),
    };
  };

// Whether a policy's config takes calls: one used for SMS only does not.
export const isIncomingCallTwilioConfig: (usedFor: unknown) => boolean = (
  usedFor: unknown,
): boolean => {
  return TwilioConfigUses.makesCalls(usedFor);
};

export const IncomingCallTwilioConfigCopy: {
  // Under the picker: what it leaves out.
  pickerDescription: string;
  // Under a policy's config that is used for SMS only.
  smsOnlyNote: string;
  // The dialog when the project has configs, but none used for calls.
  noCallConfigTitle: string;
  noCallConfigMessage: string;
} = {
  pickerDescription: translationKey(
    "Configs used for SMS only are not listed: they take no calls.",
  ),
  smsOnlyNote: translationKey(
    "This config is used for SMS only. Set it to Calls and SMS, or Calls only, in Project Settings.",
  ),
  noCallConfigTitle: translationKey("No Twilio Configuration for Calls"),
  noCallConfigMessage: translationKey(
    "Your Twilio configurations are all used for SMS only. Set one to Calls and SMS, or Calls only, or add one under Project Settings > Notifications > Notification Channels.",
  ),
};
