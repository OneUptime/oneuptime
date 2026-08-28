import NetworkDeviceDiscoveryScanService, {
  Service as NetworkDeviceDiscoveryScanServiceClass,
} from "../../../Server/Services/NetworkDeviceDiscoveryScanService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import NetworkDeviceDiscoveryScan from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The /probe-ingest/probe/discovery-scan/list route hands the requesting
 * probe its pending subnet scans and claims them (status "In Progress" +
 * startedAt, and a cleared statusMessage) via
 * DatabaseService.updateColumnsByIdWithoutHooks — one raw
 * parameterized UPDATE that skips ALL on-update hooks: workflow HTTP
 * triggers, audit-log inserts, realtime events, service
 * onBeforeUpdate/onUpdateSuccess. The probe synchronously waits on this
 * route's response, and it sits behind the same probe-auth middleware whose
 * hang got healthy probes flagged Disconnected — so the claim write must
 * stay a single statement, not the full updateOneById pipeline (permission
 * pre-fetch SELECT + row re-fetch + save() transaction).
 *
 *   - App/FeatureSet/Telemetry/API/ProbeIngest/DiscoveryScan.ts
 *       NetworkDeviceDiscoveryScan.status/startedAt/statusMessage when a
 *       probe claims a Pending scan
 *
 * The conversion dropped NOTHING: the model declares no update workflow, no
 * audit logging and no realtime events. But the fast path skips hooks
 * UNCONDITIONALLY: if someone adds a decorator to NetworkDeviceDiscoveryScan,
 * or an update-hook override to its service that cares about a column the
 * claim write stamps, nothing at the call site fails — the hook is just
 * silently never fired for the claim write. This suite turns that silent
 * drift into a loud test failure: if any assertion here starts failing, the
 * hookless claim writes in DiscoveryScan.ts silently skip that new hook —
 * revisit the call site before changing the assertion.
 *
 * The service DOES now override onBeforeUpdate: it validates the scan target
 * (the `cidr` column) whenever an update carries it, so a bad target cannot
 * be written by a root caller that bypasses the create-time check. That hook
 * is deliberately safe to skip here, and the assertions below pin exactly
 * why rather than merely restating that it exists: the claim write stamps
 * only `status`, `startedAt` and `statusMessage`, none of which the hook
 * looks at, and the hook is a pass-through for that payload. If the hook ever grows to
 * validate a column the claim write touches — or the claim write grows to
 * touch `cidr` — these fail.
 *
 * Pure model-metadata + class-shape tests — no Postgres, no Redis.
 */

