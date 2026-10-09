import { FindOperator } from "typeorm";

/*
 * The conditions a query names a record's id with, answered the way
 * Postgres answers them - for a suite that stubs a service's findBy over
 * rows it keeps.
 *
 * Update checks read the rows an update writes, and hold the update to
 * them, by id (DatabaseService.findRowsAndHoldUpdateToThem): a plain id for
 * one row, "any of" (QueryHelper.any) for several, and a condition that
 * matches nothing (QueryHelper.any([])) for none. A suite's own query
 * conditions are answered too: "none of" (QueryHelper.notIn) and "not"
 * (QueryHelper.notEquals).
 */

interface RawCondition {
  sql: string;
  values: Array<string>;
}

// The SQL shapes QueryHelper writes a condition in.
const MATCHES_NOTHING: RegExp = /TRUE\s*=\s*FALSE/i;
const NONE_OF: RegExp = /NOT\s+IN/i;
const ANY_OF: RegExp = /\sIN\s/i;
const IS: RegExp = /[^!<>]=\s*:/;

function asRawCondition(condition: unknown): RawCondition | null {
  if (!(condition instanceof FindOperator)) {
    return null;
  }

  const operator: FindOperator<unknown> = condition as FindOperator<unknown>;
  const sqlFor: unknown = operator.getSql;

  return {
    sql: typeof sqlFor === "function" ? String(sqlFor("column")) : "",
    values: Object.values(operator.objectLiteralParameters || {})
      .flat()
      .map((value: unknown): string => {
        return String(value);
      }),
  };
}

// Whether `value` meets `condition`.
export function meetsCondition(condition: unknown, value: unknown): boolean {
  const raw: RawCondition | null = asRawCondition(condition);

  if (!raw) {
    return (
      String(value).toLowerCase() === String(condition).toLowerCase() ||
      (condition === undefined && value === undefined)
    );
  }

  const given: string = String(value).toLowerCase();
  const named: Array<string> = raw.values.map((each: string): string => {
    return each.toLowerCase();
  });

  if (MATCHES_NOTHING.test(raw.sql)) {
    return false;
  }

  if (NONE_OF.test(raw.sql) || raw.sql.includes("!=")) {
    return !named.includes(given);
  }

  if (ANY_OF.test(raw.sql)) {
    return named.includes(given);
  }

  // "is" (QueryHelper.equalTo).
  if (IS.test(raw.sql)) {
    return named.includes(given);
  }

  throw new Error(`A condition this helper cannot answer: ${raw.sql}`);
}

/*
 * The ids an "is" or "any of" condition names: none for one that matches
 * nothing.
 */
export function idsNamedBy(condition: unknown): Array<string> {
  const raw: RawCondition | null = asRawCondition(condition);

  if (!raw) {
    return condition === undefined || condition === null
      ? []
      : [String(condition)];
  }

  if (MATCHES_NOTHING.test(raw.sql)) {
    return [];
  }

  if (NONE_OF.test(raw.sql) || !ANY_OF.test(raw.sql)) {
    throw new Error(`Not an "any of" condition: ${raw.sql}`);
  }

  return raw.values;
}
