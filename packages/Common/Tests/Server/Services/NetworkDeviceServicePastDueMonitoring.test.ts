import { Service as NetworkDeviceServiceType } from "../../../Server/Services/NetworkDeviceService";
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
 * claimDevicesForPolling is the device-owned twin of
 * MonitorProbeService.claimMonitorProbesForProbing, and it carried the same
 * hand-written "active subscription" copy: active and trialing only. A
 * project whose subscription went past_due after ONE failed autopay attempt
 * (in production, an India e-mandate card debit that sat in "processing" for
 * a day and then declined) stopped having its network devices polled, while
 * Stripe was still retrying and the dashboard still called the project
 * active.
 *
 * Owner decision: past_due projects keep being monitored. Polling stops only
 * for unpaid, canceled, incomplete, incomplete_expired, expired, paused.
 * The status list is now SubscriptionStatusUtil.getActiveSubscriptionStatuses,
 * bound as a parameter.
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

type ProjectStatuses = {
  paymentProviderSubscriptionStatus: string | null;
  paymentProviderMeteredSubscriptionStatus: string | null;
};

async function captureClaim(
  selectRows: Array<Record<string, unknown>> = [],
  limit: number = 25,
): Promise<{
  statements: Array<CapturedStatement>;
  select: CapturedStatement;
  claimed: Array<ObjectID>;
}> {
  const service: NetworkDeviceServiceType = new NetworkDeviceServiceType();
  const statements: Array<CapturedStatement> = captureClaimStatements(
    service,
    selectRows,
  );

  const claimed: Array<ObjectID> = await service.claimDevicesForPolling({
    probeId: PROBE_ID,
    limit,
  });

  expect(statements.length).toBeGreaterThanOrEqual(1);

  return { statements, select: statements[0]!, claimed };
}

describe("NetworkDeviceService.claimDevicesForPolling keeps past_due projects polled", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("the production scenario", () => {
    test("claims devices of a project whose metered subscription went past_due after a failed autopay", async () => {
      const { select } = await captureClaim();

      expect(
        claimAdmitsProject(select, {
          paymentProviderSubscriptionStatus: SubscriptionStatus.Active,
          paymentProviderMeteredSubscriptionStatus: SubscriptionStatus.PastDue,
        }),
      ).toBe(true);
    });

    test("claims devices of a project with both subscriptions past_due", async () => {
      const { select } = await captureClaim();

      expect(
        claimAdmitsProject(select, {
          paymentProviderSubscriptionStatus: SubscriptionStatus.PastDue,
          paymentProviderMeteredSubscriptionStatus: SubscriptionStatus.PastDue,
        }),
      ).toBe(true);
    });

    test("stops claiming once the subscription is canceled", async () => {
      const { select } = await captureClaim();

      expect(
        claimAdmitsProject(select, {
          paymentProviderSubscriptionStatus: SubscriptionStatus.Canceled,
          paymentProviderMeteredSubscriptionStatus: SubscriptionStatus.PastDue,
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
            } as ProjectStatuses),
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
            } as ProjectStatuses),
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
            } as ProjectStatuses),
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

  /*
   * Both claim queries must hand out the same set of projects. A device and
   * a monitor in the same past_due project being treated differently is the
   * same drift this change removes.
   */
  test("binds the same status list as the monitor claim query", async () => {
    const { select } = await captureClaim();

    expect(select.parameters[3]).toEqual(
      SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
    );
  });

  describe("the statement itself", () => {
    test("binds probeId, now, limit and the active statuses, in that order", async () => {
      const { select } = await captureClaim([], 7);

      expect(select.parameters).toHaveLength(4);
      expect(select.parameters[0]).toBe(PROBE_ID.toString());
      expect(select.parameters[1]).toBeInstanceOf(Date);
      expect(select.parameters[2]).toBe(7);
      expect(select.parameters[3]).toEqual(
        SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
      );
    });

    test("uses every bound parameter and no unbound placeholder", async () => {
      const { select } = await captureClaim();

      expectPlaceholdersMatchParameters(select);
    });

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
        .mockReturnValue([SubscriptionStatus.Trialing]);

      const { select } = await captureClaim();

      expect(select.parameters[3]).toEqual([SubscriptionStatus.Trialing]);
      expect(
        claimAdmitsProject(select, {
          paymentProviderSubscriptionStatus: SubscriptionStatus.Active,
          paymentProviderMeteredSubscriptionStatus: null,
        }),
      ).toBe(false);
    });

    /*
     * Everything else the claim guards - the tenancy backstop, the
     * monitor-backed exclusion, the range-scan order, the device-only row
     * lock - must be untouched by the subscription change.
     */
    test("keeps the tenancy backstop, ordering and locking intact", async () => {
      const { select } = await captureClaim();
      const sql: string = normalizeSql(select.sql);

      expect(sql).toContain(
        'INNER JOIN "Project" p ON nd."projectId" = p."_id"',
      );
      expect(sql).toContain('INNER JOIN "Probe" pr ON nd."probeId" = pr."_id"');
      expect(sql).toContain(
        'AND (pr."isGlobalProbe" = true OR pr."projectId" = nd."projectId")',
      );
      expect(sql).toContain('WHERE nd."probeId" = $1');
      expect(sql).toContain('AND nd."nextPollAt" <= $2');
      expect(sql).toContain('AND p."deletedAt" IS NULL');
      expect(sql).toContain('ORDER BY nd."nextPollAt" ASC');
      expect(sql).toContain("LIMIT $3");
      expect(sql).toContain("FOR UPDATE OF nd SKIP LOCKED");
    });
  });

  describe("after rows are claimed", () => {
    test("returns nothing and runs no update when nothing is due", async () => {
      const { statements, claimed } = await captureClaim([]);

      expect(statements).toHaveLength(1);
      expect(claimed).toEqual([]);
    });

    test("claims the selected rows and the update's own numbering still lines up", async () => {
      const firstId: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const secondId: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

      const { statements, claimed } = await captureClaim([
        { _id: firstId, pollingIntervalInMinutes: 10 },
        { _id: secondId, pollingIntervalInMinutes: null },
      ]);

      expect(statements).toHaveLength(2);

      const update: CapturedStatement = statements[1]!;

      expect(normalizeSql(update.sql)).toContain('UPDATE "NetworkDevice"');
      // (id, nextPollAt) per row, then the ids again for the IN list.
      expect(update.parameters).toHaveLength(6);
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