describe("discovery-scan claim hookless write safety preconditions", () => {
  describe("NetworkDeviceDiscoveryScan model (claim write in DiscoveryScan.ts)", () => {
    /*
     * No @EnableWorkflow decorator AT ALL — the accessor is entirely unset,
     * which resolves to "no update workflow". If this becomes defined,
     * someone added @EnableWorkflow to NetworkDeviceDiscoveryScan and must
     * decide whether the claim write should keep skipping it.
     */
    test("has no @EnableWorkflow metadata at all", () => {
      const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
      expect(scan.enableWorkflowOn).toBeFalsy();
      expect(scan.enableWorkflowOn?.update).toBeFalsy();
    });

    test("has no on-update audit log", () => {
      const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
      expect(scan.enableAuditLogOn?.update).toBeFalsy();
    });

    test("has no realtime events", () => {
      const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
      expect(scan.enableRealtimeEventsOn).toBeFalsy();
    });
  });

  describe("fast-path columns exist on the entity", () => {
    /*
     * updateColumnsByIdWithoutHooks validates column names against entity
     * metadata at runtime and throws BadDataException on an unknown column.
     * Pinning column existence here means a rename breaks this suite at CI
     * time instead of leaving every claimed scan stuck in Pending at
     * runtime.
     */
    test("NetworkDeviceDiscoveryScan has every column the claim write stamps", () => {
      const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
      const fastPathColumns: Array<string> = [
        "status",
        "startedAt",
        "statusMessage",
      ];
      for (const column of fastPathColumns) {
        expect(scan.isTableColumn(column)).toBe(true);
      }
      // Negative control: isTableColumn actually discriminates.
      expect(scan.isTableColumn("notARealColumn")).toBe(false);
    });
  });

  describe("the service's update hooks are safe for the claim write to skip", () => {
    const updateHooks: Array<string> = ["onBeforeUpdate", "onUpdateSuccess"];

    /*
     * The hook reads the rows an edit is about to change. Stubbed to nothing,
     * so "did it read?" becomes an assertion rather than a database
     * dependency.
     */
    const findBy: jest.Mock = jest.fn() as unknown as jest.Mock;

    beforeEach(() => {
      findBy.mockReset();
      findBy.mockResolvedValue([] as never);

      jest
        .spyOn(
          NetworkDeviceDiscoveryScanService as unknown as {
            findBy: () => Promise<unknown>;
          },
          "findBy",
        )
        .mockImplementation(findBy as never);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    /*
     * BOTH hooks are overridden now, so neither can be dismissed as "there is
     * nothing to skip" — which is what this suite used to assert about
     * onUpdateSuccess. What licenses the claim's hook-free write today is
     * narrower and is pinned below instead: the hooks look only at columns the
     * claim payload does not carry, and onBeforeUpdate is demonstrably a
     * pass-through when handed that payload.
     *
     * onUpdateSuccess re-queues a scan whose target, probe or credentials just
     * changed, and re-derives nextScanAt from the recurrence pair (OneUptime
     * issue #3444). None of those columns is in the claim.
     */
    test("both update hooks are overridden, so the disjointness below is what matters", () => {
      for (const hook of updateHooks) {
        expect(
          Object.prototype.hasOwnProperty.call(
            NetworkDeviceDiscoveryScanServiceClass.prototype,
            hook,
          ),
        ).toBe(true);
      }

      // The default export is an instance of the class checked above.
      expect(NetworkDeviceDiscoveryScanService).toBeInstanceOf(
        NetworkDeviceDiscoveryScanServiceClass,
      );
    });

    /*
     * Positive control: the hooks DO exist on the DatabaseService base
     * prototype, so the own-property checks above cannot pass vacuously
     * (e.g. after a rename of the hook methods themselves).
     */
    test("the base DatabaseService prototype defines both hooks", () => {
      for (const hook of updateHooks) {
        expect(
          Object.prototype.hasOwnProperty.call(DatabaseService.prototype, hook),
        ).toBe(true);
      }
    });

    /*
     * The columns the claim write stamps and the columns the update hooks
     * react to must stay disjoint. This is the assertion that actually
     * licenses the hookless claim write.
     *
     * Asked of the HOOK, one column at a time, rather than of two lists of
     * strings written down beside each other: a test that compares one
     * literal against another literal passes whatever production does, and
     * this is the one place in the suite where that would matter. An update
     * carrying a single column takes the hook's early exit — nothing carried
     * forward, and no row read — exactly when that column is none of the
     * hook's business.
     */
    test("the claim write's columns are none of the update hooks' business", async () => {
      const claimWriteColumns: Array<string> = [
        "status",
        "startedAt",
        "statusMessage",
      ];

      for (const column of claimWriteColumns) {
        findBy.mockClear();

        const result: { carryForward: unknown } = await (
          NetworkDeviceDiscoveryScanService as any
        ).onBeforeUpdate({
          query: { _id: "some-scan-id" },
          data: { [column]: null },
          props: { isRoot: true },
          limit: 1,
          skip: 0,
        });

        expect({
          column: column,
          carryForward: result.carryForward,
          rowsRead: findBy.mock.calls.length,
        }).toEqual({ column: column, carryForward: null, rowsRead: 0 });
      }
    });

    /*
     * The same question the other way round, so the assertion above cannot
     * pass by the hook having quietly become inert: every column an edit can
     * carry DOES make the hook read the row it is about to change.
     */
    const SETTING_VALUES: Record<string, string> = {
      cidr: "10.0.0.0/24",
      probeId: "44444444-4444-4444-8444-444444444444",
    };

    test("a settings column, by contrast, does make the hooks read the row", async () => {
      const settingColumns: Array<string> = [
        "cidr",
        "probeId",
        /*
         * The ordered SNMP credential list (OneUptime issue #3458), and the
         * column this list is likeliest to fall behind: it is the one the
         * form actually posts now, the flattened columns below it are
         * mirrored FROM it, and an update carrying it can retire the scan's
         * run. If it ever stopped making the hook read the row, the claim's
         * hookless write would be licensed by a disjointness this suite no
         * longer checks.
         *
         * It needs no SETTING_VALUES entry, unlike `cidr` and `probeId`: a
         * null list is not a refusal but a clear — the scan falls back to its
         * flattened columns, which is exactly where a scan created before
         * this column already is — so the empty box every other column here
         * is given works for it too.
         */
        "snmpConfigs",
        "snmpVersion",
        "snmpCommunityString",
        "snmpPort",
        "snmpV3SecurityLevel",
        "snmpV3Username",
        "snmpV3AuthProtocol",
        "snmpV3AuthKey",
        "snmpV3PrivProtocol",
        "snmpV3PrivKey",
        "isRecurring",
        "rescanIntervalInMinutes",
      ];

      for (const column of settingColumns) {
        findBy.mockClear();

        const result: { carryForward: unknown } = await (
          NetworkDeviceDiscoveryScanService as any
        ).onBeforeUpdate({
          query: { _id: "some-scan-id" },
          /*
           * Two columns the hook refuses to CLEAR are given a value instead —
           * the scan target, which it validates, and the probe, which the
           * column cannot be without. Every other column accepts an empty box.
           */
          data: {
            [column]: SETTING_VALUES[column] ?? null,
          },
          props: { isRoot: true },
          limit: 1,
          skip: 0,
        });

        expect({ column: column, rowsRead: findBy.mock.calls.length }).toEqual({
          column: column,
          rowsRead: 1,
        });
        expect(result.carryForward).not.toBeNull();
      }
    });

    /*
     * And the behavioural proof, rather than an inventory of column names:
     * handed exactly the payload the claim write stamps, the override is a
     * pass-through. Skipping it therefore drops nothing.
     */
    test("onBeforeUpdate is a pass-through for the exact claim payload", async () => {
      const claimUpdateBy: unknown = {
        query: { _id: "some-scan-id" },
        data: {
          status: "In Progress",
          startedAt: new Date(0),
          statusMessage: null,
        },
        props: { isRoot: true },
        limit: 1,
        skip: 0,
      };

      const result: { updateBy: unknown; carryForward: unknown } = await (
        NetworkDeviceDiscoveryScanService as any
      ).onBeforeUpdate(claimUpdateBy);

      expect(result.updateBy).toBe(claimUpdateBy);

      /*
       * And nothing was carried forward, so onUpdateSuccess would have had
       * nothing to reconcile even if the claim had gone the long way round.
       * This is also the proof the hook did not read the database for a
       * payload the probe polls with every minute.
       */
      expect(result.carryForward).toBeNull();
    });

    /*
     * Negative control: the hook is not inert in general. Without this, the
     * pass-through test above would keep passing if the override were
     * gutted, and the disjointness assertion would be guarding nothing.
     */
    test("onBeforeUpdate does reject a bad target, so the pass-through is meaningful", async () => {
      await expect(
        (NetworkDeviceDiscoveryScanService as any).onBeforeUpdate({
          query: { _id: "some-scan-id" },
          data: { cidr: "10.22-16.0.1" },
          props: { isRoot: true },
          limit: 1,
          skip: 0,
        }),
      ).rejects.toThrow();
    });
  });
});
