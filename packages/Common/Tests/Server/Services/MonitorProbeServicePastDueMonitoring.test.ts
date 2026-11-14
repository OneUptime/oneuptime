import {
  CLAIM_CANDIDATES_PER_MONITOR_PROBE,
  Service as MonitorProbeServiceType,
} from "../../../Server/Services/MonitorProbeService";
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
 * `selectRows` is what the candidate read answers; the claim statement then
 * answers every candidate it was handed, unless `claimedRows` says which.
 */
async function captureClaim(
  selectRows: Array<Record<string, unknown>> = [],
  limit: number = 25,
  claimedRows?: Array<Record<string, unknown>>,
): Promise<{
  statements: Array<CapturedStatement>;
  select: CapturedStatement;
  claimed: Array<ObjectID>;
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

  const claimed: Array<ObjectID> = await service.claimMonitorProbesForProbing({
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
        claimAdmitsProject(select, {
          paymentProviderSubscriptionStatus: SubscriptionStatus.Active,
          paymentProviderMeteredSubscriptionStatus: SubscriptionStatus.PastDue,
        }),
      ).toBe(true);
    });

    test("claims a project whose plan subscription is past_due", async () => {
      const { select } = await captureClaim();

      expect(
        claimAdmitsProject(select, {
          paymentProviderSubscriptionStatus: SubscriptionStatus.PastDue,
          paymentProviderMeteredSubscriptionStatus: SubscriptionStatus.Active,
        }),
      ).toBe(true);
    });

    test("claims a project with both subscriptions past_due", async () => {
      const { select } = await captureClaim();

      expect(
        claimAdmitsProject(select, {
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
        claimAdmitsProject(select, {
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
            claimAdmitsProject(select, {
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
            claimAdmitsProject(select, {
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
            claimAdmitsProject(select, {
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

        expect([...getBoundStatusList(select, column)].sort()).toEqual(
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
          admitted: claimAdmitsProject(select, {
            paymentProviderSubscriptionStatus: planStatus,
            paymentProviderMeteredSubscriptionStatus: meteredStatus,
          }),
        }).toEqual({ planStatus, meteredStatus, admitted: expected });
      }
    }
  });

  describe("the statement itself", () => {
    test("binds probeId, now, the candidate count and the active statuses, in that order", async () => {
      const { select } = await captureClaim([], 42);

      expect(select.parameters).toHaveLength(4);
      expect(select.parameters[0]).toBe(PROBE_ID.toString());
      expect(select.parameters[1]).toBeInstanceOf(Date);
      // More candidates than the limit: see CLAIM_CANDIDATES_PER_MONITOR_PROBE.
      expect(CLAIM_CANDIDATES_PER_MONITOR_PROBE).toBeGreaterThan(1);
      expect(select.parameters[2]).toBe(
        42 * CLAIM_CANDIDATES_PER_MONITOR_PROBE,
      );
      expect(select.parameters[3]).toEqual(
        SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
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
        claimAdmitsProject(select, {
          paymentProviderSubscriptionStatus: SubscriptionStatus.PastDue,
          paymentProviderMeteredSubscriptionStatus: SubscriptionStatus.Active,
        }),
      ).toBe(false);
    });

    /*
     * The fix must not disturb what the claim is otherwise for: disabled /
     * deleted monitors and deleted projects stay out, and the rows come
     * oldest first. The candidate read locks nothing (issue #7194); the claim
     * statement after it locks MonitorProbe rows alone - see below. The
     * read is a range of the (probeId, isEnabled, nextPingAt) index in the
     * index's own order, so it stops at its LIMIT (MonitorProbeClaimSetAside
     * pins why).
     */
    test("keeps the rest of the claim predicate intact, and the candidate read locks nothing", async () => {
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
      expect(sql).toContain('ORDER BY mp."nextPingAt" ASC LIMIT $3');
      expect(sql).not.toContain("NULLS FIRST");
      expect(sql).not.toContain('mp."nextPingAt" IS NULL');
      expect(sql).not.toContain("FOR UPDATE");
      expect(sql).not.toContain("FOR NO KEY UPDATE");
    });
  });

  describe("after rows are claimed", () => {
    /*
     * Nothing to claim, so no claim statement - only the set-aside, which
     * moves due rows nothing may probe (none probeable means every due row
     * was stepped over) and is an index probe when there are none.
     */
    test("returns nothing and runs no claim statement when nothing is due", async () => {
      const { statements, claimed } = await captureClaim([]);

      expect(statements).toHaveLength(2);
      expect(normalizeSql(statements[1]!.sql)).not.toContain('"lastPingAt"');
      expect(normalizeSql(statements[1]!.sql)).toContain('"unprobeable"');
      expect(claimed).toEqual([]);
    });

    /*
     * The select gained a fourth parameter; the claim is a separate
     * statement that numbers its own. Pin that it still lines up.
     */
    test("claims the selected rows in one statement whose numbering lines up", async () => {
      const firstId: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const secondId: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

      const { statements, claimed } = await captureClaim([
        { _id: firstId, monitoringInterval: null },
        { _id: secondId, monitoringInterval: "not a cron" },
      ]);

      // The read, the claim, then the set-aside.
      expect(statements).toHaveLength(3);

      const claim: CapturedStatement = statements[1]!;

      expect(normalizeSql(claim.sql)).toContain('UPDATE "MonitorProbe" AS mp');
      // now, the candidates, their next runs, the probe, the limit.
      expect(claim.parameters).toHaveLength(5);
      expect(claim.parameters[0]).toBeInstanceOf(Date);
      expect(claim.parameters[1]).toEqual([firstId, secondId]);
      expect(claim.parameters[2]).toHaveLength(2);
      expect(claim.parameters[3]).toBe(PROBE_ID.toString());
      expect(claim.parameters[4]).toBe(25);
      expect(claim.parameters).not.toContainEqual(
        SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
      );
      expectPlaceholdersMatchParameters(claim);

      expect(
        claimed.map((id: ObjectID) => {
          return id.toString();
        }),
      ).toEqual([firstId, secondId]);
    });

    /*
     * Issue #7194. The claim locks only for its own statement, and only rows
     * that are still due when it locks them and that nobody else holds - so
     * an instance that raced this one for the same rows hands out none of
     * them twice.
     */
    test("locks only MonitorProbe rows nobody holds, re-checked as still due", async () => {
      const { statements } = await captureClaim([
        {
          _id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          monitoringInterval: "* * * * *",
        },
      ]);

      const sql: string = normalizeSql(statements[1]!.sql);

      expect(sql).toContain("FOR NO KEY UPDATE OF mp SKIP LOCKED");
      expect(sql).toContain('WHERE mp."_id" = ANY($2::uuid[])');
      expect(sql).toContain('AND mp."probeId" = $4');
      expect(sql).toContain('AND mp."isEnabled" = true');
      expect(sql).toContain('AND mp."deletedAt" IS NULL');
      expect(sql).toContain(
        'AND (mp."nextPingAt" IS NULL OR mp."nextPingAt" <= $1::timestamptz)',
      );
      expect(sql).toContain("LIMIT $5");
      expect(sql).toContain('AND mp."_id" IN (SELECT "_id" FROM "claimable")');
      // A SELECT of what it wrote, so TypeORM answers with the rows.
      expect(sql).toContain('SELECT "_id" FROM "claimed"');
    });

    test("hands out only what the claim statement wrote, not every candidate", async () => {
      const firstId: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const secondId: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

      // Another instance claimed the first between the read and the claim.
      const { claimed } = await captureClaim(
        [
          { _id: firstId, monitoringInterval: "* * * * *" },
          { _id: secondId, monitoringInterval: "* * * * *" },
        ],
        25,
        [{ _id: secondId }],
      );

      expect(
        claimed.map((id: ObjectID) => {
          return id.toString();
        }),
      ).toEqual([secondId]);
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
