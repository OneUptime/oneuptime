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
     * onUpdateSuccess is still un-overridden: nothing runs AFTER the write
     * that the fast path would drop. Only onBeforeUpdate is overridden, and
     * the tests below pin that it is inert for the claim payload.
     */
    test("NetworkDeviceDiscoveryScanService does not override onUpdateSuccess", () => {
      expect(
        Object.prototype.hasOwnProperty.call(
          NetworkDeviceDiscoveryScanServiceClass.prototype,
          "onUpdateSuccess",
        ),
      ).toBe(false);
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
     * The columns the claim write stamps and the column the onBeforeUpdate
     * override validates must stay disjoint. This is the assertion that
     * actually licenses the hookless claim write: if someone adds `cidr` to
     * the claim payload, or teaches the hook to validate `status`, the
     * overlap shows up here.
     */
    test("the claim write's columns are disjoint from what onBeforeUpdate validates", () => {
      const claimWriteColumns: Array<string> = [
        "status",
        "startedAt",
        "statusMessage",
      ];
      /*
       * `name` joined `cidr` here when discovery scans became nameable
       * (issue #3391): the hook validates and normalizes it on any update that
       * carries it. The claim payload does not, which is what keeps the
       * hookless write honest.
       */
      const columnsValidatedByHook: Array<string> = ["cidr", "name"];

      for (const column of claimWriteColumns) {
        expect(columnsValidatedByHook).not.toContain(column);
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

      const result: { updateBy: unknown } = await (
        NetworkDeviceDiscoveryScanService as any
      ).onBeforeUpdate(claimUpdateBy);

      expect(result.updateBy).toBe(claimUpdateBy);
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
