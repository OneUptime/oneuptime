import { FindOperator } from "typeorm";

/*
 * The conditions a query names a record's id with, answered the way
 * Postgres answers them - for a suite that stubs a service's findBy over
 * rows it keeps.
 *
 * Update checks read the rows an update writes, and hold the update to
 * them, by id (DatabaseService.findRowsAndHoldUpdateToThem): a plain id for
 * one row, "any of" (QueryHelper.any) for several, and a condition that
 * matches nothing (QueryHelper.any([])) for none - and a condition the
 * update names its rows by, held together with the rows its caller may
 * write ("and"). A suite's own query conditions are answered too: "none of"
 * (QueryHelper.notIn), "not" (QueryHelper.notEquals) and "is" (Equal).
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

// The conditions an "and" (TypeORM's And) holds together, or null.
function conditionsHeldTogether(condition: unknown): Array<unknown> | null {
  if (
    condition instanceof FindOperator &&
    (condition as FindOperator<unknown>).type === "and"
  ) {
    return (condition as FindOperator<unknown>)
      .value as unknown as Array<unknown>;
  }

  return null;
}

// The value an "is" (TypeORM's Equal) names, or undefined.
function valueEqualTo(condition: unknown): unknown {
  if (
    condition instanceof FindOperator &&
    (condition as FindOperator<unknown>).type === "equal"
  ) {
    return (condition as FindOperator<unknown>).value;
  }

  return undefined;
}

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
  const together: Array<unknown> | null = conditionsHeldTogether(condition);

  if (together) {
    return together.every((each: unknown): boolean => {
      return meetsCondition(each, value);
    });
  }

  const equalTo: unknown = valueEqualTo(condition);

  if (equalTo !== undefined) {
    return String(value).toLowerCase() === String(equalTo).toLowerCase();
  }

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
 * nothing, and for an "and" the ids every condition it holds together
 * names.
 */
export function idsNamedBy(condition: unknown): Array<string> {
  const together: Array<unknown> | null = conditionsHeldTogether(condition);

  if (together) {
    return together
      .map((each: unknown): Array<string> => {
        return idsNamedBy(each);
      })
      .reduce((kept: Array<string>, named: Array<string>): Array<string> => {
        const lower: Set<string> = new Set<string>(
          named.map((id: string): string => {
            return id.toLowerCase();
          }),
        );

        return kept.filter((id: string): boolean => {
          return lower.has(id.toLowerCase());
        });
      });
  }

  const equalTo: unknown = valueEqualTo(condition);

  if (equalTo !== undefined) {
    return [String(equalTo)];
  }

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
