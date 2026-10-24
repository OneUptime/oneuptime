import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentPostmortemStatus from "../../../Models/DatabaseModels/IncidentPostmortemStatus";
import SecurityCasePriority from "../../../Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "../../../Models/DatabaseModels/SecurityCaseStatus";
import IncidentRole from "../../../Models/DatabaseModels/IncidentRole";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Label from "../../../Models/DatabaseModels/Label";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import User from "../../../Models/DatabaseModels/User";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import UserAttribution, {
  ATTRIBUTED_SWITCHES,
  AttributedSwitch,
} from "../../../Types/Database/UserAttribution";
import Permission from "../../../Types/Permission";
import {
  ARCHIVED_AT_COLUMN,
  ARCHIVED_BY_USER_ID_COLUMN,
  ARCHIVED_COLUMN,
  ARCHIVABLE_VALUE_DEFINITIONS,
  ArchivableValueDefinition,
  getArchivableValueByTableName,
  getArchivableValueProtectionColumns,
} from "../../../Utils/ArchivableValues";
import { describe, expect, test } from "@jest/globals";

/*
 * The eleven models whose rows are values records pick from, as archiving
 * needs them: one switch and two stamps of the same shape every archivable
 * resource has, open to whoever may edit the value and to every read that
 * reaches one through a record, stamped by OneUptime alone, and in the
 * audit log.
 */

type ModelType = { new (): DatabaseBaseModel };

const MODELS: Array<{ name: string; modelType: ModelType }> = [
  { name: "IncidentState", modelType: IncidentState },
  { name: "IncidentSeverity", modelType: IncidentSeverity },
  { name: "AlertState", modelType: AlertState },
  { name: "AlertSeverity", modelType: AlertSeverity },
  { name: "MonitorStatus", modelType: MonitorStatus },
  { name: "ScheduledMaintenanceState", modelType: ScheduledMaintenanceState },
  { name: "Label", modelType: Label },
  { name: "IncidentRole", modelType: IncidentRole },
  { name: "IncidentPostmortemStatus", modelType: IncidentPostmortemStatus },
  { name: "SecurityCaseStatus", modelType: SecurityCaseStatus },
  { name: "SecurityCasePriority", modelType: SecurityCasePriority },
];

const sorted: (permissions: Array<Permission> | undefined) => Array<string> = (
  permissions: Array<Permission> | undefined,
): Array<string> => {
  return [...(permissions || [])].map(String).sort();
};

test("the models are the registry's eleven values, by table", () => {
  expect(
    MODELS.map(({ modelType }: { modelType: ModelType }): string => {
      return new modelType().tableName || "";
    }).sort(),
  ).toEqual(
    ARCHIVABLE_VALUE_DEFINITIONS.map(
      (definition: ArchivableValueDefinition): string => {
        return definition.tableName;
      },
    ).sort(),
  );
});

describe.each(MODELS)("$name", ({ modelType }: { modelType: ModelType }) => {
  const model: DatabaseBaseModel = new modelType();
  const metadata: (column: string) => TableColumnMetadata = (
    column: string,
  ): TableColumnMetadata => {
    const found: TableColumnMetadata | undefined =
      model.getTableColumnMetadata(column);

    if (!found) {
      throw new Error(`${model.tableName}.${column} is not a column`);
    }

    return found;
  };

  test("isArchived is a required switch, false by default, readable through a record", () => {
    expect(metadata(ARCHIVED_COLUMN)).toMatchObject({
      type: TableColumnType.Boolean,
      isDefaultValueColumn: true,
      required: true,
      defaultValue: false,
      canReadOnRelationQuery: true,
    });
    expect(metadata(ARCHIVED_COLUMN).title).toBe("Is Archived");
    expect(metadata(ARCHIVED_COLUMN).description).toBeTruthy();
  });

  test("archivedAt, archivedByUser and archivedByUserId say when and who", () => {
    expect(metadata(ARCHIVED_AT_COLUMN).type).toBe(TableColumnType.Date);
    expect(metadata("archivedByUser")).toMatchObject({
      type: TableColumnType.Entity,
      modelType: User,
    });
    expect(metadata(ARCHIVED_BY_USER_ID_COLUMN).type).toBe(
      TableColumnType.ObjectID,
    );
  });

  test("whoever may edit a value may archive it: the switch is gated like its name", () => {
    const name: ColumnAccessControl | null =
      model.getColumnAccessControlFor("name");
    const archived: ColumnAccessControl | null =
      model.getColumnAccessControlFor(ARCHIVED_COLUMN);

    expect(name).toBeTruthy();
    expect(archived).toBeTruthy();
    expect(sorted(archived!.create)).toEqual(sorted(name!.create));
    expect(sorted(archived!.read)).toEqual(sorted(name!.read));
    expect(sorted(archived!.update)).toEqual(sorted(name!.update));
  });

  test("who archived it and when are read like the switch, and written by OneUptime alone", () => {
    const archived: ColumnAccessControl | null =
      model.getColumnAccessControlFor(ARCHIVED_COLUMN);

    for (const column of [
      ARCHIVED_AT_COLUMN,
      "archivedByUser",
      ARCHIVED_BY_USER_ID_COLUMN,
    ]) {
      const access: ColumnAccessControl | null =
        model.getColumnAccessControlFor(column);

      expect(sorted(access?.read)).toEqual(sorted(archived!.read));
      expect(access?.create || []).toEqual([]);
      expect(access?.update || []).toEqual([]);
      expect(UserAttribution.getColumns(model)).toContain(column);
    }
  });

  test("the archive switch stamps who turned it and when", () => {
    const attributed: AttributedSwitch | undefined = ATTRIBUTED_SWITCHES.find(
      (attributedSwitch: AttributedSwitch): boolean => {
        return attributedSwitch.switchColumn === ARCHIVED_COLUMN;
      },
    );

    expect(attributed).toEqual({
      switchColumn: ARCHIVED_COLUMN,
      atColumn: ARCHIVED_AT_COLUMN,
      byUserColumn: ARCHIVED_BY_USER_ID_COLUMN,
    });
  });

  test("archiving and unarchiving are in the audit log", () => {
    expect(model.enableAuditLogOn).toMatchObject({
      create: true,
      update: true,
      delete: true,
    });
  });

  test("every protection column is a boolean column of the model", () => {
    const definition: ArchivableValueDefinition | null =
      getArchivableValueByTableName(model.tableName);

    expect(definition).not.toBeNull();

    for (const column of getArchivableValueProtectionColumns(definition!)) {
      expect(metadata(column).type).toBe(TableColumnType.Boolean);
    }
  });
});
