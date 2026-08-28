import NetworkDeviceDiscoveryScanService, {
  Service as NetworkDeviceDiscoveryScanServiceClass,
} from "../../../Server/Services/NetworkDeviceDiscoveryScanService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import NetworkDeviceDiscoveryScan from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import { describe, expect, test } from "@jest/globals";

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
     * licenses the hookless claim write: if someone adds `cidr` to the claim
     * payload, or teaches a hook to react to `status`, the overlap shows up
     * here.
     */
    test("the claim write's columns are disjoint from what the hooks react to", () => {
      const claimWriteColumns: Array<string> = [
        "status",
        "startedAt",
        "statusMessage",
      ];
      /*
       * `name` joined `cidr` here when discovery scans became nameable
       * (issue #3391), and the sweep and schedule columns joined them when a
       * scan's settings became editable (issue #3444): an update carrying any
       * of these makes the hooks read the row and, if a setting really
       * changed, re-queue the scan afterwards. The claim payload carries none
       * of them, which is what keeps the hookless write honest.
       */
      const columnsReactedToByHooks: Array<string> = [
        "cidr",
        "name",
        "probe",
        "probeId",
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

      for (const column of claimWriteColumns) {
        expect(columnsReactedToByHooks).not.toContain(column);
      }
    });

    /*
     * The same disjointness asserted against the OTHER root writers of this
     * model, because every one of them takes the same shortcut in spirit: the
     * result ingest, the requeue worker, the stale-scan reaper, the
     * unclaimed-scan diagnosis and the auto-import stamp all write run state
     * and nothing else. If one of them ever carried a setting, it would start
     * re-queueing the very scan it is reporting on.
     */
    test("no server-side writer of this model carries a column the hooks react to", () => {
      const serverWrittenColumns: Array<string> = [
        "status",
        "statusMessage",
        "startedAt",
        "completedAt",
        "nextScanAt",
        "discoveredDevices",
        "scannedHostCount",
        "respondedHostCount",
        "autoImportProcessedAt",
      ];

      const columnsReactedToByHooks: Array<string> = [
        "cidr",
        "name",
        "probe",
        "probeId",
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

      for (const column of serverWrittenColumns) {
        expect(columnsReactedToByHooks).not.toContain(column);
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
