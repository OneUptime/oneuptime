import { describe, expect, test } from "@jest/globals";
import AllModelTypes from "../../Models/DatabaseModels/Index";
import NetworkDeviceDiagnostic from "../../Models/DatabaseModels/NetworkDeviceDiagnostic";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import { NetworkDeviceDiagnosticStatus } from "../../Types/NetworkDevice/NetworkDeviceDiagnosticStatus";
import Permission from "../../Types/Permission";

/*
 * What a caller must supply to create a NetworkDeviceDiagnostic, what the
 * server fills in for them, and what nobody may change afterwards.
 *
 * The dashboard posts a device and a type, and nothing else. Everything the
 * probe needs (hostname, probe) and everything it reports (status, results,
 * timestamps) is the server's — and the server writes it from
 * onBeforeCreate, which runs BEFORE ModelPermission's create-column check.
 * That ordering is the trap this file guards: a server-written column that
 * is `create: []` but not `computed` makes every dashboard create fail with
 * "User is not allowed to create on hostname column", because the check
 * sees a value the caller has no grant for and cannot tell who wrote it.
 *
 * The same `checkRequiredFields` contradiction NetworkDeviceCreateContract
 * pins applies here too: a required column with an empty create list and no
 * default is unsatisfiable by every caller.
 */
describe("creating a NetworkDeviceDiagnostic", () => {
  const diagnostic: NetworkDeviceDiagnostic = new NetworkDeviceDiagnostic();

  /*
   * Columns the probe or the server writes after create. The dashboard
   * reads them; no caller may set them on the way in, and no update may
   * touch them — the CRUD update path is not how results arrive.
   */
  const SERVER_MANAGED_COLUMNS: Array<string> = [
    "hostname",
    "status",
    "statusMessage",
    "pingResult",
    "traceRouteResult",
    "startedAt",
    "completedAt",
  ];

  /*
   * The two of those that onBeforeCreate stamps a VALUE on for the caller.
   * The rest are cleared to undefined, which the column check skips.
   */
  const HOOK_STAMPED_COLUMNS: Array<string> = ["hostname", "status"];

  /** Required columns the caller is actually expected to provide. */
  function callerSuppliedRequiredColumns(): Array<string> {
    return diagnostic.getRequiredColumns().columns.filter((column: string) => {
      return !diagnostic.isDefaultValueColumn(column);
    });
  }

  function accessControlFor(column: string): ColumnAccessControl {
    const accessControl: ColumnAccessControl | null =
      diagnostic.getColumnAccessControlFor(column);

    expect(accessControl).not.toBeNull();

    return accessControl!;
  }

  /*
   * The identity of a run, and nothing else. Adding to this list is a
   * breaking change for the dashboard's create call and should be a
   * deliberate edit to this test.
   */
  test("asks the caller for exactly the device, the type and the project", () => {
    expect(callerSuppliedRequiredColumns().sort()).toEqual([
      "diagnosticType",
      "networkDeviceId",
      "projectId",
    ]);
  });

  test("never requires a column that no caller is permitted to set", () => {
    const unsatisfiable: Array<string> = callerSuppliedRequiredColumns().filter(
      (column: string) => {
        return accessControlFor(column).create.length === 0;
      },
    );

    expect(unsatisfiable).toEqual([]);
  });

  test.each(SERVER_MANAGED_COLUMNS)(
    "%s is written by the server or the probe, never by a caller",
    (column: string) => {
      expect(accessControlFor(column).create).toEqual([]);
      expect(accessControlFor(column).update).toEqual([]);
    },
  );

  /*
   * THE regression test for the ordering trap described at the top. If
   * either flag is dropped, the model still compiles, the API docs still
   * render, and every dashboard create is refused.
   */
  test.each(HOOK_STAMPED_COLUMNS)(
    "%s is computed, so the create-column check accepts the value the hook stamps",
    (column: string) => {
      expect(diagnostic.getTableColumnMetadata(column).computed).toBe(true);
    },
  );

  test("status is required, and it is Postgres that fills it in as Pending", () => {
    expect(diagnostic.getRequiredColumns().columns).toContain("status");
    expect(diagnostic.isDefaultValueColumn("status")).toBe(true);
    expect(diagnostic.getTableColumnMetadata("status").defaultValue).toBe(
      NetworkDeviceDiagnosticStatus.Pending,
    );
  });

  /*
   * A caller MAY name the probe (a device reachable from more than one);
   * the service falls back to the device's when they do not, and tenancy-
   * checks the one they named. So the column is creatable — the only
   * server-filled column that is.
   */
  test("a caller may pick the probe", () => {
    expect(accessControlFor("probeId").create).toContain(
      Permission.CreateNetworkDeviceDiagnostic,
    );
    expect(accessControlFor("probeId").create.length).toBeGreaterThan(0);
    expect(diagnostic.getRequiredColumns().columns).not.toContain("probeId");
  });

  /*
   * A row records ONE run. Its device, type and probe are what its result
   * describes; re-pointing any of them would leave a hostname and a result
   * that belong to the old ones. Nothing is updatable — not even by the
   * operator who asked for it.
   */
  test("nothing on the row is editable after create", () => {
    /*
     * TypeORM's own bookkeeping, declared on DatabaseBaseModel with the
     * framework's grants. Not this model's to decide, and never reachable
     * through a diagnostic's update path anyway.
     */
    const frameworkColumns: Array<string> = [
      "_id",
      "createdAt",
      "updatedAt",
      "deletedAt",
      "version",
    ];

    const editable: Array<string> = diagnostic
      .getTableColumns()
      .columns.filter((column: string) => {
        return !frameworkColumns.includes(column);
      })
      .filter((column: string) => {
        return (
          (diagnostic.getColumnAccessControlFor(column)?.update || []).length >
          0
        );
      });

    expect(editable).toEqual([]);
  });

  test("uses the four NetworkDeviceDiagnostic permissions for the four verbs", () => {
    expect(diagnostic.createRecordPermissions).toContain(
      Permission.CreateNetworkDeviceDiagnostic,
    );
    expect(diagnostic.readRecordPermissions).toContain(
      Permission.ReadNetworkDeviceDiagnostic,
    );
    expect(diagnostic.updateRecordPermissions).toContain(
      Permission.EditNetworkDeviceDiagnostic,
    );
    expect(diagnostic.deleteRecordPermissions).toContain(
      Permission.DeleteNetworkDeviceDiagnostic,
    );
  });

  test("is tenant-scoped by project and reachable on its own CRUD route", () => {
    expect(diagnostic.getTenantColumn()).toBe("projectId");
    expect(diagnostic.getCrudApiPath()?.toString()).toBe(
      "/network-device-diagnostic",
    );
  });

  /*
   * Unregistered is inert: a model missing from the index gets no table and
   * no migration, and the failure is silent at boot.
   */
  test("is registered in the DatabaseModels index", () => {
    expect(AllModelTypes).toContain(NetworkDeviceDiagnostic);
  });
});
