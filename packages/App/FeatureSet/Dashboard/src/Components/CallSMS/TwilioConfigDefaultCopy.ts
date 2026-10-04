import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Which Twilio config the SMS and calls to a project's members go through,
 * on Project Settings -> Notification Settings -> Twilio Config.
 *
 * SMS and calls to the people in a project (on-call alerts, notifications,
 * verification codes) go through the project's default Twilio config, the
 * one whose isProjectDefault is on, and through OneUptime's own Twilio
 * account when it has none: UserSmsService, UserCallService,
 * UserIncomingCallNumberService, UserNotificationRuleService and
 * UserNotificationSettingService all ask
 * ProjectCallSMSConfigService.getProjectDefaultTwilioConfig. Status pages
 * and incoming call policies use the config picked on them instead.
 *
 * A project's first config becomes its default: the server makes it so
 * when the create leaves the choice out (ProjectCallSMSConfigService), and
 * the create form starts the switch on for it and says why. A later config
 * starts with the switch off, so adding one never moves the project's SMS
 * and calls by itself; making it the default is one click on its row.
 *
 * Kept free of React, so App/Tests can read these exact strings. Every
 * sentence is wrapped in translationKey() so npm run i18n:extract finds it;
 * the table and its form translate them where they draw them.
 */

export enum TwilioConfigDefaultState {
  // Not read yet, or the read failed: nothing is claimed.
  Unknown = "Unknown",
  // The project has no Twilio config, so the next one is its first.
  NoConfigs = "NoConfigs",
  // One of the project's configs is its default.
  HasDefault = "HasDefault",
  // The project has configs, but none of them is its default.
  NoDefault = "NoDefault",
}

export interface TwilioConfigCounts {
  // Every Twilio config the project has.
  configCount: number;
  // How many of them are the project default: one, or none.
  defaultCount: number;
}

export const getTwilioConfigDefaultState: (
  counts: TwilioConfigCounts,
) => TwilioConfigDefaultState = (
  counts: TwilioConfigCounts,
): TwilioConfigDefaultState => {
  if (counts.configCount <= 0) {
    return TwilioConfigDefaultState.NoConfigs;
  }

  if (counts.defaultCount > 0) {
    return TwilioConfigDefaultState.HasDefault;
  }

  return TwilioConfigDefaultState.NoDefault;
};

export const TwilioConfigDefaultCopy: {
  // What the card is for, once the project has a default or before it is known.
  cardDescription: string;
  // While the project has no Twilio config yet.
  firstConfigCardDescription: string;
  // When the project has configs, but none of them is the default.
  noDefaultCardDescription: string;
  // The switch on the create and edit forms, and the row action.
  setDefaultTitle: string;
  // The switch's help.
  defaultSwitchDescription: string;
  // The switch's help on the create form of the project's first config.
  firstConfigSwitchDescription: string;
} = {
  cardDescription: translationKey(
    "Use your own Twilio account for SMS and calls. The project default sends the SMS and calls to people in this project.",
  ),
  firstConfigCardDescription: translationKey(
    "Use your own Twilio account for SMS and calls. The first config you add becomes the project default, which sends the SMS and calls to people in this project.",
  ),
  noDefaultCardDescription: translationKey(
    "None of these configs is the project default, so the SMS and calls to people in this project do not go through them. To send them through one, use Set as Project Default on its row.",
  ),
  setDefaultTitle: translationKey("Set as Project Default"),
  defaultSwitchDescription: translationKey(
    "When enabled, all SMS and Calls sent to project team members (on-call notifications, alerts, phone verification, etc.) will use this Twilio config instead of the global config. Only one Twilio config per project can be the project default. Status pages are unaffected — they continue to use the config explicitly assigned to each status page.",
  ),
  firstConfigSwitchDescription: translationKey(
    "This is the project's first Twilio config, so it starts as the project default: the SMS and calls to people in this project, such as on-call alerts and verification codes, will go through it. Turn this off if this account is only for status pages or incoming calls.",
  ),
};

// What the Twilio Config card says, for what the project has.
export const getTwilioConfigCardDescription: (
  state: TwilioConfigDefaultState,
) => string = (state: TwilioConfigDefaultState): string => {
  switch (state) {
    case TwilioConfigDefaultState.NoConfigs:
      return TwilioConfigDefaultCopy.firstConfigCardDescription;
    case TwilioConfigDefaultState.NoDefault:
      return TwilioConfigDefaultCopy.noDefaultCardDescription;
    default:
      return TwilioConfigDefaultCopy.cardDescription;
  }
};

/*
 * Whether the create form starts the switch on: for the project's first
 * config, which the server makes the default too when the switch is left
 * out. Any other config starts where the column does, off - and so does
 * the form while the project's configs are not known yet, claiming nothing.
 */
export const isDefaultSwitchOnWhenCreating: (
  state: TwilioConfigDefaultState,
) => boolean = (state: TwilioConfigDefaultState): boolean => {
  return state === TwilioConfigDefaultState.NoConfigs;
};

/*
 * The switch's help. Only the create form of the project's first config
 * says it starts on, and why. A project with no config has no row to edit,
 * so an edit form never shows that sentence.
 */
export const getDefaultSwitchDescription: (
  state: TwilioConfigDefaultState,
) => string = (state: TwilioConfigDefaultState): string => {
  return isDefaultSwitchOnWhenCreating(state)
    ? TwilioConfigDefaultCopy.firstConfigSwitchDescription
    : TwilioConfigDefaultCopy.defaultSwitchDescription;
};

export default TwilioConfigDefaultCopy;
