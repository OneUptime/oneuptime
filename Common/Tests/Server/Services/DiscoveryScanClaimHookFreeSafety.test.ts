import NetworkDeviceDiscoveryScanService, {
  Service as NetworkDeviceDiscoveryScanServiceClass,
} from "../../../Server/Services/NetworkDeviceDiscoveryScanService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import NetworkDeviceDiscoveryScan from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import { describe, expect, test } from "@jest/globals";

/*
 * The /probe-ingest/probe/discovery-scan/list route hands the requesting
 * probe its pending subnet scans and claims them (status "In Progress" +
 * startedAt) via DatabaseService.updateColumnsByIdWithoutHooks — one raw
 * parameterized UPDATE that skips ALL on-update hooks: workflow HTTP
 * triggers, audit-log inserts, realtime events, service
 * onBeforeUpdate/onUpdateSuccess. The probe synchronously waits on this
 * route's response, and it sits behind the same probe-auth middleware whose
 * hang got healthy probes flagged Disconnected — so the claim write must
 * stay a single statement, not the full updateOneById pipeline (permission
 * pre-fetch SELECT + row re-fetch + save() transaction).
 *
 *   - App/FeatureSet/Telemetry/API/ProbeIngest/DiscoveryScan.ts
 *       NetworkDeviceDiscoveryScan.status/startedAt when a probe claims a
 *       Pending scan
 *
 * The conversion dropped NOTHING: the model declares no update workflow, no
 * audit logging and no realtime events, and the service overrides neither
 * update hook — so the old pipeline's hook stages were inert for this
 * write. But the fast path skips hooks UNCONDITIONALLY: if someone later
 * adds a decorator to NetworkDeviceDiscoveryScan or an update-hook override
 * to its service, nothing at the call site fails — the new hook is just
 * silently never fired for the claim write. This suite turns that silent
 * drift into a loud test failure: if any assertion here starts failing, the
 * hookless claim writes in DiscoveryScan.ts silently skip that new hook —
 * revisit the call site before changing the assertion.
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
      const fastPathColumns: Array<string> = ["status", "startedAt"];
      for (const column of fastPathColumns) {
        expect(scan.isTableColumn(column)).toBe(true);
      }
      // Negative control: isTableColumn actually discriminates.
      expect(scan.isTableColumn("notARealColumn")).toBe(false);
    });
  });

  describe("service defines no update hooks of its own", () => {
    /*
     * DatabaseService's base onBeforeUpdate/onUpdateSuccess are no-op
     * pass-throughs; a service only gets update behavior by OVERRIDING
     * them. Own-property checks on the concrete service prototype pin that
     * NetworkDeviceDiscoveryScanService does not — so the fast path skips
     * nothing. If an override appears, these fail loudly and the claim
     * write in DiscoveryScan.ts must be re-evaluated.
     */
    const updateHooks: Array<string> = ["onBeforeUpdate", "onUpdateSuccess"];

    test("NetworkDeviceDiscoveryScanService does not override onBeforeUpdate/onUpdateSuccess", () => {
      for (const hook of updateHooks) {
        expect(
          Object.prototype.hasOwnProperty.call(
            NetworkDeviceDiscoveryScanServiceClass.prototype,
            hook,
          ),
        ).toBe(false);
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
  });
});
