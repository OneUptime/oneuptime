import {
  ClaimedMonitorProbe,
  MAX_MONITOR_PROBES_PER_CLAIM,
  Service as MonitorProbeServiceType,
} from "../../../Server/Services/MonitorProbeService";
import { SET_ASIDE_PER_CLAIM } from "../../../Server/Utils/Probe/ClaimSetAside";
import SubscriptionStatus, {
  SubscriptionStatusUtil,
} from "../../../Types/Billing/SubscriptionStatus";
import ObjectID from "../../../Types/ObjectID";
import {
  CapturedStatement,
  SUBSCRIPTION_COLUMNS,
  SubscriptionColumn,
  captureClaimQueries,
  claimAdmitsProject,
  expectPlaceholdersMatchParameters,
  getBoundStatusList,
  normalizeSql,
} from "../TestingUtils/PastDueMonitoringClaimSql";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * WHAT THIS FILE IS DEFENDING
 *
 * claimMonitorProbesForProbing is the query every probe runs to pick the
 * monitors it checks next. Its project filter was a hand-written copy of
 * "active subscription" that listed only active and trialing, while the rest
 * of the product (isSubscriptionActive, the paywall, the dashboard banner)
 * counts past_due as active.
 *
 * Production: a customer project had its metered subscription
 * pinned to an old India card. The autopay attempt sat in "processing" for a
 * day (e-mandate pre-debit) and then declined; Stripe marked the subscription
 * past_due and kept retrying - and from that moment no probe ever claimed
 * the project's monitors again. The dashboard said "will become inactive
 * soon"; monitoring had in fact already stopped.
 *
 * Owner decision: past_due projects keep being monitored. Monitoring stops
 * only for unpaid, canceled, incomplete, incomplete_expired, expired, paused.
 */

const PROBE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const INACTIVE_STATUSES: Array<SubscriptionStatus> = [
  SubscriptionStatus.Unpaid,
  SubscriptionStatus.Canceled,
  SubscriptionStatus.Incomplete,
  SubscriptionStatus.IncompleteExpired,
  SubscriptionStatus.Expired,
  SubscriptionStatus.Paused,
];

const STILL_SERVED_STATUSES: Array<SubscriptionStatus | null> = [
  null,
  SubscriptionStatus.Active,
  SubscriptionStatus.Trialing,
  SubscriptionStatus.PastDue,
];

const ALL_VALUES: Array<SubscriptionStatus | null> = [
  null,
  ...Object.values(SubscriptionStatus),
];

/*
 * The claim is one statement since #10819, and holds the rule twice: in the
 * rows it claims, and in its check for rows it stepped over. Both bind the
 * one shared list.
 */
const PREDICATES_IN_CLAIM: number = 2;

function admits(
  statement: CapturedStatement,
  project: {
    paymentProviderSubscriptionStatus: string | null;
    paymentProviderMeteredSubscriptionStatus: string | null;
  },
): boolean {
  return claimAdmitsProject(statement, project, PREDICATES_IN_CLAIM);
}

/*
 * `selectRows` is what the claim's statement answers (its first and only
 * statement unless it gives a new schedule's rows their next run or sets
 * rows aside); `claimedRows`, what any later statement answers.
 */
async function captureClaim(
  selectRows: Array<Record<string, unknown>> = [],
  limit: number = 25,
  claimedRows?: Array<Record<string, unknown>>,
): Promise<{
  statements: Array<CapturedStatement>;
  select: CapturedStatement;
  claimed: Array<ClaimedMonitorProbe>;
}> {
  const service: MonitorProbeServiceType = new MonitorProbeServiceType();
  const statements: Array<CapturedStatement> = captureClaimQueries(
    service,
    selectRows,
    claimedRows
      ? () => {
          return claimedRows;
        }
      : undefined,
  );

  const claimed: Array<ClaimedMonitorProbe> =
    await service.claimMonitorProbesForProbing({
      probeId: PROBE_ID,
      limit,
    });

  expect(statements.length).toBeGreaterThanOrEqual(1);

  return { statements, select: statements[0]!, claimed };
}

