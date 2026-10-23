import { refusedValue } from "../../Utils/RefusedValue";

/*
 * WHAT A TWILIO CONFIG IS USED FOR: CALLS AND SMS, SMS ONLY, OR CALLS ONLY.
 *
 * A Twilio account can be the one a project - or the OneUptime server -
 * makes its calls and sends its SMS through, or the one it uses for only
 * one of the two. A customer's account sent only SMS, from a mobile number
 * registered for it, yet the config made them type in a number to make
 * calls from; another's number could only make calls. So a config says what
 * it is used for (ProjectCallSMSConfig.usedFor, GlobalConfig.twilioUsedFor)
 * and needs only the numbers that takes:
 *
 *   - Calls and SMS - every config made before the choice was offered:
 *     calls go out from its primary number, and SMS too unless it lists SMS
 *     numbers (TwilioPhoneNumbers);
 *   - SMS only: every SMS goes out from its SMS numbers, which it must
 *     list. It never makes a call;
 *   - Calls only: calls go out from its primary number, which it must have.
 *     It never sends an SMS.
 *
 * What a config is not used for goes as it would without it: when a
 * project's default config is used for SMS only, the project's calls go
 * through the OneUptime server's own Twilio account, exactly as they do for
 * a project with no config at all (the Notification service's senders,
 * TwilioPhoneNumbers.canSend).
 *
 * Kept free of server and React code, and of the other Twilio modules
 * (Utils/Project/TwilioAccount imports this one): the server, the
 * dashboards and the tests read the same rules.
 */
export enum TwilioConfigUse {
  CallsAndSms = "Calls and SMS",
  SmsOnly = "SMS only",
  CallsOnly = "Calls only",
}

// In the order the forms offer them: what most configs are, first.
export const TWILIO_CONFIG_USES: ReadonlyArray<TwilioConfigUse> = [
  TwilioConfigUse.CallsAndSms,
  TwilioConfigUse.SmsOnly,
  TwilioConfigUse.CallsOnly,
];

/*
 * What a config that says nothing is used for: calls and SMS, as every
 * config was before the choice - and what the columns start with.
 */
export const DEFAULT_TWILIO_CONFIG_USE: TwilioConfigUse =
  TwilioConfigUse.CallsAndSms;

/*
 * The titles of the columns a config's use and its numbers are kept in, as
 * the forms and the API reference name them.
 */
export const USED_FOR_TITLE: string = "Used For";
export const PRIMARY_PHONE_NUMBER_TITLE: string = "Twilio Primary Phone Number";
export const SMS_PHONE_NUMBERS_TITLE: string = "Twilio SMS Phone Numbers";

// What a config holds that its use reads.
export interface TwilioConfigNumbersPresent {
  use: unknown;
  // A number calls go out from.
  hasPrimaryPhoneNumber: boolean;
  // At least one number in its list of SMS numbers.
  hasSmsPhoneNumbers: boolean;
}

export default class TwilioConfigUses {
  public static isUse(value: unknown): value is TwilioConfigUse {
    return (
      typeof value === "string" &&
      (TWILIO_CONFIG_USES as ReadonlyArray<string>).includes(value)
    );
  }

  /*
   * What a stored or sent value says a config is used for. Unset - every
   * config made before the choice - is Calls and SMS, and so is a value
   * that is not a use: the writes that store one refuse it
   * (getUseError), so only a row edited by hand can hold one, and it keeps
   * sending as every config did.
   */
  public static getUse(value: unknown): TwilioConfigUse {
    return TwilioConfigUses.isUse(value) ? value : DEFAULT_TWILIO_CONFIG_USE;
  }

  /*
   * A use as a sentence says it: "used for calls and SMS", "used for SMS
   * only", "used for calls only".
   */
  public static getUseInSentence(use: unknown): string {
    switch (TwilioConfigUses.getUse(use)) {
      case TwilioConfigUse.SmsOnly:
        return "SMS only";
      case TwilioConfigUse.CallsOnly:
        return "calls only";
      default:
        return "calls and SMS";
    }
  }

  // Whether a config used for this sends SMS.
  public static sendsSms(use: unknown): boolean {
    return TwilioConfigUses.getUse(use) !== TwilioConfigUse.CallsOnly;
  }

  // Whether a config used for this makes calls.
  public static makesCalls(use: unknown): boolean {
    return TwilioConfigUses.getUse(use) !== TwilioConfigUse.SmsOnly;
  }

  /*
   * What is wrong with a value a write gives for what a config is used
   * for, or null when it is one of the uses - or not given at all: the
   * column then keeps, or starts with, what it holds.
   */
  public static getUseError(value: unknown): string | null {
    if (value === undefined || value === null) {
      return null;
    }

    if (TwilioConfigUses.isUse(value)) {
      return null;
    }

    const choices: string = `${USED_FOR_TITLE} must be "${TwilioConfigUse.CallsAndSms}", "${TwilioConfigUse.SmsOnly}" or "${TwilioConfigUse.CallsOnly}"`;

    // A text is repeated, as far as a refusal repeats one; anything else is not text.
    return typeof value === "string"
      ? `${choices}, not "${refusedValue(value)}".`
      : `${choices}.`;
  }

  /*
   * What a config lacks for what it is used for, or null when it has the
   * numbers that takes: a number to make calls from for Calls and SMS and
   * for Calls only, and SMS numbers for SMS only. The forms ask for the
   * same, and the server refuses a config that could not do what it says
   * (ProjectCallSMSConfigService, GlobalConfigService).
   */
  public static getMissingNumberError(
    config: TwilioConfigNumbersPresent,
  ): string | null {
    const use: TwilioConfigUse = TwilioConfigUses.getUse(config.use);

    if (use === TwilioConfigUse.SmsOnly) {
      return config.hasSmsPhoneNumbers
        ? null
        : `A Twilio config used for ${TwilioConfigUses.getUseInSentence(use)} needs at least one number in ${SMS_PHONE_NUMBERS_TITLE}: every SMS goes out from one of them.`;
    }

    return config.hasPrimaryPhoneNumber
      ? null
      : `A Twilio config used for ${TwilioConfigUses.getUseInSentence(use)} needs a ${PRIMARY_PHONE_NUMBER_TITLE}: calls go out from it.`;
  }
}
