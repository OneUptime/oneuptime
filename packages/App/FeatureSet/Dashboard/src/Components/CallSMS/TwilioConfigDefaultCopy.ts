import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import TwilioConfigUses, {
  TwilioConfigUse,
} from "Common/Types/CallAndSMS/TwilioConfigUse";
import TwilioConfigDefaults, {
  TwilioConfigDefaultColumn,
} from "Common/Types/CallAndSMS/TwilioConfigDefaults";
import { TwilioMessageKind } from "Common/Utils/Project/TwilioAccount";

/*
 * Which Twilio config the SMS and calls to a project's members go through, on
 * Project Settings -> Notifications -> Notification Settings -> Twilio Config.
 *
 * SMS and calls to the people in a project (on-call alerts, notifications,
 * verification codes) go through the project's default Twilio config for
 * them, and through OneUptime's own Twilio account when it has none:
 * UserSmsService, UserCallService, UserIncomingCallNumberService,
 * UserNotificationRuleService and UserNotificationSettingService all ask
 * ProjectCallSMSConfigService.getProjectDefaultTwilioConfig for the kind of
 * message they send. Status pages and incoming call policies use the config
 * picked on them instead.
 *
 * A project has a default for SMS and a default for calls, and a config is
 * the default for what it is used for (Common/Types/CallAndSMS/
 * TwilioConfigDefaults has the rule). So a config for SMS only and one for
 * calls only are the project default together, each for its own messages -
 * where no one number does both, a project keeps one of each (#6574). A
 * config for calls and SMS takes both. The table says it the same way:
 *
 *   - the Project Default column: "Default", or "Default for SMS" / "Default
 *     for calls" for a config that is the default for one of the two;
 *   - the row's ⋯ menu: "Set as Project Default" on a config that is the
 *     default for nothing it sends, "... for SMS" or "... for Calls" on one
 *     that would take only that, and "Stop Using as Project Default" on a
 *     default, which asks first, naming what stops going through it;
 *   - the card: when a config could send SMS, or calls, that no config is
 *     the default for, it says so, and how to change that.
 *
 * A project's first config becomes its default: the server makes it so
 * when the create leaves the choice out (ProjectCallSMSConfigService), and
 * the create form starts the switch on for it and says why. A later config
 * starts with the switch off, so adding one never moves the project's SMS
 * and calls by itself. Only the create form has the switch: an Edit form
 * would send it back as it read it, and a config that is the default for
 * calls alone would take the SMS too on every save. After that, the row's
 * menu is where a config becomes the default, or stops being one.
 *
 * Kept free of React, so App/Tests can read these exact strings. Every
 * sentence is wrapped in translationKey() so npm run i18n:extract finds it;
 * the table and its form translate them where they draw them ({{config}}:
 * a config's name).
 */

export enum TwilioConfigDefaultState {
  // Not read yet, or the read failed: nothing is claimed.
  Unknown = "Unknown",
  // The project has no Twilio config, so the next one is its first.
  NoConfigs = "NoConfigs",
  /*
   * What its configs send has a project default among them: the SMS, the
   * calls, or both.
   */
  HasDefault = "HasDefault",
  // The project has configs, but none of them is its default.
  NoDefault = "NoDefault",
  /*
   * A default for calls, but none for SMS, though a config could send them:
   * the SMS go through OneUptime's account.
   */
  NoSmsDefault = "NoSmsDefault",
  // And the other way around: a default for SMS, none for calls.
  NoCallsDefault = "NoCallsDefault",
}

/*
 * One of the project's configs, as the card and the row read it: what it
 * is used for, and what it is the project default for. Flags are read as
 * stored: anything but true is false.
 */
export type TwilioConfigDefaultRow = {
  usedFor?: unknown;
  isProjectDefault?: unknown;
} & Partial<Record<TwilioConfigDefaultColumn, unknown>>;

/*
 * What the card says, from every config of the project: which of the
 * messages its configs send no config is the default for.
 */
export const getTwilioConfigDefaultState: (
  configs: ReadonlyArray<TwilioConfigDefaultRow>,
) => TwilioConfigDefaultState = (
  configs: ReadonlyArray<TwilioConfigDefaultRow>,
): TwilioConfigDefaultState => {
  if (configs.length <= 0) {
    return TwilioConfigDefaultState.NoConfigs;
  }

  const hasDefaultFor: (kind: TwilioMessageKind) => boolean = (
    kind: TwilioMessageKind,
  ): boolean => {
    return configs.some((config: TwilioConfigDefaultRow): boolean => {
      return TwilioConfigDefaults.isDefaultFor(config, kind);
    });
  };

  // Whether a config could send it: else no default for it is missing.
  const isSentBySome: (kind: TwilioMessageKind) => boolean = (
    kind: TwilioMessageKind,
  ): boolean => {
    return configs.some((config: TwilioConfigDefaultRow): boolean => {
      return TwilioConfigDefaults.isUsedFor(config.usedFor, kind);
    });
  };

  const hasSmsDefault: boolean = hasDefaultFor(TwilioMessageKind.SMS);
  const hasCallsDefault: boolean = hasDefaultFor(TwilioMessageKind.Call);

  if (!hasSmsDefault && !hasCallsDefault) {
    return TwilioConfigDefaultState.NoDefault;
  }

  if (!hasSmsDefault && isSentBySome(TwilioMessageKind.SMS)) {
    return TwilioConfigDefaultState.NoSmsDefault;
  }

  if (!hasCallsDefault && isSentBySome(TwilioMessageKind.Call)) {
    return TwilioConfigDefaultState.NoCallsDefault;
  }

  return TwilioConfigDefaultState.HasDefault;
};

