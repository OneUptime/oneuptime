import { FindWhereProperty } from "../../../Types/BaseDatabase/Query";
import Phone from "../../../Types/Phone";
import SubscriberContactKey from "../../../Types/StatusPage/SubscriberContactKey";
import Text from "../../../Types/Text";
import { Raw } from "typeorm";

/*
 * A SUBSCRIBER'S PHONE LINE, IN SQL.
 *
 * A phone number is stored as it was typed, and a status page takes each
 * line once (StatusPageSubscriberService), so the subscribers of a page are
 * looked up by line rather than by what was typed: the stored number's
 * digits, with one leading "00" taken off - SubscriberContactKey.forPhone,
 * which the value looked for is written with, as Postgres writes it. The
 * patterns are Postgres's, run over one stored number at a time.
 */

// The line of the phone number in `column`, as SQL.
export const getPhoneLineSql: (column: string) => string = (
  column: string,
): string => {
  return `regexp_replace(regexp_replace(${column}, '[^0-9]', '', 'g'), '^00', '')`;
};

export default class SubscriberContactSql {
  // A condition on a phone column: a number on the line of `phone`.
  public static onPhoneLine(phone: Phone | string): FindWhereProperty<any> {
    const parameter: string = Text.generateRandomText(10);

    return Raw(
      (alias: string): string => {
        return `(${getPhoneLineSql(alias)} = :${parameter})`;
      },
      {
        [parameter]: SubscriberContactKey.forPhone(phone),
      },
    );
  }
}
