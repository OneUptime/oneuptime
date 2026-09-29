import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";

/*
 * A stand-in for RunnerJobService.countBy that counts the rows of an
 * in-memory RunnerJob table the way Postgres would count them for the
 * query the service built, so a test can say "these rows exist" and see
 * which of them a brake actually counts, instead of only stubbing a total.
 *
 * It understands plain equality and the QueryHelper operators the hourly
 * brakes use (IS NULL, IS NOT NULL, !=, >, <, IN, NOT IN). Any other
 * operator throws, so a query this fake cannot judge fails the test loudly
 * rather than being counted wrongly.
 */

export type FakeRunnerJobRow = Record<string, unknown>;

interface RawOperator {
  getSql: (alias: string) => string;
  objectLiteralParameters?: Record<string, unknown> | undefined;
}

const COLUMN: string = "COLUMN";

function isRawOperator(value: unknown): value is RawOperator {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { getSql?: unknown }).getSql === "function"
  );
}

function normalize(value: unknown): unknown {
  if (value instanceof ObjectID) {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  return value;
}

function isMissing(value: unknown): boolean {
  return value === null || value === undefined;
}

function matchesRaw(operator: RawOperator, rowValue: unknown): boolean {
  const sql: string = operator.getSql(COLUMN).trim();
  const parameters: Record<string, unknown> =
    operator.objectLiteralParameters || {};
  const value: unknown = normalize(rowValue);

  if (sql === `(${COLUMN} IS NULL)`) {
    return isMissing(rowValue);
  }

  if (sql === `(${COLUMN} IS NOT NULL)`) {
    return !isMissing(rowValue);
  }

  const comparison: RegExpMatchArray | null = sql.match(
    new RegExp(`^\\(${COLUMN} (!=|>|<) :(\\w+)\\)$`),
  );

  if (comparison) {
    const expected: unknown = normalize(parameters[comparison[2]!]);

    // SQL: a comparison with NULL is never true.
    if (isMissing(rowValue)) {
      return false;
    }

    switch (comparison[1]) {
      case "!=":
        return value !== expected;
      case ">":
        return (value as number) > (expected as number);
      default:
        return (value as number) < (expected as number);
    }
  }

  const list: RegExpMatchArray | null = sql.match(
    new RegExp(`^\\(${COLUMN} (NOT IN|IN) \\(:\\.\\.\\.(\\w+)\\)\\)$`),
  );

  if (list) {
    const values: Array<unknown> = (
      (parameters[list[2]!] as Array<unknown>) || []
    ).map(normalize);

    if (isMissing(rowValue)) {
      return false;
    }

    return list[1] === "IN" ? values.includes(value) : !values.includes(value);
  }

  throw new Error(`FakeRunnerJobCount cannot evaluate the filter: ${sql}`);
}

export function countFakeRunnerJobRows(
  rows: Array<FakeRunnerJobRow>,
  query: Record<string, unknown>,
): number {
  return rows.filter((row: FakeRunnerJobRow): boolean => {
    return Object.entries(query).every(
      ([column, filter]: [string, unknown]): boolean => {
        if (filter === undefined) {
          return true;
        }

        if (isRawOperator(filter)) {
          return matchesRaw(filter, row[column]);
        }

        return normalize(row[column]) === normalize(filter);
      },
    );
  }).length;
}

// For jest.spyOn(RunnerJobService, "countBy").mockImplementation(...).
export function fakeRunnerJobCountBy(
  rows: Array<FakeRunnerJobRow>,
): (args: unknown) => Promise<PositiveNumber> {
  return async (args: unknown): Promise<PositiveNumber> => {
    const query: Record<string, unknown> =
      (args as { query?: Record<string, unknown> }).query || {};

    return new PositiveNumber(countFakeRunnerJobRows(rows, query));
  };
}

// `count` rows of one shape, created just now.
export function fakeRunnerJobRows(
  count: number,
  shape: FakeRunnerJobRow,
): Array<FakeRunnerJobRow> {
  return Array.from({ length: count }, (): FakeRunnerJobRow => {
    return { createdAt: new Date(), ...shape };
  });
}