export const TwilioConfigDefaultCopy: {
  // What the card is for, once the project has a default or before it is known.
  cardDescription: string;
  // While the project has no Twilio config yet.
  firstConfigCardDescription: string;
  // When the project has configs, but none of them is the default.
  noDefaultCardDescription: string;
  // When a config could send SMS, but none is the default for them.
  noSmsDefaultCardDescription: string;
  // When a config could make calls, but none is the default for them.
  noCallsDefaultCardDescription: string;
  /*
   * The switch on the create form, and the row action of a config that is
   * the default for nothing it sends.
   */
  setDefaultTitle: string;
  // The row action of a config that would take only the SMS, or the calls.
  setSmsDefaultTitle: string;
  setCallsDefaultTitle: string;
  // The Project Default column: the default for both, or for one.
  defaultPillText: string;
  smsDefaultPillText: string;
  callsDefaultPillText: string;
  // The row action of a default, and the question it asks first.
  stopDefaultTitle: string;
  stopDefaultConfirmTitle: string;
  stopDefaultConfirmDescription: string;
  stopSmsDefaultConfirmDescription: string;
  stopCallsDefaultConfirmDescription: string;
  stopDefaultConfirmButton: string;
  // The switch's help.
  defaultSwitchDescription: string;
  // The switch's help on the create form of the project's first config.
  firstConfigSwitchDescription: string;
  // The same two, for a config used for SMS only.
  smsOnlyDefaultSwitchDescription: string;
  smsOnlyFirstConfigSwitchDescription: string;
  // And for a config used for calls only.
  callsOnlyDefaultSwitchDescription: string;
  callsOnlyFirstConfigSwitchDescription: string;
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
  noSmsDefaultCardDescription: translationKey(
    "None of these configs is the project default for SMS, so the SMS to people in this project do not go through them. To send them through one, use Set as Project Default on its row.",
  ),
  noCallsDefaultCardDescription: translationKey(
    "None of these configs is the project default for calls, so the calls to people in this project do not go through them. To send them through one, use Set as Project Default on its row.",
  ),
  setDefaultTitle: translationKey("Set as Project Default"),
  setSmsDefaultTitle: translationKey("Set as Project Default for SMS"),
  setCallsDefaultTitle: translationKey("Set as Project Default for Calls"),
  defaultPillText: translationKey("Default"),
  smsDefaultPillText: translationKey("Default for SMS"),
  callsDefaultPillText: translationKey("Default for calls"),
  stopDefaultTitle: translationKey("Stop Using as Project Default"),
  stopDefaultConfirmTitle: translationKey(
    "Stop using {{config}} as the project default?",
  ),
  stopDefaultConfirmDescription: translationKey(
    "The SMS and calls to people in this project, such as on-call alerts, will no longer go through this config.",
  ),
  stopSmsDefaultConfirmDescription: translationKey(
    "The SMS to people in this project, such as on-call alerts, will no longer go through this config.",
  ),
  stopCallsDefaultConfirmDescription: translationKey(
    "The calls to people in this project, such as on-call alerts, will no longer go through this config.",
  ),
  stopDefaultConfirmButton: translationKey("Stop Using as Default"),
  /*
   * Two short sentences: what goes through the config, and what does not.
   * It sits in the Twilio step above the More fields line, and the
   * paragraph it replaced ran to five lines - eight in German.
   */
  defaultSwitchDescription: translationKey(
    "The SMS and calls to people in this project, such as on-call alerts, will go through this config. Status pages use the config picked on each page.",
  ),
  firstConfigSwitchDescription: translationKey(
    "This is the project's first Twilio config, so it starts as the project default: the SMS and calls to people in this project, such as on-call alerts and verification codes, will go through it. Turn this off if this account is only for status pages or incoming calls.",
  ),
  /*
   * A config for SMS only takes the SMS alone: the calls stay with the
   * config that is their default, as a config for calls only leaves the
   * SMS with theirs.
   */
  smsOnlyDefaultSwitchDescription: translationKey(
    "The SMS to people in this project, such as on-call alerts, will go through this config. Calls keep the project default they have.",
  ),
  smsOnlyFirstConfigSwitchDescription: translationKey(
    "This is the project's first Twilio config, so it starts as the project default: the SMS to people in this project, such as on-call alerts and verification codes, will go through it. Turn this off if this account is only for status pages.",
  ),
  callsOnlyDefaultSwitchDescription: translationKey(
    "The calls to people in this project, such as on-call alerts, will go through this config. SMS keep the project default they have.",
  ),
  callsOnlyFirstConfigSwitchDescription: translationKey(
    "This is the project's first Twilio config, so it starts as the project default: the calls to people in this project, such as on-call alerts and verification codes, will go through it. Turn this off if this account is only for incoming calls.",
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
    case TwilioConfigDefaultState.NoSmsDefault:
      return TwilioConfigDefaultCopy.noSmsDefaultCardDescription;
    case TwilioConfigDefaultState.NoCallsDefault:
      return TwilioConfigDefaultCopy.noCallsDefaultCardDescription;
    default:
      return TwilioConfigDefaultCopy.cardDescription;
  }
};

