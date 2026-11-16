/**
 * The two columns an Incoming Request monitor keeps its latest request in
 * (#6402).
 *
 * Monitor.incomingMonitorRequest is the copy people read - the overview,
 * the API, MCP, Terraform, workflow and runbook steps - cut as the
 * monitor's logs are, so everyone who reads the monitor may read it, a
 * Viewer included. Only the server writes it, from each request the monitor
 * receives: no create or update through the API may carry one (#6541).
 *
 * Monitor.incomingMonitorRequestAsReceived is the request as it came, for
 * the heartbeat job to judge again. Nobody reads or writes it through the
 * API: no role is on its lists, it is left out of the API reference, of
 * exports and of relation reads, and it is written by the server alone.
 */

import Monitor from "../../Models/DatabaseModels/Monitor";
import SchemaMigrations from "../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import DatabaseRequestType from "../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../Server/Types/Database/Permissions/ColumnPermission";
import ColumnWriteRefusedException from "../../Server/Types/Database/Permissions/ColumnWriteRefusedException";
import CreatePermission from "../../Server/Types/Database/Permissions/CreatePermission";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission, { UserTenantAccessPermission } from "../../Types/Permission";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import fs from "fs";
import path from "path";

const SCHEMA_MIGRATIONS_DIRECTORY: string = path.join(
  __dirname,
  "..",
  "..",
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
);

const MIGRATION_FILE: string =
  "1809080466402-AddIncomingMonitorRequestAsReceived";

const MIGRATION_CLASS: string =
  "AddIncomingMonitorRequestAsReceived1809080466402";

// The newest migration main had when this one was written.
const PREVIOUS_MIGRATION_CLASS: string =
  "KeepEditedDiscoveredDevices1809080463892";

function typeOrmColumn(propertyName: string): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find((column: ColumnMetadataArgs) => {
    return column.target === Monitor && column.propertyName === propertyName;
  });
}

function accessOf(column: string): {
  create?: Array<Permission>;
  read?: Array<Permission>;
  update?: Array<Permission>;
} {
  return new Monitor().getColumnAccessControlFor(column) || {};
}

// The migration's up() and down(), apart.
function migrationHalves(): { up: string; down: string } {
  const migration: string = fs.readFileSync(
    path.join(SCHEMA_MIGRATIONS_DIRECTORY, `${MIGRATION_FILE}.ts`),
    "utf8",
  );
  const downAt: number = migration.indexOf("public async down(");

  expect(downAt).toBeGreaterThan(0);

  return {
    up: migration.slice(0, downAt),
    down: migration.slice(downAt),
  };
}

describe("Monitor.incomingMonitorRequestAsReceived: the request as it came", () => {
  test("no role reads, creates or updates it", () => {
    const access: ReturnType<typeof accessOf> = accessOf(
      "incomingMonitorRequestAsReceived",
    );

    expect(access.create).toEqual([]);
    expect(access.read).toEqual([]);
    expect(access.update).toEqual([]);
  });

  /*
   * Not computed: the column check lets a computed column through on a
   * create (ColumnPermission.checkDataColumnPermissions), and a member's
   * create could then set the request the heartbeat judges. The writes
   * below are refused for that reason.
   */
  test("it is the server's: left out of the API reference and of relation reads, and not computed", () => {
    const metadata: TableColumnMetadata = new Monitor().getTableColumnMetadata(
      "incomingMonitorRequestAsReceived",
    );

    expect(metadata.type).toBe(TableColumnType.JSON);
    expect(metadata.computed).toBeFalsy();
    expect(metadata.hideColumnInDocumentation).toBe(true);
    expect(metadata.canReadOnRelationQuery).toBe(false);
  });

  test("it is a nullable jsonb column: a monitor no request reached holds none", () => {
    const column: ColumnMetadataArgs | undefined = typeOrmColumn(
      "incomingMonitorRequestAsReceived",
    );

    expect(column).toBeDefined();
    expect(column!.options.type).toBe("jsonb");
    expect(column!.options.nullable).toBe(true);
  });

  test("the migration adds it as jsonb, and down() drops it", () => {
    const { up, down } = migrationHalves();

    expect(up).toContain(
      'ALTER TABLE "Monitor" ADD "incomingMonitorRequestAsReceived" jsonb',
    );
    expect(down).toContain(
      'ALTER TABLE "Monitor" DROP COLUMN "incomingMonitorRequestAsReceived"',
    );
  });

  /*
   * Registered once, after the newest migration main had when it was
   * written. Not "last of all": every migration merged after it would fail
   * that. SchemaMigrationsOrdering holds the whole list in timestamp order.
   */
  test("the migration runs: it is registered once, after the migration before it", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: { name: string }): string => {
        return migration.name;
      },
    );

    expect(
      names.filter((name: string): boolean => {
        return name === MIGRATION_CLASS;
      }),
    ).toHaveLength(1);
    expect(names.indexOf(PREVIOUS_MIGRATION_CLASS)).toBeGreaterThan(-1);
    expect(names.indexOf(MIGRATION_CLASS)).toBeGreaterThan(
      names.indexOf(PREVIOUS_MIGRATION_CLASS),
    );

    const index: string = fs.readFileSync(
      path.join(SCHEMA_MIGRATIONS_DIRECTORY, "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      `import { ${MIGRATION_CLASS} } from "./${MIGRATION_FILE}";`,
    );
  });
});