describe("MonitorProbeService.claimMonitorProbesForProbing keeps past_due projects monitored", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("the production scenario", () => {
    /*
     * The affected project: plan subscription still active, metered subscription
     * past_due after the stale-card autopay attempt failed.
     */
    test("claims a project whose metered subscription went past_due after a failed autopay", async () => {
      const { select } = await captureClaim();

      expect(
        admits(select, {
          paymentProviderSubscriptionStatus: SubscriptionStatus.Active,
          paymentProviderMeteredSubscriptionStatus: SubscriptionStatus.PastDue,
        }),
      ).toBe(true);
    });

    test("claims a project whose plan subscription is past_due", async () => {
      const { select } = await captureClaim();

      expect(
        admits(select, {
          paymentProviderSubscriptionStatus: SubscriptionStatus.PastDue,
          paymentProviderMeteredSubscriptionStatus: SubscriptionStatus.Active,
        }),
      ).toBe(true);
    });

    test("claims a project with both subscriptions past_due", async () => {
      const { select } = await captureClaim();

      expect(
        admits(select, {
          paymentProviderSubscriptionStatus: SubscriptionStatus.PastDue,
          paymentProviderMeteredSubscriptionStatus: SubscriptionStatus.PastDue,
        }),
      ).toBe(true);
    });

    /*
     * Once Stripe's retries are exhausted the subscription becomes unpaid (or
     * canceled): that is where monitoring is supposed to stop.
     */
    test("stops claiming once the retries are exhausted and the subscription is unpaid", async () => {
      const { select } = await captureClaim();

      expect(
        admits(select, {
          paymentProviderSubscriptionStatus: SubscriptionStatus.Active,
          paymentProviderMeteredSubscriptionStatus: SubscriptionStatus.Unpaid,
        }),
      ).toBe(false);
    });
  });

  describe.each(SUBSCRIPTION_COLUMNS)(
    "the %s predicate",
    (column: SubscriptionColumn) => {
      const otherColumn: SubscriptionColumn = SUBSCRIPTION_COLUMNS.find(
        (candidate: SubscriptionColumn) => {
          return candidate !== column;
        },
      )!;

      test.each(STILL_SERVED_STATUSES)(
        "admits %p when the other subscription is active",
        async (status: SubscriptionStatus | null) => {
          const { select } = await captureClaim();

          expect(
            admits(select, {
              [column]: status,
              [otherColumn]: SubscriptionStatus.Active,
            } as {
              paymentProviderSubscriptionStatus: string | null;
              paymentProviderMeteredSubscriptionStatus: string | null;
            }),
          ).toBe(true);
        },
      );

      test.each(INACTIVE_STATUSES)(
        "excludes %s even when the other subscription is active",
        async (status: SubscriptionStatus) => {
          const { select } = await captureClaim();

          expect(
            admits(select, {
              [column]: status,
              [otherColumn]: SubscriptionStatus.Active,
            } as {
              paymentProviderSubscriptionStatus: string | null;
              paymentProviderMeteredSubscriptionStatus: string | null;
            }),
          ).toBe(false);
        },
      );

      test.each(INACTIVE_STATUSES)(
        "excludes a past_due project whose other subscription is %s",
        async (status: SubscriptionStatus) => {
          const { select } = await captureClaim();

          expect(
            admits(select, {
              [column]: SubscriptionStatus.PastDue,
              [otherColumn]: status,
            } as {
              paymentProviderSubscriptionStatus: string | null;
              paymentProviderMeteredSubscriptionStatus: string | null;
            }),
          ).toBe(false);
        },
      );

      test("appears exactly once and binds the shared active list", async () => {
        const { select } = await captureClaim();

        expect(
          [...getBoundStatusList(select, column, PREDICATES_IN_CLAIM)].sort(),
        ).toEqual(
          [...SubscriptionStatusUtil.getActiveSubscriptionStatuses()].sort(),
        );
      });
    },
  );

  /*
   * The drift guard. For every combination of the two columns the claim
   * query must agree with SubscriptionStatusUtil.isSubscriptionActive - the
   * pair that disagreed in production.
   */
  test("agrees with isSubscriptionActive for every combination of statuses", async () => {
    const { select } = await captureClaim();

    for (const planStatus of ALL_VALUES) {
      for (const meteredStatus of ALL_VALUES) {
        const expected: boolean =
          SubscriptionStatusUtil.isSubscriptionActive(
            planStatus || undefined,
          ) &&
          SubscriptionStatusUtil.isSubscriptionActive(
            meteredStatus || undefined,
          );

        expect({
          planStatus,
          meteredStatus,
          admitted: admits(select, {
            paymentProviderSubscriptionStatus: planStatus,
            paymentProviderMeteredSubscriptionStatus: meteredStatus,
          }),
        }).toEqual({ planStatus, meteredStatus, admitted: expected });
      }
    }
  });

  describe("the statement itself", () => {
    test("binds probeId, now, the batch, the active statuses, the known schedules, the minute on and the set-aside batch, in that order", async () => {
      const { select } = await captureClaim([], 42);

      expect(select.parameters).toHaveLength(8);
      expect(select.parameters[0]).toBe(PROBE_ID.toString());
      expect(select.parameters[1]).toBeInstanceOf(Date);
      expect(select.parameters[2]).toBe(42);
      expect(select.parameters[3]).toEqual(
        SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
      );
      // A fresh process knows no schedule yet.
      expect(select.parameters[4]).toEqual([]);
      expect(select.parameters[5]).toEqual([]);
      expect(
        (select.parameters[6] as Date).getTime() -
          (select.parameters[1] as Date).getTime(),
      ).toBe(60 * 1000);
      expect(select.parameters[7]).toBe(SET_ASIDE_PER_CLAIM);
    });

    test("hands out what the probe asked for, as a whole number from 1 to the most a claim may", async () => {
      expect((await captureClaim([], 7.9)).select.parameters[2]).toBe(7);
      expect((await captureClaim([], 0)).select.parameters[2]).toBe(1);
      expect((await captureClaim([], -5)).select.parameters[2]).toBe(1);
      expect(
        (await captureClaim([], "50" as unknown as number)).select
          .parameters[2],
      ).toBe(50);
      expect((await captureClaim([], Number.NaN)).select.parameters[2]).toBe(1);
      expect((await captureClaim([], 1_000_000)).select.parameters[2]).toBe(
        MAX_MONITOR_PROBES_PER_CLAIM,
      );
    });

    test("uses every bound parameter and no unbound placeholder", async () => {
      const { select } = await captureClaim();

      expectPlaceholdersMatchParameters(select);
    });

    /*
     * No private copy of the list may creep back in: any quoted status in
     * the SQL is a second definition of "active" waiting to drift.
     */
    test("contains no hardcoded subscription status literal", async () => {
      const { select } = await captureClaim();
      const sql: string = normalizeSql(select.sql);

      for (const status of Object.values(SubscriptionStatus)) {
        expect(sql).not.toContain(`'${status}'`);
        expect(sql).not.toContain(`"${status}"`);
      }

      expect(sql).not.toMatch(/SubscriptionStatus" IN \(/);
    });

    test("follows the shared list rather than a private copy", async () => {
      jest
        .spyOn(SubscriptionStatusUtil, "getActiveSubscriptionStatuses")
        .mockReturnValue([SubscriptionStatus.Active]);

      const { select } = await captureClaim();

      expect(select.parameters[3]).toEqual([SubscriptionStatus.Active]);
      expect(
        admits(select, {
          paymentProviderSubscriptionStatus: SubscriptionStatus.PastDue,
          paymentProviderMeteredSubscriptionStatus: SubscriptionStatus.Active,
        }),
      ).toBe(false);
    });

    /*
     * The fix must not disturb what the claim is otherwise for: disabled /
     * deleted monitors and deleted projects stay out, and the rows come
     * oldest first. The read is a range of the (probeId, isEnabled,
     * nextPingAt) index in the index's own order, so it stops at its LIMIT
     * (MonitorProbeClaimSetAside pins why).
     */
    test("keeps the rest of the claim predicate intact, oldest first, in the index's order", async () => {
      const { select } = await captureClaim();
      const sql: string = normalizeSql(select.sql);

      expect(sql).toContain(
        'INNER JOIN "Project" p ON mp."projectId" = p."_id"',
      );
      expect(sql).toContain('WHERE mp."probeId" = $1');
      expect(sql).toContain('AND mp."isEnabled" = true');
      expect(sql).toContain('AND mp."deletedAt" IS NULL');
      expect(sql).toContain('AND mp."nextPingAt" <= $2');
      expect(sql).toContain('AND m."disableActiveMonitoring" = false');
      expect(sql).toContain('AND m."deletedAt" IS NULL');
      expect(sql).toContain('AND p."deletedAt" IS NULL');
      expect(sql).toContain(
        'ORDER BY mp."nextPingAt" ASC LIMIT $3 FOR NO KEY UPDATE OF mp SKIP LOCKED',
      );
      expect(sql).not.toContain("FOR UPDATE");

      // The read itself: in the index's own order, never NULLS FIRST.
      const read: string = sql.slice(
        sql.indexOf('WITH "claimable" AS ('),
        sql.indexOf('"schedule" AS ('),
      );
      expect(read).not.toContain("NULLS FIRST");
      expect(read).not.toContain('mp."nextPingAt" IS NULL');
    });
  });

  describe("after rows are claimed", () => {
    /*
     * Nothing due: the statement answers one row with no _id, for its flag.
     * With nothing stepped over, that is all - no second statement.
     */
    test("returns nothing, and runs nothing more, when nothing is due", async () => {
      const { statements, claimed } = await captureClaim([
        { _id: null, steppedOver: false },
      ]);

      expect(statements).toHaveLength(1);
      expect(claimed).toEqual([]);
    });

    /*
     * Issue #10819. Claims for the same probe made at the same moment each
     * lock the next rows nobody holds, in the one statement that writes
     * them - so none hands out a row twice, and none comes back empty
     * while rows are due because another took the ones it had read.
     */
    test("locks only MonitorProbe rows nobody holds, re-checked as still due, and writes them in the same statement", async () => {
      const { select } = await captureClaim();
      const sql: string = normalizeSql(select.sql);

      expect(sql).toContain("FOR NO KEY UPDATE OF mp SKIP LOCKED");
      expect(sql).toContain('UPDATE "MonitorProbe" AS mp');
      expect(sql).toContain('SET "lastPingAt" = $2');
      expect(sql).toContain('FROM "claimable" c');
      expect(sql).toContain('WHERE mp."_id" = c."_id"');
      // Each row's next run: its schedule's, from the bound arrays.
      expect(sql).toContain(
        'unnest($5::text[], $6::timestamptz[]) AS s("monitoringInterval", "nextPingAt")',
      );
      // A SELECT of what it wrote, so TypeORM answers with the rows.
      expect(sql).toContain('LEFT JOIN "claimed" c ON true');
    });

    test("hands out what the statement wrote, oldest first", async () => {
      const firstId: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const secondId: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

      const { claimed } = await captureClaim([
        { _id: firstId, monitoringInterval: "* * * * *", steppedOver: false },
        { _id: secondId, monitoringInterval: "* * * * *", steppedOver: false },
      ]);

      expect(
        claimed.map((claimedMonitorProbe: ClaimedMonitorProbe) => {
          return claimedMonitorProbe.monitorProbeId.toString();
        }),
      ).toEqual([firstId, secondId]);
    });

    test("never opens a transaction", async () => {
      const service: MonitorProbeServiceType = new MonitorProbeServiceType();
      captureClaimQueries(service, [
        {
          _id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          monitoringInterval: "* * * * *",
        },
      ]);

      // captureClaimQueries makes executeTransaction throw.
      await expect(
        service.claimMonitorProbesForProbing({ probeId: PROBE_ID, limit: 5 }),
      ).resolves.toHaveLength(1);
    });
  });
});
