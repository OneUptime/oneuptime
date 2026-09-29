import Project from "../../../Models/DatabaseModels/Project";
import ProjectService from "../../../Server/Services/ProjectService";
import Query from "../../../Server/Types/Database/Query";
import SubscriptionStatus, {
  SubscriptionStatusUtil,
} from "../../../Types/Billing/SubscriptionStatus";
import { afterEach, describe, expect, it } from "@jest/globals";
import { getJestSpyOn } from "../../Spy";

/*
 * WHAT THIS FILE IS DEFENDING
 *
 * ProjectService.getActiveProjectStatusQuery is the TypeORM half of "is this
 * project still served". It is spread into the probe's monitor fetch and the
 * KEDA queue-size count (Telemetry ProbeIngest), the server-monitor ingest
 * API and queue job, the IncomingRequest / IncomingEmail / ServerMonitor
 * sweeps in Workers, and SLO evaluation.
 *
 * It used to list only active and trialing. In production a customer's
 * autopay attempt on a stale card failed (an India e-mandate debit sat in
 * "processing" for a day and then declined), Stripe moved the subscription to
 * past_due, and every one of those paths silently dropped the project - while
 * isSubscriptionActive, the paywall and the "will become inactive soon"
 * banner all still treated it as active. The owner's decision: past_due keeps
 * being monitored, and only a truly inactive subscription stops it.
 *
 * The query is a pair of TypeORM Raw operators built by
 * QueryHelper.equalToOrNull, so the tests below evaluate the operator's SQL
 * against every status instead of comparing it to a snapshot: a snapshot
 * would pass for any list at all.
 */

type RawOperator = {
  type: string;
  getSql: (alias: string) => string;
  objectLiteralParameters: Record<string, string>;
};

const STATUS_COLUMNS: Array<
  | "paymentProviderSubscriptionStatus"
  | "paymentProviderMeteredSubscriptionStatus"
> = [
  "paymentProviderSubscriptionStatus",
  "paymentProviderMeteredSubscriptionStatus",
];

const ALL_STATUSES: Array<SubscriptionStatus> =
  Object.values(SubscriptionStatus);

const INACTIVE_STATUSES: Array<SubscriptionStatus> = [
  SubscriptionStatus.Unpaid,
  SubscriptionStatus.Canceled,
  SubscriptionStatus.Incomplete,
  SubscriptionStatus.IncompleteExpired,
  SubscriptionStatus.Expired,
  SubscriptionStatus.Paused,
];

type GetOperatorFunction = (
  query: Query<Project>,
  column: string,
) => RawOperator;

const getOperator: GetOperatorFunction = (
  query: Query<Project>,
  column: string,
): RawOperator => {
  return (query as unknown as Record<string, RawOperator>)[column]!;
};

/*
 * Evaluates the operator's WHERE fragment for one column value, the way
 * Postgres would: the fragment must be a parenthesised OR of
 * `alias = :param` terms plus exactly one `alias IS NULL`, and every
 * `:param` must be bound. Anything else fails loudly rather than being
 * guessed at.
 */
type AdmitsFunction = (operator: RawOperator, value: string | null) => boolean;

const admits: AdmitsFunction = (
  operator: RawOperator,
  value: string | null,
): boolean => {
  const alias: string = "p.status";
  const sql: string = operator.getSql(alias).trim();

  expect(sql.startsWith("(")).toBe(true);
  expect(sql.endsWith(")")).toBe(true);

  const terms: Array<string> = sql
    .slice(1, -1)
    .split(/\s+or\s+/i)
    .map((term: string) => {
      return term.trim();
    });

  let admitted: boolean = false;
  let nullTerms: number = 0;

  for (const term of terms) {
    if (term === `${alias} IS NULL`) {
      nullTerms++;
      admitted = admitted || value === null;
      continue;
    }

    const match: RegExpMatchArray | null = term.match(
      /^p\.status = :([A-Za-z0-9_]+)$/,
    );

    if (!match) {
      throw new Error(`Unexpected term in status predicate: ${term}`);
    }

    const parameterName: string = match[1]!;

    expect(Object.keys(operator.objectLiteralParameters)).toContain(
      parameterName,
    );

    admitted =
      admitted ||
      (value !== null &&
        operator.objectLiteralParameters[parameterName] === value);
  }

  expect(nullTerms).toBe(1);

  return admitted;
};

