import { EntityManager } from "typeorm";
import { expect } from "@jest/globals";

/*
 * Shared plumbing for the *PastDueMonitoring* tests of the raw-SQL claim
 * queries (MonitorProbeService.claimMonitorProbesForProbing and
 * NetworkDeviceService.claimDevicesForPolling).
 *
 * Those queries cannot run without a live Postgres, and a wrong subscription
 * filter in them is invisible: the query still runs and still returns rows,
 * it just never hands out an overdue project's monitors. So the statements
 * are captured at the EntityManager boundary and the subscription predicate
 * is EVALUATED against its bound parameters for a given pair of project
 * statuses - a text snapshot would pass for any list at all.
 */

export interface CapturedStatement {
  sql: string;
  parameters: Array<unknown>;
}

export interface ClaimServiceLike {
  executeTransaction: unknown;
}

type RunInTransactionFunction<TResult> = (
  entityManager: EntityManager,
) => Promise<TResult>;

/*
 * Replaces executeTransaction on the given service instance with one that
 * hands the callback a fake EntityManager. The first query (the claim SELECT)
 * resolves to `selectRows`; every later one (the UPDATE) resolves to [].
 */
export function captureClaimStatements(
  service: ClaimServiceLike,
  selectRows: Array<Record<string, unknown>> = [],
): Array<CapturedStatement> {
  const statements: Array<CapturedStatement> = [];

  jest
    .spyOn(
      service as { executeTransaction: () => Promise<unknown> },
      "executeTransaction",
    )
    .mockImplementation((async <TResult>(
      runInTransaction: RunInTransactionFunction<TResult>,
    ): Promise<TResult> => {
      const entityManager: {
        query: (
          sql: string,
          parameters?: Array<unknown>,
        ) => Promise<Array<Record<string, unknown>>>;
      } = {
        query: async (
          sql: string,
          parameters?: Array<unknown>,
        ): Promise<Array<Record<string, unknown>>> => {
          statements.push({ sql, parameters: parameters || [] });
          return statements.length === 1 ? selectRows : [];
        },
      };

      return await runInTransaction(entityManager as unknown as EntityManager);
    }) as never);

  return statements;
}

export function normalizeSql(sql: string): string {
  return sql
    .split("\n")
    .map((line: string) => {
      // Drop SQL line comments so prose in them cannot satisfy an assertion.
      const commentStart: number = line.indexOf("--");
      return commentStart === -1 ? line : line.slice(0, commentStart);
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export type SubscriptionColumn =
  | "paymentProviderSubscriptionStatus"
  | "paymentProviderMeteredSubscriptionStatus";

export const SUBSCRIPTION_COLUMNS: Array<SubscriptionColumn> = [
  "paymentProviderSubscriptionStatus",
  "paymentProviderMeteredSubscriptionStatus",
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/*
 * Finds `(p."<column>" IS NULL OR p."<column>" = ANY($n::text[]))` in the
 * statement, asserts it appears exactly once, and returns the bound array.
 */
export function getBoundStatusList(
  statement: CapturedStatement,
  column: SubscriptionColumn,
): Array<string> {
  const sql: string = normalizeSql(statement.sql);
  const quotedColumn: string = escapeRegExp(`p."${column}"`);

  const pattern: RegExp = new RegExp(
    `AND \\(${quotedColumn} IS NULL OR ${quotedColumn} = ANY\\(\\$(\\d+)::text\\[\\]\\)\\)`,
    "g",
  );

  const matches: Array<RegExpMatchArray> = [...sql.matchAll(pattern)];

  expect(matches).toHaveLength(1);

  const parameterIndex: number = Number(matches[0]![1]) - 1;

  expect(parameterIndex).toBeGreaterThanOrEqual(0);
  expect(parameterIndex).toBeLessThan(statement.parameters.length);

  const bound: unknown = statement.parameters[parameterIndex];

  expect(Array.isArray(bound)).toBe(true);

  return bound as Array<string>;
}

/*
 * What Postgres would decide for a project with these two column values:
 * each column must be NULL or a member of its bound list.
 */
export function claimAdmitsProject(
  statement: CapturedStatement,
  project: {
    paymentProviderSubscriptionStatus: string | null;
    paymentProviderMeteredSubscriptionStatus: string | null;
  },
): boolean {
  return SUBSCRIPTION_COLUMNS.every((column: SubscriptionColumn) => {
    const value: string | null = project[column];
    return (
      value === null || getBoundStatusList(statement, column).includes(value)
    );
  });
}

/*
 * Every $n in the statement must have a bound value and every bound value
 * must be referenced - adding a parameter to a query that already numbers
 * its own is exactly where an off-by-one hides.
 */
export function expectPlaceholdersMatchParameters(
  statement: CapturedStatement,
): void {
  const sql: string = normalizeSql(statement.sql);
  const used: Set<number> = new Set(
    [...sql.matchAll(/\$(\d+)/g)].map((match: RegExpMatchArray) => {
      return Number(match[1]);
    }),
  );

  const expected: Set<number> = new Set(
    statement.parameters.map((_value: unknown, index: number) => {
      return index + 1;
    }),
  );

  expect(
    [...used].sort((a: number, b: number) => {
      return a - b;
    }),
  ).toEqual(
    [...expected].sort((a: number, b: number) => {
      return a - b;
    }),
  );
}
