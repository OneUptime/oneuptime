import { expect } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * A comparison QueryUtil.serializeQuery wrote (a TypeORM Raw), read back as
 * the SQL Postgres gets and applied to a row the way Postgres applies it to
 * a timestamptz column in a UTC session. It reads the shapes QueryHelper
 * writes for comparisons: `(col < :p)`, `(col < :p or col IS NULL)`,
 * `(col >= :a and col <= :b)`, with =, !=, <, <=, > and >=.
 *
 * DateComparisonPostgres.test.ts runs the same statements on Postgres, so
 * this reading is checked against the real one.
 */

export type RowPredicate = (row: Date | null) => boolean;

export interface DateComparison {
  // The SQL for a column called "col", each parameter written in.
  sql: string;
  // The parameters, in the order the SQL names them, as the driver gets them.
  values: Array<unknown>;
  matches: RowPredicate;
}

// How Postgres reads a bound value as a timestamptz, in a UTC session.
function asInstant(value: unknown): number {
  if (value instanceof Date) {
    return value.getTime();
  }

  const instant: number = Date.parse(String(value));

  if (isNaN(instant)) {
    throw new Error(
      `invalid input syntax for type timestamp with time zone: "${String(value)}"`,
    );
  }

  return instant;
}

function written(value: unknown): string {
  return `'${value instanceof Date ? value.toISOString() : String(value)}'`;
}

export function readDateComparison(value: unknown): DateComparison {
  expect(value).toBeInstanceOf(FindOperator);

  const operator: FindOperator<unknown> = value as FindOperator<unknown>;

  expect(operator.type).toBe("raw");

  const template: string = operator.getSql!("col");
  const parameters: Record<string, unknown> =
    operator.objectLiteralParameters || {};
  const names: Array<string> = Array.from(template.matchAll(/:(\w+)/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );

  const disjuncts: Array<Array<string>> = template
    .replace(/^\(+/, "")
    .replace(/\)+$/, "")
    .split(/\s+or\s+/i)
    .map((disjunct: string): Array<string> => {
      return disjunct
        .replace(/[()]/g, "")
        .split(/\s+and\s+/i)
        .map((term: string): string => {
          return term.trim();
        });
    });

  const holds: (row: Date | null, term: string) => boolean = (
    row: Date | null,
    term: string,
  ): boolean => {
    if (term === "col IS NULL") {
      return row === null;
    }

    const comparison: RegExpMatchArray | null = term.match(
      /^col\s*(>=|<=|!=|>|<|=)\s*:(\w+)$/,
    );

    if (!comparison) {
      throw new Error(`Not a comparison this reads: ${term}`);
    }

    const bound: number = asInstant(parameters[comparison[2]!]);

    // A comparison with NULL is never true.
    if (row === null) {
      return false;
    }

    const at: number = row.getTime();

    switch (comparison[1]) {
      case ">=":
        return at >= bound;
      case "<=":
        return at <= bound;
      case ">":
        return at > bound;
      case "<":
        return at < bound;
      case "!=":
        return at !== bound;
      default:
        return at === bound;
    }
  };

  return {
    sql: template.replace(/:(\w+)/g, (_match: string, name: string) => {
      return written(parameters[name]);
    }),
    values: names.map((name: string): unknown => {
      return parameters[name];
    }),
    matches: (row: Date | null): boolean => {
      return disjuncts.some((terms: Array<string>): boolean => {
        return terms.every((term: string): boolean => {
          return holds(row, term);
        });
      });
    },
  };
}