describe("ProjectService.getActiveProjectStatusQuery keeps past_due projects monitored", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("filters on exactly the two subscription status columns", () => {
    const query: Query<Project> = ProjectService.getActiveProjectStatusQuery();

    expect(Object.keys(query).sort()).toEqual([...STATUS_COLUMNS].sort());

    for (const column of STATUS_COLUMNS) {
      expect(getOperator(query, column).type).toBe("raw");
    }
  });

  describe.each(STATUS_COLUMNS)("%s", (column: string) => {
    /*
     * The incident, verbatim: the metered subscription is past_due after a
     * failed autopay attempt and the plan subscription is still active.
     */
    it("admits past_due", () => {
      const operator: RawOperator = getOperator(
        ProjectService.getActiveProjectStatusQuery(),
        column,
      );

      expect(admits(operator, SubscriptionStatus.PastDue)).toBe(true);
    });

    it.each([SubscriptionStatus.Active, SubscriptionStatus.Trialing])(
      "still admits %s",
      (status: SubscriptionStatus) => {
        const operator: RawOperator = getOperator(
          ProjectService.getActiveProjectStatusQuery(),
          column,
        );

        expect(admits(operator, status)).toBe(true);
      },
    );

    // A project with no subscription (self-hosted / billing disabled).
    it("still admits NULL", () => {
      const operator: RawOperator = getOperator(
        ProjectService.getActiveProjectStatusQuery(),
        column,
      );

      expect(admits(operator, null)).toBe(true);
    });

    it.each(INACTIVE_STATUSES)("excludes %s", (status: SubscriptionStatus) => {
      const operator: RawOperator = getOperator(
        ProjectService.getActiveProjectStatusQuery(),
        column,
      );

      expect(admits(operator, status)).toBe(false);
    });

    it("excludes a status string it has never heard of", () => {
      const operator: RawOperator = getOperator(
        ProjectService.getActiveProjectStatusQuery(),
        column,
      );

      expect(admits(operator, "something_new")).toBe(false);
    });

    it("binds exactly the shared active statuses, no more and no fewer", () => {
      const operator: RawOperator = getOperator(
        ProjectService.getActiveProjectStatusQuery(),
        column,
      );

      expect(Object.values(operator.objectLiteralParameters).sort()).toEqual(
        [...SubscriptionStatusUtil.getActiveSubscriptionStatuses()].sort(),
      );
    });

    /*
     * The drift guard: for every status the TypeScript check and the query
     * must give the same answer. This is precisely the pair that disagreed
     * in production.
     */
    it.each(ALL_STATUSES)(
      "agrees with SubscriptionStatusUtil.isSubscriptionActive for %s",
      (status: SubscriptionStatus) => {
        const operator: RawOperator = getOperator(
          ProjectService.getActiveProjectStatusQuery(),
          column,
        );

        expect(admits(operator, status)).toBe(
          SubscriptionStatusUtil.isSubscriptionActive(status),
        );
      },
    );
  });

  it("follows the shared list rather than a private copy", () => {
    getJestSpyOn(
      SubscriptionStatusUtil,
      "getActiveSubscriptionStatuses",
    ).mockReturnValue([SubscriptionStatus.Active]);

    const query: Query<Project> = ProjectService.getActiveProjectStatusQuery();

    for (const column of STATUS_COLUMNS) {
      const operator: RawOperator = getOperator(query, column);

      expect(admits(operator, SubscriptionStatus.Active)).toBe(true);
      expect(admits(operator, SubscriptionStatus.Trialing)).toBe(false);
      expect(admits(operator, SubscriptionStatus.PastDue)).toBe(false);
    }
  });

  it("returns independent operators on every call", () => {
    const first: Query<Project> = ProjectService.getActiveProjectStatusQuery();
    const second: Query<Project> = ProjectService.getActiveProjectStatusQuery();

    for (const column of STATUS_COLUMNS) {
      expect(getOperator(first, column)).not.toBe(getOperator(second, column));
    }
  });

  describe("getAllActiveProjects", () => {
    it("queries with the past_due-inclusive status filter", async () => {
      const findAllBy: jest.SpyInstance<any, any> = getJestSpyOn(
        ProjectService,
        "findAllBy",
      ).mockResolvedValue([] as Array<Project>);

      await ProjectService.getAllActiveProjects();

      expect(findAllBy).toHaveBeenCalledTimes(1);

      const query: Query<Project> = (
        findAllBy.mock.calls[0]![0] as unknown as { query: Query<Project> }
      ).query;

      expect(Object.keys(query).sort()).toEqual([...STATUS_COLUMNS].sort());

      for (const column of STATUS_COLUMNS) {
        const operator: RawOperator = getOperator(query, column);

        expect(admits(operator, SubscriptionStatus.PastDue)).toBe(true);
        expect(admits(operator, SubscriptionStatus.Active)).toBe(true);
        expect(admits(operator, SubscriptionStatus.Trialing)).toBe(true);
        expect(admits(operator, null)).toBe(true);

        for (const status of INACTIVE_STATUSES) {
          expect(admits(operator, status)).toBe(false);
        }
      }
    });
  });
});
