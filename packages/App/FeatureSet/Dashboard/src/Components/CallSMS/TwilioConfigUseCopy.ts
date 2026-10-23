import TwilioConfigUses, {
  TWILIO_CONFIG_USES,
  TwilioConfigUse,
} from "Common/Types/CallAndSMS/TwilioConfigUse";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT A TWILIO CONFIG IS USED FOR, AS ITS FORM ASKS IT: calls and SMS, SMS
 * only, or calls only (Common/Types/CallAndSMS/TwilioConfigUse), on Project
 * Settings > Notifications > Notification Settings > Twilio Config.
 *
 * A customer whose Twilio account sent only SMS was made to type in a
 * number to make calls from, while the number their SMS went out from was
 * an optional field under More fields. So the form asks first what the
 * account is for, then only for the numbers that takes, each required where
 * it is needed and nowhere else:
 *
 *   - Calls and SMS: the primary number calls go out from - SMS too, unless
 *     SMS numbers are added under More fields;
 *   - SMS only: the numbers every SMS goes out from, open and required;
 *     nothing to make calls from;
 *   - Calls only: the primary number calls go out from; nothing for SMS.
 *
 * What an account is not used for goes through OneUptime's own Twilio
 * account, as it would without a config: each answer says so.
 *
 * Kept free of React, so App/Tests can read these exact strings. Every
 * sentence is wrapped in translationKey() so npm run i18n:extract finds it;
 * the form translates them where it draws them.
 */

export interface TwilioConfigUseOption {
  value: TwilioConfigUse;
  title: string;
  description: string;
}

export const TwilioConfigUseCopy: {
  // The question, above its three answers.
  fieldTitle: string;
  // Each answer, and what it means for the messages it does not send.
  callsAndSmsTitle: string;
  callsAndSmsDescription: string;
  smsOnlyTitle: string;
  smsOnlyDescription: string;
  callsOnlyTitle: string;
  callsOnlyDescription: string;
  // The primary number's help on a config used for calls only.
  callsOnlyPrimaryPhoneNumberDescription: string;
  // The SMS numbers' help on a config used for SMS only, where they are required.
  smsOnlyPhoneNumbersDescription: string;
} = {
  fieldTitle: translationKey("Use This Account For"),
  callsAndSmsTitle: translationKey("Calls and SMS"),
  callsAndSmsDescription: translationKey(
    "Calls and SMS go out from this account.",
  ),
  smsOnlyTitle: translationKey("SMS only"),
  smsOnlyDescription: translationKey(
    "Calls go through OneUptime's own Twilio account instead.",
  ),
  callsOnlyTitle: translationKey("Calls only"),
  callsOnlyDescription: translationKey(
    "SMS go through OneUptime's own Twilio account instead.",
  ),
  callsOnlyPrimaryPhoneNumberDescription: translationKey(
    "Calls go out from this number.",
  ),
  smsOnlyPhoneNumbersDescription: translationKey(
    "Every SMS goes out from one of these: the one in the recipient's country, or else the first.",
  ),
};

// The answers, in the order the form offers them: what most configs are, first.
export const getTwilioConfigUseOptions: () => Array<TwilioConfigUseOption> =
  (): Array<TwilioConfigUseOption> => {
    const words: Record<
      TwilioConfigUse,
      { title: string; description: string }
    > = {
      [TwilioConfigUse.CallsAndSms]: {
        title: TwilioConfigUseCopy.callsAndSmsTitle,
        description: TwilioConfigUseCopy.callsAndSmsDescription,
      },
      [TwilioConfigUse.SmsOnly]: {
        title: TwilioConfigUseCopy.smsOnlyTitle,
        description: TwilioConfigUseCopy.smsOnlyDescription,
      },
      [TwilioConfigUse.CallsOnly]: {
        title: TwilioConfigUseCopy.callsOnlyTitle,
        description: TwilioConfigUseCopy.callsOnlyDescription,
      },
    };

    return TWILIO_CONFIG_USES.map(
      (use: TwilioConfigUse): TwilioConfigUseOption => {
        return { value: use, ...words[use] };
      },
    );
  };

/*
 * What a config is used for, in the words of the answer the form offers for
 * it - "SMS only" - as its row in the Twilio Config table says it. A config
 * saved before the choice, or holding a value that is not a use, is used
 * for calls and SMS (TwilioConfigUses.getUse). English: the cell translates
 * it.
 */
export const getTwilioConfigUseTitle: (use: unknown) => string = (
  use: unknown,
): string => {
  const chosen: TwilioConfigUse = TwilioConfigUses.getUse(use);

  const option: TwilioConfigUseOption | undefined =
    getTwilioConfigUseOptions().find(
      (candidate: TwilioConfigUseOption): boolean => {
        return candidate.value === chosen;
      },
    );

  return option ? option.title : TwilioConfigUseCopy.callsAndSmsTitle;
};

/*
 * What a form's values say the config is used for: calls and SMS while
 * nothing is picked, as on a config made before the choice.
 */
export const getFormTwilioConfigUse: (values: {
  usedFor?: unknown;
}) => TwilioConfigUse = (values: { usedFor?: unknown }): TwilioConfigUse => {
  return TwilioConfigUses.getUse(values ? values.usedFor : undefined);
};

/*
 * A form field's showIf: shown while the config is used for one of these.
 * The fields a choice swaps - a number's help, whether it is required or
 * folded - are each shown for one answer alone, so two of them never share
 * the form.
 */
export const isFormUsedFor: (
  ...uses: Array<TwilioConfigUse>
) => (values: { usedFor?: unknown }) => boolean = (
  ...uses: Array<TwilioConfigUse>
): ((values: { usedFor?: unknown }) => boolean) => {
  return (values: { usedFor?: unknown }): boolean => {
    return uses.includes(getFormTwilioConfigUse(values));
  };
};

export default TwilioConfigUseCopy;
