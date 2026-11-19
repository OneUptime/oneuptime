import { describe, expect, test } from "@jest/globals";
import { QueryRunner } from "typeorm";
import Models from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Host from "../../../Models/DatabaseModels/Host";
import HostLogSession from "../../../Models/DatabaseModels/HostLogSession";
import { AddHostLogSessions1809186400000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1809186400000-AddHostLogSessions";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import EnableAuditLogOn from "../../../Types/BaseDatabase/EnableAuditLogOn";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import {
  HostLogSessionLevel,
  HostLogSessionStatus,
} from "../../../Types/Host/HostLogSession";
import Permission from "../../../Types/Permission";

/*
 * Issue #9806: the record of a log session - every app's logs from an
 * Android device for a while. Asking for one reads every app's logs on a
 * device, so it takes the right to change the host; a person's only other
 * change is to cancel it; the device and OneUptime write the rest; nobody
 * deletes the record of who read a device's logs; and every request and
 * cancel is in the host's audit log.
 */

const model: HostLogSession = new HostLogSession();

function sorted(permissions: Array<Permission> | undefined): Array<string> {
  return [...(permissions || [])].map(String).sort();
}

function columnAccess(column: string): ColumnAccessControl {
  return model.getColumnAccessControlFor(column) as ColumnAccessControl;
}

describe("HostLogSession", () => {
  test("is a model OneUptime knows", () => {
    expect(
      Models.some((modelType: { new (): BaseModel }): boolean => {
        return modelType === HostLogSession;
      }),
    ).toBe(true);
    expect(model.tableName).toBe("HostLogSession");
    expect(model.singularName).toBe("Log Session");
  });

  test("asking takes the right to change the host; reading, the right to read it", () => {
    expect(sorted(model.createRecordPermissions)).toEqual(
      sorted([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.EditHost,
      ]),
    );
    expect(sorted(model.readRecordPermissions)).toEqual(
      sorted([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.Viewer,
        Permission.ReadHost,
      ]),
    );
    expect(sorted(model.updateRecordPermissions)).toEqual(
      sorted(model.createRecordPermissions),
    );
    expect(model.deleteRecordPermissions).toEqual([]);
  });

  test("a person writes the device, how long and at what level, then only the status", () => {
    for (const column of ["hostId", "durationMinutes", "minimumLevel"]) {
      expect(sorted(columnAccess(column).create)).toEqual(
        sorted(model.createRecordPermissions),
      );
      expect(columnAccess(column).update).toEqual([]);
    }

    expect(columnAccess("status").create).toEqual([]);
    expect(sorted(columnAccess("status").update)).toEqual(
      sorted(model.updateRecordPermissions),
    );

    for (const column of [
      "expiresAt",
      "startedAt",
      "endsAt",
      "endedAt",
      "statusMessage",
    ]) {
      expect(columnAccess(column).create).toEqual([]);
      expect(columnAccess(column).update).toEqual([]);
    }
  });

  test("its status and level say the values they take", () => {
    const status: TableColumnMetadata = model.getTableColumnMetadata("status");
    const level: TableColumnMetadata =
      model.getTableColumnMetadata("minimumLevel");

    expect(status.allowedValues).toEqual(Object.values(HostLogSessionStatus));
    expect(level.allowedValues).toEqual(Object.values(HostLogSessionLevel));
  });

  test("every request and cancel is in its host's audit log", () => {
    const audit: EnableAuditLogOn | undefined = model.enableAuditLogOn;

    expect(audit?.create).toBe(true);
    expect(audit?.update).toBe(true);
    expect(audit?.rootResource).toEqual({
      resourceType: new Host().singularName,
      column: "hostId",
    });
  });
});

describe("AddHostLogSessions1809186400000", () => {
  async function statements(direction: "up" | "down"): Promise<Array<string>> {
    const run: Array<string> = [];
    const runner: QueryRunner = {
      query: (sql: string): Promise<undefined> => {
        run.push(String(sql).trim());
        return Promise.resolve(undefined);
      },
    } as unknown as QueryRunner;

    await new AddHostLogSessions1809186400000()[direction](runner);
    return run;
  }

  test("makes the table, its indexes and its keys, while it is empty", async () => {
    const up: Array<string> = await statements("up");

    expect(up[0]).toMatch(/^CREATE TABLE "HostLogSession" \(/);
    expect(up[0]).toContain(
      `"status" character varying(100) NOT NULL DEFAULT 'Requested'`,
    );
    expect(up[0]).toContain(`"durationMinutes" integer NOT NULL DEFAULT '30'`);
    expect(up[0]).toContain(
      `"minimumLevel" character varying(100) NOT NULL DEFAULT 'info'`,
    );
    expect(
      up.filter((statement: string): boolean => {
        return statement.startsWith(
          `ALTER TABLE "HostLogSession" ADD CONSTRAINT`,
        );
      }),
    ).toHaveLength(3);
    expect(up.join("\n")).toContain(`ON DELETE CASCADE`);
  });

  test("down drops the table", async () => {
    const down: Array<string> = await statements("down");

    expect(down[down.length - 1]).toBe(`DROP TABLE "HostLogSession"`);
  });

  test("is registered, last", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: unknown): string => {
        return (migration as { name: string }).name;
      },
    );

    expect(names).toContain("AddHostLogSessions1809186400000");
    expect(names.indexOf("AddHostLogSessions1809186400000")).toBeGreaterThan(
      names.indexOf("AddDataAssetEntitySetName1809186396960"),
    );
  });
});
