import LogRecordingRule from "../../Models/DatabaseModels/LogRecordingRule";
import TraceRecordingRule from "../../Models/DatabaseModels/TraceRecordingRule";
import AllModelTypes from "../../Models/DatabaseModels/Index";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import Dictionary from "../../Types/Dictionary";
import Permission, {
  PermissionGroup,
  PermissionHelper,
  PermissionProps,
} from "../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * A log recording rule is the trace recording rule's sibling, and who may
 * do what with one follows the trace rule exactly - the same roles, with
 * the log recording rule's own Create / Read / Edit / Delete permissions in
 * place of the trace rule's. On top of the trace rule's columns it carries
 * computedUntil, the worker's watermark, which no user may write; and it
 * has no sortOrder, which a trace rule keeps only for history (nothing
 * orders recording rules).
 */

const toLogPermission: (permission: Permission) => Permission = (
  permission: Permission,
): Permission => {
  return permission.replace(
    "TraceRecordingRule",
    "LogRecordingRule",
  ) as Permission;
};

const toLogPermissions: (
  permissions: Array<Permission> | undefined,
) => Array<Permission> = (
  permissions: Array<Permission> | undefined,
): Array<Permission> => {
  return (permissions || []).map(toLogPermission);
};

const logRule: LogRecordingRule = new LogRecordingRule();
const traceRule: TraceRecordingRule = new TraceRecordingRule();

const LOG_RECORDING_RULE_PERMISSIONS: Array<Permission> = [
  Permission.CreateProjectLogRecordingRule,
  Permission.ReadProjectLogRecordingRule,
  Permission.EditProjectLogRecordingRule,
  Permission.DeleteProjectLogRecordingRule,
];

describe("LogRecordingRule", () => {
  test("is a registered model, served over the CRUD API at /log-recording-rule", () => {
    expect(AllModelTypes).toContain(LogRecordingRule);
    expect(logRule.tableName).toBe("LogRecordingRule");
    expect(logRule.crudApiPath?.toString()).toBe("/log-recording-rule");
    expect(logRule.singularName).toBe("Log Recording Rule");
    expect(logRule.pluralName).toBe("Log Recording Rules");
  });

  test("grants the table the way the trace recording rule does, with its own permissions", () => {
    expect(logRule.createRecordPermissions).toEqual(
      toLogPermissions(traceRule.createRecordPermissions),
    );
    expect(logRule.readRecordPermissions).toEqual(
      toLogPermissions(traceRule.readRecordPermissions),
    );
    expect(logRule.updateRecordPermissions).toEqual(
      toLogPermissions(traceRule.updateRecordPermissions),
    );
    expect(logRule.deleteRecordPermissions).toEqual(
      toLogPermissions(traceRule.deleteRecordPermissions),
    );

    expect(logRule.createRecordPermissions).toContain(
      Permission.CreateProjectLogRecordingRule,
    );
    expect(logRule.readRecordPermissions).toContain(
      Permission.ReadProjectLogRecordingRule,
    );
  });

  test("grants every column it shares with the trace recording rule the same way", () => {
    const traceColumns: Dictionary<ColumnAccessControl> =
      traceRule.getColumnAccessControlForAllColumns();
    const logColumns: Dictionary<ColumnAccessControl> =
      logRule.getColumnAccessControlForAllColumns();

    const shared: Array<string> = Object.keys(logColumns).filter(
      (column: string): boolean => {
        return Boolean(traceColumns[column]);
      },
    );

    // Every column of the trace rule but sortOrder, base columns included.
    expect(shared.sort()).toEqual(
      [
        "_id",
        "createdAt",
        "updatedAt",
        "deletedAt",
        "createdByUser",
        "createdByUserId",
        "definition",
        "deletedByUser",
        "deletedByUserId",
        "description",
        "isEnabled",
        "name",
        "outputMetricName",
        "project",
        "projectId",
      ].sort(),
    );

    for (const column of shared) {
      const trace: ColumnAccessControl = traceColumns[column]!;
      const log: ColumnAccessControl = logColumns[column]!;

      expect({ column, create: log.create }).toEqual({
        column,
        create: toLogPermissions(trace.create),
      });
      expect({ column, read: log.read }).toEqual({
        column,
        read: toLogPermissions(trace.read),
      });
      expect({ column, update: log.update }).toEqual({
        column,
        update: toLogPermissions(trace.update),
      });
    }
  });

  test("its watermark is readable by whoever reads the rule, and written by the worker alone", () => {
    const access: ColumnAccessControl | null =
      logRule.getColumnAccessControlFor("computedUntil");

    expect(access).not.toBeNull();
    expect(access!.create).toEqual([]);
    expect(access!.update).toEqual([]);
    expect(access!.read).toEqual(logRule.readRecordPermissions);
    expect(logRule.getTableColumnMetadata("computedUntil").required).toBe(
      false,
    );
  });

  test("keeps no sort order: every enabled rule is evaluated on its own", () => {
    expect(Object.keys(logRule.getTableColumns())).not.toContain("sortOrder");
  });
});

describe("the log recording rule permissions", () => {
  test("are in the catalogue, in the Telemetry group, assignable like the trace rule's", () => {
    const props: Array<PermissionProps> =
      PermissionHelper.getAllPermissionProps();

    for (const permission of LOG_RECORDING_RULE_PERMISSIONS) {
      const entry: PermissionProps | undefined = props.find(
        (candidate: PermissionProps): boolean => {
          return candidate.permission === permission;
        },
      );
      const traceEntry: PermissionProps | undefined = props.find(
        (candidate: PermissionProps): boolean => {
          return (
            candidate.permission ===
            (permission.replace(
              "LogRecordingRule",
              "TraceRecordingRule",
            ) as Permission)
          );
        },
      );

      expect(entry).toBeDefined();
      expect(traceEntry).toBeDefined();
      expect(entry!.title).toMatch(/Log Recording Rule$/);
      expect(entry!.group).toBe(PermissionGroup.Telemetry);
      expect({
        isAssignableToTenant: entry!.isAssignableToTenant,
        isAccessControlPermission: entry!.isAccessControlPermission,
        isRolePermission: entry!.isRolePermission,
      }).toEqual({
        isAssignableToTenant: traceEntry!.isAssignableToTenant,
        isAccessControlPermission: traceEntry!.isAccessControlPermission,
        isRolePermission: traceEntry!.isRolePermission,
      });
    }
  });
});
