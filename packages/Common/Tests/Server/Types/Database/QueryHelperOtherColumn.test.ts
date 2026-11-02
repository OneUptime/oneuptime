import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { FindOperator } from "typeorm";
import { describe, expect, test } from "@jest/globals";

/*
 * QueryHelper.greaterThanOtherColumnTimes: a column above another column of
 * the same row times a factor - the Hosts list's "15-minute load above twice
 * the cores" (HostService.getHostNeedsAttentionConditions). Its contract is
 * the SQL it renders, so the tests read the Raw operator's generator and its
 * bound parameters: the factor is bound, never written into the SQL, and the
 * other column is named the way TypeORM names the row's own on each kind of
 * builder (HostNeedsAttentionPostgres runs it on Postgres).
 */

interface RawOperator {
  type: string;
  objectLiteralParameters: Record<string, unknown>;
  getSql: (aliasPath: string) => string;
}

function asRaw(operator: unknown): RawOperator {
  return operator as RawOperator;
}

function soleParamName(operator: RawOperator): string {
  const keys: Array<string> = Object.keys(operator.objectLiteralParameters);
  expect(keys).toHaveLength(1);
  return keys[0]!;
}

describe("QueryHelper.greaterThanOtherColumnTimes", () => {
  test("a SELECT builder's Alias.property names the other column beside it", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.greaterThanOtherColumnTimes({
        columnName: "cpuCores",
        factor: 2,
      }),
    );

    expect(operator).toBeInstanceOf(FindOperator);
    expect(operator.type).toBe("raw");

    const param: string = soleParamName(operator);
    expect(operator.getSql("Host.latestLoadAverage15m")).toBe(
      `(Host.latestLoadAverage15m > :${param} * "Host"."cpuCores")`,
    );
    expect(operator.objectLiteralParameters[param]).toBe(2);
  });

  test("an UPDATE or DELETE builder's bare property names the bare column", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.greaterThanOtherColumnTimes({
        columnName: "cpuCores",
        factor: 2,
      }),
    );
    const param: string = soleParamName(operator);
    expect(operator.getSql("latestLoadAverage15m")).toBe(
      `(latestLoadAverage15m > :${param} * "cpuCores")`,
    );
  });

  test("the factor is bound, never written into the SQL", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.greaterThanOtherColumnTimes({
        columnName: "cpuCores",
        factor: 1.75,
      }),
    );
    expect(operator.getSql("Host.latestLoadAverage15m")).not.toContain("1.75");
  });

  test("two of them in one query bind two parameters", () => {
    const first: RawOperator = asRaw(
      QueryHelper.greaterThanOtherColumnTimes({ columnName: "a", factor: 1 }),
    );
    const second: RawOperator = asRaw(
      QueryHelper.greaterThanOtherColumnTimes({ columnName: "a", factor: 1 }),
    );
    expect(soleParamName(first)).not.toBe(soleParamName(second));
  });

  test("a column name with a quote in it stays one identifier", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.greaterThanOtherColumnTimes({
        columnName: 'cores"; DROP TABLE "Host',
        factor: 2,
      }),
    );
    const param: string = soleParamName(operator);
    expect(operator.getSql("Host.load")).toBe(
      `(Host.load > :${param} * "Host"."cores""; DROP TABLE ""Host")`,
    );
  });

  test("a factor that is not a finite number is refused", () => {
    for (const factor of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => {
        QueryHelper.greaterThanOtherColumnTimes({
          columnName: "cpuCores",
          factor: factor,
        });
      }).toThrow(BadDataException);
    }
  });
});
