import TwilioConfig from "./TwilioConfig";
import BadDataException from "../Exception/BadDataException";
import Phone from "../Phone";
import { TwilioMessageKind } from "../../Utils/Project/TwilioAccount";
import { refusedValue } from "../../Utils/RefusedValue";

/*
 * WHICH OF A TWILIO CONFIG'S NUMBERS AN SMS OR A CALL GOES OUT FROM.
 *
 * Each Twilio number has capabilities of its own: Twilio sells numbers that
 * make calls and send SMS, numbers that only send SMS and numbers that only
 * make calls. In some countries no one number does both - Twilio lists
 * Singapore's national numbers (+65 3 or 6) as voice-only, and SMS there
 * need a mobile number (+65 8); a customer in Poland needed a local number
 * for calls and a mobile one for SMS (#3020). A config that sent SMS from a
 * number that can only make calls had every SMS refused by Twilio (error
 * 21606).
 *
 * So a config - a project's (ProjectCallSMSConfig) or the OneUptime
 * server's own (GlobalConfig) - can list numbers for SMS:
 *
 *   - calls go out from the primary number, or from a secondary number in
 *     the recipient's country;
 *   - SMS go out from the same numbers while the config lists no SMS
 *     numbers - every config there was before them sends exactly as it did;
 *   - once it lists SMS numbers, every SMS goes out from one of them: the
 *     one in the recipient's country, or else the first. Never from a
 *     number kept for calls, so a voice-only number sends no SMS at all.
 *
 * One list rather than an SMS twin of each call field: one rule to read
 * ("SMS go out from these"), and no SMS falling back to a call number the
 * person did not think to replace. Every sender (the Notification service's
 * SmsService and CallService) picks through pickSenderNumber.
 *
 * Kept free of server and React code: the server, the dashboards and the
 * tests read the same rules.
 */

/*
 * Numbers in a list are separated by commas, as the forms ask - or by
 * semicolons or new lines, as people paste them. One character at a time:
 * linear on any text.
 */
const PHONE_NUMBER_LIST_SEPARATOR: RegExp = /[,;\n]/;

/*
 * What a list of numbers looks like: the example an empty Twilio SMS Phone
 * Numbers field shows, on a project's Twilio config and on the Admin
 * Dashboard's, and the one the error that refuses a list gives. Two numbers
 * in two countries, each from a range kept for fiction - North America's
 * 555-0100 to 555-0199 and the UK's 07700 900000 to 900999 - so a copied
 * example texts nobody. Never one country's numbers: OneUptime is used
 * worldwide, and which numbers can send SMS differs from country to country.
 */
export const PHONE_NUMBER_LIST_EXAMPLE: string = "+14155550123, +447700900123";

/*
 * The field of the Notification service's answer to Send Test SMS and Send
 * Test Call that names the number the test went out from (picked by
 * pickSenderNumber, as a real SMS or call to the same phone would be), so
 * the dialog can say which of a config's numbers sent it.
 */
export const TEST_SEND_FROM_PHONE_NUMBER_FIELD: string = "fromPhoneNumber";

export interface TwilioSenderNumbers {
  // Sends to every recipient no other number of the list is for.
  primaryPhoneNumber: Phone;
  // Each sends to the recipients in its own country.
  secondaryPhoneNumbers: Array<Phone>;
}

export default class TwilioPhoneNumbers {
  /*
   * The entries of a list as they were typed, without the empty ones a
   * trailing or doubled comma leaves.
   */
  public static getListEntries(text: string | null | undefined): Array<string> {
    if (!text || typeof text !== "string") {
      return [];
    }

    return text
      .split(PHONE_NUMBER_LIST_SEPARATOR)
      .map((entry: string): string => {
        return entry.trim();
      })
      .filter((entry: string): boolean => {
        return entry.length > 0;
      });
  }

  // What is said of an entry of a list that is not a phone number.
  public static getListEntryError(entry: string): string {
    return `"${refusedValue(entry)}" is not a phone number. Write each number with its country code and separate them with commas, like ${PHONE_NUMBER_LIST_EXAMPLE}.`;
  }

  /*
   * What is wrong with a list of numbers, or null when every entry in it is
   * a phone number (an empty list included). The forms and the server ask
   * the same question, so a list one accepts the other does.
   */
  public static getListError(text: string | null | undefined): string | null {
    for (const entry of TwilioPhoneNumbers.getListEntries(text)) {
      try {
        new Phone(entry);
      } catch {
        return TwilioPhoneNumbers.getListEntryError(entry);
      }
    }

    return null;
  }

  /*
   * Refuses a list a config is about to store - "Twilio SMS Phone Numbers:
   * "x" is not a phone number. ..." - so a number that could never send is
   * turned away when it is typed, not when an alert goes out. An absent or
   * emptied list passes.
   */
  public static assertListIsValid(data: {
    title: string;
    text: unknown;
  }): void {
    if (data.text === undefined || data.text === null) {
      return;
    }

    if (typeof data.text !== "string") {
      throw new BadDataException(
        `${data.title} must be phone numbers separated by commas.`,
      );
    }

    const error: string | null = TwilioPhoneNumbers.getListError(data.text);

    if (error) {
      throw new BadDataException(`${data.title}: ${error}`);
    }
  }

  /*
   * A list of numbers as a config keeps it ("+441234567890, +461234567890").
   * Throws, naming the entry, for one that is not a phone number.
   */
  public static parseList(text: string | null | undefined): Array<Phone> {
    return TwilioPhoneNumbers.getListEntries(text).map(
      (entry: string): Phone => {
        try {
          return new Phone(entry);
        } catch {
          throw new BadDataException(
            TwilioPhoneNumbers.getListEntryError(entry),
          );
        }
      },
    );
  }

  // Whether a config sends SMS from numbers of their own.
  public static hasSmsNumbers(config: TwilioConfig): boolean {
    return (config.smsPhoneNumbers || []).length > 0;
  }

  /*
   * The numbers a config sends this kind of message from. Calls: the
   * primary and secondary numbers. SMS: the same while the config lists no
   * SMS numbers, and its SMS numbers alone once it does - the first in the
   * primary number's place.
   */
  public static getSenderNumbers(
    config: TwilioConfig,
    kind: TwilioMessageKind,
  ): TwilioSenderNumbers {
    const smsPhoneNumbers: Array<Phone> = config.smsPhoneNumbers || [];
    const firstSmsPhoneNumber: Phone | undefined = smsPhoneNumbers[0];

    if (kind === TwilioMessageKind.SMS && firstSmsPhoneNumber) {
      return {
        primaryPhoneNumber: firstSmsPhoneNumber,
        secondaryPhoneNumbers: smsPhoneNumbers.slice(1),
      };
    }

    return {
      primaryPhoneNumber: config.primaryPhoneNumber,
      secondaryPhoneNumbers: config.secondaryPhoneNumbers || [],
    };
  }

  /*
   * The number this message goes out from: the one of its kind's numbers
   * in the recipient's country, or else its kind's first number.
   */
  public static pickSenderNumber(data: {
    config: TwilioConfig;
    kind: TwilioMessageKind;
    to: Phone | string;
  }): Phone {
    const numbers: TwilioSenderNumbers = TwilioPhoneNumbers.getSenderNumbers(
      data.config,
      data.kind,
    );

    return Phone.pickPhoneNumberToSendSMSOrCallFrom({
      to: data.to,
      primaryPhoneNumberToPickFrom: numbers.primaryPhoneNumber,
      secondaryPhoneNumbersToPickFrom: numbers.secondaryPhoneNumbers,
    });
  }
}
