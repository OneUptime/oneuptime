import SubscriberContactSql, {
  getPhoneLineSql,
} from "../../../../Server/Utils/StatusPage/SubscriberContactSql";
import Phone from "../../../../Types/Phone";
import SubscriberContactKey from "../../../../Types/StatusPage/SubscriberContactKey";
import { rowMatchesWhere } from "../../TestingUtils/InMemoryRepository";
import { describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * A SUBSCRIBER'S PHONE LINE, IN SQL (SubscriberContactSql).
 *
 * A status page's subscribers are looked up by a phone's line, in the
 * database: the stored number's digits, one leading "00" taken off, against
 * the line of the number asked about (SubscriberContactKey.forPhone). These
 * pin the SQL, the value it is bound to, and that the in-memory tables the
 * route suites run on read the condition as Postgres does (the Postgres
 * suite, StatusPageSubscriberContactPostgres.test.ts, runs the SQL itself).
 */

describe("the phone line condition", () => {
  test("is the stored number's digits, one leading 00 taken off, against a bound line", () => {
    expect(getPhoneLineSql('"subscriber"."subscriberPhone"')).toBe(
      `regexp_replace(regexp_replace("subscriber"."subscriberPhone", '[^0-9]', '', 'g'), '^00', '')`,
    );

    const condition: FindOperator<unknown> = SubscriberContactSql.onPhoneLine(
      "+1 (415) 555-0100",
    ) as FindOperator<unknown>;

    const sql: string = condition.getSql!("c");
    const parameters: Record<string, unknown> =
      condition.objectLiteralParameters as Record<string, unknown>;
    const names: Array<string> = Object.keys(parameters);

    expect(names).toHaveLength(1);
    expect(sql).toBe(`(${getPhoneLineSql("c")} = :${names[0]})`);
    // The value is bound, never written into the SQL.
    expect(parameters[names[0]!]).toBe("14155550100");
    expect(sql).not.toContain("4155");
  });

  test("a Phone is bound as its line", () => {
    const condition: FindOperator<unknown> = SubscriberContactSql.onPhoneLine(
      new Phone("0014155550100"),
    ) as FindOperator<unknown>;

    expect(
      Object.values(
        condition.objectLiteralParameters as Record<string, unknown>,
      ),
    ).toEqual(["14155550100"]);
  });

  test("two conditions in one query bind under names of their own", () => {
    const first: FindOperator<unknown> = SubscriberContactSql.onPhoneLine(
      "+14155550100",
    ) as FindOperator<unknown>;
    const second: FindOperator<unknown> = SubscriberContactSql.onPhoneLine(
      "+14155550199",
    ) as FindOperator<unknown>;

    expect(Object.keys(first.objectLiteralParameters!)).not.toEqual(
      Object.keys(second.objectLiteralParameters!),
    );
  });
});

describe("the in-memory tables read it as SubscriberContactKey does", () => {
  const STORED: Array<string> = [
    "+14155550100",
    "14155550100",
    "+141 555 50100",
    "(141)55550100",
    "0014155550100",
    "+14155550101",
    "4155550100",
    "+4414155550100",
  ];

  test.each([
    "+14155550100",
    "141-555-50100",
    "0014155550100",
    "4155550100",
    "+4414155550100",
  ])("asked about %j", (asked: string) => {
    const matched: Array<string> = STORED.filter((stored: string): boolean => {
      return rowMatchesWhere(
        { subscriberPhone: stored },
        { subscriberPhone: SubscriberContactSql.onPhoneLine(asked) },
      );
    });

    expect(matched).toEqual(
      STORED.filter((stored: string): boolean => {
        return SubscriberContactKey.isSamePhone(stored, asked);
      }),
    );
    expect(matched.length).toBeGreaterThan(0);
  });

  test("a row with no phone matches nothing", () => {
    expect(
      rowMatchesWhere(
        { subscriberPhone: null },
        { subscriberPhone: SubscriberContactSql.onPhoneLine("+14155550100") },
      ),
    ).toBe(false);
  });
});