/*
 * No write through the API sets the request as it came, whoever makes it:
 * the heartbeat judges it, and only the server's own hook-free writes may
 * set it (MonitorResource, MonitorService.rewriteLatestIncomingRequestForReaders).
 * A create is refused as an update is, for every role that may create or
 * update a monitor; OneUptime's own writes are not checked.
 */
describe("a write that carries the request as it came", () => {
  const PROJECT_ID: ObjectID = new ObjectID(
    "e6402000-0000-4000-8000-0000000000a1",
  );
  const USER_ID: ObjectID = new ObjectID(
    "e6402000-0000-4000-8000-0000000000a2",
  );

  const WRITERS: Array<Permission> = [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.MonitorAdmin,
    Permission.MonitorMember,
    Permission.CreateProjectMonitor,
    Permission.EditProjectMonitor,
  ];

  function memberWith(permission: Permission): DatabaseCommonInteractionProps {
    const tenantPermission: UserTenantAccessPermission = {
      projectId: PROJECT_ID,
      _type: "UserTenantAccessPermission",
      permissions: [
        {
          _type: "UserPermission",
          permission: permission,
          labelIds: [],
          isBlockPermission: false,
        },
      ],
    } as UserTenantAccessPermission;

    return {
      userId: USER_ID,
      tenantId: PROJECT_ID,
      userTenantAccessPermission: {
        [PROJECT_ID.toString()]: tenantPermission,
      },
    };
  }

  // A request a member made up, as the heartbeat would judge it, alone.
  function monitorCarrying(column: string): Monitor {
    const monitor: Monitor = new Monitor();
    (monitor as unknown as JSONObject)[column] = {
      requestMethod: "POST",
      requestBody: { status: "deployed" },
      checkedAt: "2099-01-01T00:00:00.000Z",
    };
    return monitor;
  }

  // The refused column's name, or "allowed", for a write carrying `column`.
  function columnCheckOf(
    column: string,
    permission: Permission,
    requestType: DatabaseRequestType,
  ): string {
    try {
      ColumnPermissions.checkDataColumnPermissions(
        Monitor,
        monitorCarrying(column),
        memberWith(permission),
        requestType,
      );
    } catch (error) {
      if (error instanceof ColumnWriteRefusedException) {
        return error.columnName;
      }

      throw error;
    }

    return "allowed";
  }

  function columnCheck(
    permission: Permission,
    requestType: DatabaseRequestType,
  ): string {
    return columnCheckOf(
      "incomingMonitorRequestAsReceived",
      permission,
      requestType,
    );
  }

  test.each(WRITERS)(
    "%s cannot create a monitor with it",
    (permission: Permission) => {
      expect(columnCheck(permission, DatabaseRequestType.Create)).toBe(
        "incomingMonitorRequestAsReceived",
      );
    },
  );

  test.each(WRITERS)("%s cannot update it", (permission: Permission) => {
    expect(columnCheck(permission, DatabaseRequestType.Update)).toBe(
      "incomingMonitorRequestAsReceived",
    );
  });

  test("a whole create is refused, and says no permission allows the column", () => {
    let refusal: unknown = null;

    try {
      CreatePermission.checkCreatePermissions(
        Monitor,
        monitorCarrying("incomingMonitorRequestAsReceived"),
        memberWith(Permission.ProjectOwner),
      );
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(ColumnWriteRefusedException);
    expect((refusal as ColumnWriteRefusedException).columnName).toBe(
      "incomingMonitorRequestAsReceived",
    );
    expect((refusal as Error).message).toContain("No permission allows it");
  });

  test("OneUptime's own create is not checked: the server writes it", () => {
    expect(() => {
      CreatePermission.checkCreatePermissions(
        Monitor,
        monitorCarrying("incomingMonitorRequestAsReceived"),
        { isRoot: true },
      );
    }).not.toThrow();
  });

  /*
   * The copy people read is the server's too (#6541): a create that carries
   * a made-up latest request is refused for every role that may create a
   * monitor, as an update is, so no monitor starts out showing a request it
   * never received, nor one the heartbeat could take for the latest.
   */
  test.each(WRITERS)(
    "%s cannot create a monitor with the copy people read either",
    (permission: Permission) => {
      expect(
        columnCheckOf(
          "incomingMonitorRequest",
          permission,
          DatabaseRequestType.Create,
        ),
      ).toBe("incomingMonitorRequest");
    },
  );

  test.each(WRITERS)(
    "%s cannot update the copy people read",
    (permission: Permission) => {
      expect(
        columnCheckOf(
          "incomingMonitorRequest",
          permission,
          DatabaseRequestType.Update,
        ),
      ).toBe("incomingMonitorRequest");
    },
  );

  test("a whole create that carries the copy people read is refused, and says no permission allows it", () => {
    let refusal: unknown = null;

    try {
      CreatePermission.checkCreatePermissions(
        Monitor,
        monitorCarrying("incomingMonitorRequest"),
        memberWith(Permission.ProjectOwner),
      );
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(ColumnWriteRefusedException);
    expect((refusal as ColumnWriteRefusedException).columnName).toBe(
      "incomingMonitorRequest",
    );
    expect((refusal as Error).message).toContain("No permission allows it");
  });

  test("OneUptime's own create may carry the copy people read: the server writes it", () => {
    expect(() => {
      CreatePermission.checkCreatePermissions(
        Monitor,
        monitorCarrying("incomingMonitorRequest"),
        { isRoot: true },
      );
    }).not.toThrow();
  });

  /*
   * Neither copy is computed: no create's own steps write either one, so
   * the check of the record as written holds a value in it to the empty
   * create list whoever set it, and nothing about a server-set column lets
   * it through (ColumnPermission.getComputedColumnsWithValue).
   */
  test("a create's value in either copy is no server-set column's", () => {
    for (const column of [
      "incomingMonitorRequest",
      "incomingMonitorRequestAsReceived",
    ]) {
      expect(
        ColumnPermissions.getComputedColumnsWithValue(
          new Monitor(),
          monitorCarrying(column),
        ),
      ).toEqual([]);
    }
  });
});

describe("Monitor.incomingMonitorRequest: the copy people read", () => {
  test.each([
    Permission.Viewer,
    Permission.MonitorViewer,
    Permission.ReadProjectMonitor,
    Permission.ProjectMember,
    Permission.ProjectAdmin,
    Permission.ProjectOwner,
  ])("%s still reads it: the overview shows it", (permission: Permission) => {
    expect(accessOf("incomingMonitorRequest").read).toContain(permission);
  });

  // Every request that comes in writes both copies (LatestIncomingRequest).
  test("nobody creates or updates it through the API: the server writes it, from each request", () => {
    expect(accessOf("incomingMonitorRequest").create).toEqual([]);
    expect(accessOf("incomingMonitorRequest").update).toEqual([]);
  });

  test("it is not computed: the server's writes of it make no create", () => {
    expect(
      new Monitor().getTableColumnMetadata("incomingMonitorRequest").computed,
    ).toBeFalsy();
  });

  test("its description says what it holds: cut as the logs are", () => {
    const metadata: TableColumnMetadata = new Monitor().getTableColumnMetadata(
      "incomingMonitorRequest",
    );

    expect(metadata.description).toContain("secrets masked");
    expect(metadata.description).toContain("no headers or body");
  });
});