/*
 * The Project Default column's pill: "Default" for the default for SMS and
 * calls, "Default for SMS" or "Default for calls" for the default for one -
 * what a config for SMS only, or for calls only, is when it is the default -
 * and nothing for a config that is no default.
 */
export const getProjectDefaultPillText: (
  config: TwilioConfigDefaultRow,
) => string | undefined = (
  config: TwilioConfigDefaultRow,
): string | undefined => {
  const kinds: Array<TwilioMessageKind> =
    TwilioConfigDefaults.getDefaultKinds(config);

  if (kinds.length > 1) {
    return TwilioConfigDefaultCopy.defaultPillText;
  }

  if (kinds[0] === TwilioMessageKind.SMS) {
    return TwilioConfigDefaultCopy.smsDefaultPillText;
  }

  if (kinds[0] === TwilioMessageKind.Call) {
    return TwilioConfigDefaultCopy.callsDefaultPillText;
  }

  return undefined;
};

/*
 * Which "Set as Project Default" the row's menu offers: the one that names
 * what the config would take. Writing it makes the config the default for
 * everything it is used for, so a config for SMS only takes the SMS, and a
 * config for calls and SMS that is the default for calls already takes the
 * SMS. A config that is the default for everything it sends has none.
 */
export const getSetDefaultTitle: (
  config: TwilioConfigDefaultRow,
) => string | undefined = (
  config: TwilioConfigDefaultRow,
): string | undefined => {
  const kinds: Array<TwilioMessageKind> = TwilioConfigDefaults.getKindsToTake({
    ...config,
    use: config.usedFor,
  });

  if (kinds.length > 1) {
    return TwilioConfigDefaultCopy.setDefaultTitle;
  }

  if (kinds[0] === TwilioMessageKind.SMS) {
    return TwilioConfigDefaultCopy.setSmsDefaultTitle;
  }

  if (kinds[0] === TwilioMessageKind.Call) {
    return TwilioConfigDefaultCopy.setCallsDefaultTitle;
  }

  return undefined;
};

/*
 * What Stop Using as Project Default says stops going through the config:
 * what it is the default for.
 */
export const getStopDefaultConfirmDescription: (
  config: TwilioConfigDefaultRow,
) => string = (config: TwilioConfigDefaultRow): string => {
  const kinds: Array<TwilioMessageKind> =
    TwilioConfigDefaults.getDefaultKinds(config);

  if (kinds.length === 1 && kinds[0] === TwilioMessageKind.SMS) {
    return TwilioConfigDefaultCopy.stopSmsDefaultConfirmDescription;
  }

  if (kinds.length === 1 && kinds[0] === TwilioMessageKind.Call) {
    return TwilioConfigDefaultCopy.stopCallsDefaultConfirmDescription;
  }

  return TwilioConfigDefaultCopy.stopDefaultConfirmDescription;
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
 * The switch's help, for what the config is used for: the SMS and calls of
 * the project's people go through the default, or only its SMS, or only
 * its calls. Only the create form of the project's first config says it
 * starts on, and why. The switch is on the create form alone.
 */
export const getDefaultSwitchDescription: (
  state: TwilioConfigDefaultState,
  use?: TwilioConfigUse | undefined,
) => string = (
  state: TwilioConfigDefaultState,
  use?: TwilioConfigUse | undefined,
): string => {
  const isFirst: boolean = isDefaultSwitchOnWhenCreating(state);

  switch (TwilioConfigUses.getUse(use)) {
    case TwilioConfigUse.SmsOnly:
      return isFirst
        ? TwilioConfigDefaultCopy.smsOnlyFirstConfigSwitchDescription
        : TwilioConfigDefaultCopy.smsOnlyDefaultSwitchDescription;
    case TwilioConfigUse.CallsOnly:
      return isFirst
        ? TwilioConfigDefaultCopy.callsOnlyFirstConfigSwitchDescription
        : TwilioConfigDefaultCopy.callsOnlyDefaultSwitchDescription;
    default:
      return isFirst
        ? TwilioConfigDefaultCopy.firstConfigSwitchDescription
        : TwilioConfigDefaultCopy.defaultSwitchDescription;
  }
};

export default TwilioConfigDefaultCopy;
