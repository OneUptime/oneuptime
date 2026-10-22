import TwilioConfigUses from "./TwilioConfigUse";
import TwilioPhoneNumbers from "./TwilioPhoneNumbers";

/*
 * WHAT A WRITE OF A TWILIO CONFIG MUST LEAVE IT WITH.
 *
 * A config is used for calls and SMS, SMS only or calls only
 * (TwilioConfigUse), and must hold the numbers that takes: a number to make
 * calls from unless it is used for SMS only, and SMS numbers when it is. The
 * forms ask for exactly those, and the server refuses a write that would
 * leave a config unable to do what it says - a project's
 * (ProjectCallSMSConfigService) and the OneUptime server's own
 * (GlobalConfigService), each mapping its columns to these three values.
 *
 * A create is held to the rule as it is. An update only when it changes
 * what the config is used for, its number or its SMS numbers: a write that
 * changes none of them - a rename, making a config the default, an API or
 * Terraform write that sends every field back as it was - goes through as it
 * always did, whatever a row made before the rule holds.
 *
 * Kept free of server and React code, like the rules it reads.
 */

// A config's use and numbers, as its columns, or a write's data, hold them.
export interface TwilioUseAndNumbers {
  use?: unknown;
  primaryPhoneNumber?: unknown;
  smsPhoneNumbers?: unknown;
}

export type TwilioUseAndNumbersKey = keyof TwilioUseAndNumbers;

export const TWILIO_USE_AND_NUMBERS_KEYS: ReadonlyArray<TwilioUseAndNumbersKey> =
  ["use", "primaryPhoneNumber", "smsPhoneNumbers"];

export default class TwilioConfigWrite {
  // Whether a value is a number to make calls from: a Phone, or its text.
  public static hasPrimaryPhoneNumber(value: unknown): boolean {
    return Boolean(value && String(value).trim());
  }

  // Whether a list of numbers, as a config keeps it, holds at least one.
  public static hasSmsPhoneNumbers(value: unknown): boolean {
    return (
      typeof value === "string" &&
      TwilioPhoneNumbers.getListEntries(value).length > 0
    );
  }

  // What a config lacks for what it is used for, or null (TwilioConfigUse).
  public static getMissingNumberError(
    config: TwilioUseAndNumbers,
  ): string | null {
    return TwilioConfigUses.getMissingNumberError({
      use: config.use,
      hasPrimaryPhoneNumber: TwilioConfigWrite.hasPrimaryPhoneNumber(
        config.primaryPhoneNumber,
      ),
      hasSmsPhoneNumbers: TwilioConfigWrite.hasSmsPhoneNumbers(
        config.smsPhoneNumbers,
      ),
    });
  }

  // The values a write gives, of the three: the ones it leaves out are not there.
  public static getWrittenKeys(
    written: TwilioUseAndNumbers,
  ): Array<TwilioUseAndNumbersKey> {
    return TWILIO_USE_AND_NUMBERS_KEYS.filter(
      (key: TwilioUseAndNumbersKey): boolean => {
        return written[key] !== undefined;
      },
    );
  }

  /*
   * A value as it compares: a use (unset is calls and SMS), a number's
   * text, a list's numbers - so a write that sends a value back as it was
   * stored changes nothing.
   */
  public static getComparableValue(
    key: TwilioUseAndNumbersKey,
    value: unknown,
  ): string {
    if (key === "use") {
      return TwilioConfigUses.getUse(value);
    }

    if (key === "smsPhoneNumbers") {
      return typeof value === "string"
        ? TwilioPhoneNumbers.getListEntries(value).join(",")
        : "";
    }

    return value ? String(value).trim() : "";
  }

  // The config as a write leaves it: what it writes over what is stored.
  public static getConfigAsWritten(data: {
    stored: TwilioUseAndNumbers;
    written: TwilioUseAndNumbers;
  }): TwilioUseAndNumbers {
    const config: TwilioUseAndNumbers = { ...data.stored };

    for (const key of TwilioConfigWrite.getWrittenKeys(data.written)) {
      config[key] = data.written[key];
    }

    return config;
  }

  /*
   * What is wrong with an update of a stored config, or null: only an
   * update that changes what the config is used for, its number or its SMS
   * numbers is held to the rule, by the config as it leaves it.
   */
  public static getUpdateError(data: {
    stored: TwilioUseAndNumbers;
    written: TwilioUseAndNumbers;
  }): string | null {
    const changes: boolean = TwilioConfigWrite.getWrittenKeys(
      data.written,
    ).some((key: TwilioUseAndNumbersKey): boolean => {
      return (
        TwilioConfigWrite.getComparableValue(key, data.written[key]) !==
        TwilioConfigWrite.getComparableValue(key, data.stored[key])
      );
    });

    if (!changes) {
      return null;
    }

    return TwilioConfigWrite.getMissingNumberError(
      TwilioConfigWrite.getConfigAsWritten(data),
    );
  }
}
