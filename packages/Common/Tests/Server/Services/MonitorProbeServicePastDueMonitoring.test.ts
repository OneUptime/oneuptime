import { Service as MonitorProbeServiceType } from "../../../Server/Services/MonitorProbeService";
import SubscriptionStatus, {
  SubscriptionStatusUtil,
} from "../../../Types/Billing/SubscriptionStatus";
import ObjectID from "../../../Types/ObjectID";
import {
  CapturedStatement,
  SUBSCRIPTION_COLUMNS,
  SubscriptionColumn,
  captureClaimStatements,
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

async function captureClaim(
  selectRows: Array<Record<string, unknown>> = [],
  limit: number = 25,
): Promise<{
  statements: Array<CapturedStatement>;
  select: CapturedStatement;
  claimed: Array<ObjectID>;
}> {
  const service: MonitorProbeServiceType = new MonitorProbeServiceType();
  const statements: Array<CapturedStatement> = captureClaimStatements(
    service,
    selectRows,
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
    test("binds probeId, now, limit and the active statuses, in that order", async () => {
      const { select } = await captureClaim([], 42);

      expect(select.parameters).toHaveLength(4);
      expect(select.parameters[0]).toBe(PROBE_ID.toString());
      expect(select.parameters[1]).toBeInstanceOf(Date);
      expect(select.parameters[2]).toBe(42);
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
     * The fix must not disturb what the claim is otherwise for: the row lock
     * stays on MonitorProbe alone, disabled / deleted monitors and deleted
     * projects stay out, and the order and limit are unchanged.
     */
    test("keeps the rest of the claim predicate and locking intact", async () => {
      const { select } = await captureClaim();
      const sql: string = normalizeSql(select.sql);

      expect(sql).toContain(
        'INNER JOIN "Project" p ON mp."projectId" = p."_id"',
      );
      expect(sql).toContain('WHERE mp."probeId" = $1');
      expect(sql).toContain('AND mp."isEnabled" = true');
      expect(sql).toContain('AND mp."deletedAt" IS NULL');
      expect(sql).toContain(
        'AND (mp."nextPingAt" IS NULL OR mp."nextPingAt" <= $2)',
      );
      expect(sql).toContain('AND m."disableActiveMonitoring" = false');
      expect(sql).toContain('AND m."deletedAt" IS NULL');
      expect(sql).toContain('AND p."deletedAt" IS NULL');
      expect(sql).toContain('ORDER BY mp."nextPingAt" ASC NULLS FIRST');
      expect(sql).toContain("LIMIT $3");
      expect(sql).toContain("FOR UPDATE OF mp SKIP LOCKED");
    });
  });

  describe("after rows are claimed", () => {
    test("returns nothing and runs no update when nothing is due", async () => {
      const { statements, claimed } = await captureClaim([]);

      expect(statements).toHaveLength(1);
      expect(claimed).toEqual([]);
    });

    /*
     * The select gained a fourth parameter; the update is a separate
     * statement that numbers its own. Pin that it still lines up.
     */
    test("claims the selected rows and the update's own numbering still lines up", async () => {
      const firstId: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const secondId: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

      const { statements, claimed } = await captureClaim([
        { _id: firstId, monitoringInterval: null },
        { _id: secondId, monitoringInterval: "not a cron" },
      ]);

      expect(statements).toHaveLength(2);

      const update: CapturedStatement = statements[1]!;

      expect(normalizeSql(update.sql)).toContain('UPDATE "MonitorProbe"');
      expect(update.parameters).toHaveLength(4);
      expect(update.parameters[1]).toEqual([firstId, secondId]);
      expect(update.parameters).not.toContainEqual(
        SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
      );
      expectPlaceholdersMatchParameters(update);

      expect(
        claimed.map((id: ObjectID) => {
          return id.toString();
        }),
      ).toEqual([firstId, secondId]);
    });
  });
});
