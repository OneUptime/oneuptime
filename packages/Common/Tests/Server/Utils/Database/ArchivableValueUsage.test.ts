import Entities from "../../../../Models/DatabaseModels/Index";
import ArchivableValueUsage, {
  JSON_USAGE_COLUMNS,
  JsonUsageColumn,
  USAGE_COUNT_CAP,
  ValueReference,
  getEffect,
  isSettingsReference,
} from "../../../../Server/Utils/Database/ArchivableValueUsage";
import {
  ArchivableValueDeleteEffect,
  ArchivableValueUsageItem,
  ArchivableValueUsageKind,
} from "../../../../Types/ArchivableValue/ArchivableValueUsage";
import ObjectID from "../../../../Types/ObjectID";
import { ARCHIVABLE_VALUE_TABLE_NAMES } from "../../../../Utils/ArchivableValues";
import { DataSource, EntityMetadata } from "typeorm";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * ArchivableValueUsage: what uses a state, severity, monitor status, label
 * or incident role, and what deleting it would do to each. The references
 * are read from the real models' TypeORM metadata (built offline, as the
 * schema drift check holds it to the database); the counts run against a
 * data source whose query() records the SQL and answers with set counts.
 * The SQL itself runs against Postgres in ArchivableValuesPostgres.
 */

const VALUE_ID: string = "0193c0de-cccc-4ccc-8ccc-0000000000a1";
const PROJECT_ID: string = "0193c0de-cccc-4ccc-8ccc-0000000000b1";

let dataSource: DataSource;

beforeAll(async () => {
  dataSource = new DataSource({
    type: "postgres",
    entities: Entities,
    synchronize: false,
  });

  await (
    dataSource as unknown as { buildMetadatas: () => Promise<void> }
  ).buildMetadatas();
});

const referencesOf: (valueTable: string) => Array<ValueReference> = (
  valueTable: string,
): Array<ValueReference> => {
  return ArchivableValueUsage.getReferences({
    dataSource: dataSource,
    valueTable: valueTable,
  });
};

const referenceTo: (
  valueTable: string,
  recordTable: string,
  recordProperty: string,
) => ValueReference = (
  valueTable: string,
  recordTable: string,
  recordProperty: string,
): ValueReference => {
  const found: ValueReference | undefined = referencesOf(valueTable).find(
    (reference: ValueReference) => {
      return (
        reference.recordTable === recordTable &&
        reference.recordProperty === recordProperty
      );
    },
  );

  if (!found) {
    throw new Error(
      `${recordTable}.${recordProperty} -> ${valueTable} not found`,
    );
  }

  return found;
};

describe("the references to a value, from the models' metadata", () => {
  test("an incident's severity: the delete is refused while incidents have it", () => {
    expect(
      referenceTo("IncidentSeverity", "Incident", "incidentSeverity"),
    ).toEqual({
      countTable: "Incident",
      countColumn: "incidentSeverityId",
      hasProjectColumn: true,
      hasDeletedAtColumn: true,
      recordTable: "Incident",
      recordProperty: "incidentSeverity",
      title: "Incidents",
      singularTitle: "Incident",
      isList: false,
      effect: ArchivableValueDeleteEffect.Refused,
      kind: ArchivableValueUsageKind.Records,
    });
  });

  test("a state's history rows are deleted with the state", () => {
    const reference: ValueReference = referenceTo(
      "IncidentState",
      "IncidentStateTimeline",
      "incidentState",
    );

    expect(reference.effect).toBe(ArchivableValueDeleteEffect.Deleted);
    expect(reference.kind).toBe(ArchivableValueUsageKind.Records);
    expect(
      referenceTo("AlertState", "AlertStateTimeline", "alertState").effect,
    ).toBe(ArchivableValueDeleteEffect.Deleted);
    expect(
      referenceTo("MonitorStatus", "MonitorStatusTimeline", "monitorStatus")
        .effect,
    ).toBe(ArchivableValueDeleteEffect.Deleted);
    expect(
      referenceTo(
        "ScheduledMaintenanceState",
        "ScheduledMaintenanceStateTimeline",
        "scheduledMaintenanceState",
      ).effect,
    ).toBe(ArchivableValueDeleteEffect.Deleted);
  });

  test("a public note's state is cleared", () => {
    expect(
      referenceTo(
        "IncidentState",
        "IncidentPublicNote",
        "postedWithIncidentState",
      ).effect,
    ).toBe(ArchivableValueDeleteEffect.Cleared);
  });

  test("a label comes off every list it is in: counted in the join table", () => {
    expect(referenceTo("Label", "Monitor", "labels")).toMatchObject({
      countTable: "MonitorLabel",
      countColumn: "labelId",
      hasProjectColumn: false,
      hasDeletedAtColumn: false,
      isList: true,
      effect: ArchivableValueDeleteEffect.RemovedFromList,
      kind: ArchivableValueUsageKind.Records,
      title: "Monitors",
    });
  });

  test("templates, rules, measurements and permissions are settings", () => {
    expect(
      referenceTo("IncidentSeverity", "IncidentTemplate", "incidentSeverity"),
    ).toMatchObject({
      kind: ArchivableValueUsageKind.Settings,
      effect: ArchivableValueDeleteEffect.Refused,
    });
    expect(
      referenceTo(
        "IncidentSeverity",
        "UserNotificationRule",
        "incidentSeverity",
      ),
    ).toMatchObject({
      kind: ArchivableValueUsageKind.Settings,
      effect: ArchivableValueDeleteEffect.Deleted,
    });
    expect(
      referenceTo("IncidentState", "IncidentMeasurement", "startIncidentState")
        .kind,
    ).toBe(ArchivableValueUsageKind.Settings);
    expect(referenceTo("Label", "IncidentLabelRule", "labelsToAdd").kind).toBe(
      ArchivableValueUsageKind.Settings,
    );

    for (const permission of [
      "ApiKeyPermission",
      "TeamPermission",
      "CustomRolePermission",
    ]) {
      expect(referenceTo("Label", permission, "labels").kind).toBe(
        ArchivableValueUsageKind.Settings,
      );
    }
  });

  test("lists and fields on records that set things up are settings too", () => {
    for (const [valueTable, recordTable, recordProperty] of [
      ["MonitorStatus", "StatusPage", "downtimeMonitorStatuses"],
      ["MonitorStatus", "ServiceLevelObjective", "downtimeMonitorStatuses"],
      ["MonitorStatus", "Monitor", "suppressAlertsWhenParentMonitorStatuses"],
      ["Label", "ServiceLevelObjective", "monitorLabels"],
      ["AlertSeverity", "NetworkSite", "alertSeverity"],
      ["IncidentSeverity", "Project", "incidentInvestigationMinimumSeverity"],
    ] as Array<[string, string, string]>) {
      expect(referenceTo(valueTable, recordTable, recordProperty).kind).toBe(
        ArchivableValueUsageKind.Settings,
      );
    }

    // ...while the records themselves are records.
    expect(referenceTo("Label", "ServiceLevelObjective", "labels").kind).toBe(
      ArchivableValueUsageKind.Records,
    );
    expect(referenceTo("Label", "Incident", "labels").kind).toBe(
      ArchivableValueUsageKind.Records,
    );
  });

  test("never the value's own table: who archived or created it is a person", () => {
    for (const valueTable of ARCHIVABLE_VALUE_TABLE_NAMES) {
      for (const reference of referencesOf(valueTable)) {
        expect(reference.recordTable).not.toBe(valueTable);
      }
    }
  });

  test("every value has references, each counted by a real column", () => {
    for (const valueTable of ARCHIVABLE_VALUE_TABLE_NAMES) {
      const references: Array<ValueReference> = referencesOf(valueTable);

      expect(references.length).toBeGreaterThan(0);

      for (const reference of references) {
        const metadata: EntityMetadata | undefined =
          dataSource.entityMetadatas.find((candidate: EntityMetadata) => {
            return candidate.tableName === reference.countTable;
          });

        expect(metadata).toBeDefined();
        expect(
          metadata!.columns.some((column: { databaseName: string }) => {
            return column.databaseName === reference.countColumn;
          }),
        ).toBe(true);
      }
    }
  });

  test("are read once per data source and value", () => {
    expect(referencesOf("Label")).toBe(referencesOf("Label"));
  });
});

describe("the helpers the references are classified with", () => {
  test("a delete's effect, by the foreign key's ON DELETE", () => {
    expect(getEffect("CASCADE")).toBe(ArchivableValueDeleteEffect.Deleted);
    expect(getEffect("cascade")).toBe(ArchivableValueDeleteEffect.Deleted);
    expect(getEffect("SET NULL")).toBe(ArchivableValueDeleteEffect.Cleared);
    expect(getEffect("SET DEFAULT")).toBe(ArchivableValueDeleteEffect.Cleared);
    expect(getEffect("NO ACTION")).toBe(ArchivableValueDeleteEffect.Refused);
    expect(getEffect("RESTRICT")).toBe(ArchivableValueDeleteEffect.Refused);
    // TypeORM's default is NO ACTION.
    expect(getEffect(undefined)).toBe(ArchivableValueDeleteEffect.Refused);
  });

  test("settings by table suffix or by the exact reference", () => {
    expect(isSettingsReference("IncidentOwnerRule", "incidentLabels")).toBe(
      true,
    );
    expect(isSettingsReference("MonitorTemplate", "labels")).toBe(true);
    expect(isSettingsReference("TeamComplianceSetting", "x")).toBe(true);
    expect(isSettingsReference("ThreatIntelFeed", "x")).toBe(true);
    expect(isSettingsReference("TeamPermission", "labels")).toBe(true);
    expect(isSettingsReference("StatusPage", "downtimeMonitorStatuses")).toBe(
      true,
    );
    expect(isSettingsReference("StatusPage", "labels")).toBe(false);
    expect(isSettingsReference("Incident", "incidentSeverity")).toBe(false);
  });
});

interface QueryCall {
  sql: string;
  parameters: Array<string>;
}

const countingSource: (countFor: (call: QueryCall) => number) => {
  source: DataSource;
  calls: Array<QueryCall>;
} = (
  countFor: (call: QueryCall) => number,
): { source: DataSource; calls: Array<QueryCall> } => {
  const calls: Array<QueryCall> = [];

  const source: DataSource = Object.create(dataSource) as DataSource;

  (source as unknown as { query: unknown }).query = async (
    sql: string,
    parameters: Array<string>,
  ): Promise<Array<{ count: string }>> => {
    const call: QueryCall = { sql, parameters };
    calls.push(call);

    return [{ count: String(countFor(call)) }];
  };

  return { source, calls };
};

describe("counting a value's uses", () => {
  test("narrows a record's count to the project and leaves deleted ones out, capped one past the cap", async () => {
    const { source, calls } = countingSource((call: QueryCall) => {
      return call.sql.includes('FROM "Incident" WHERE') ? 3 : 0;
    });

    const items: Array<ArchivableValueUsageItem> =
      await ArchivableValueUsage.countUses({
        dataSource: source,
        valueTable: "IncidentSeverity",
        valueId: new ObjectID(VALUE_ID),
        projectId: new ObjectID(PROJECT_ID),
      });

    const incidentCall: QueryCall | undefined = calls.find(
      (call: QueryCall) => {
        return call.sql.includes('FROM "Incident" WHERE');
      },
    );

    expect(incidentCall).toEqual({
      sql: `SELECT COUNT(*) AS "count" FROM (SELECT 1 FROM "Incident" WHERE "incidentSeverityId" = $1 AND "projectId" = $2 AND "deletedAt" IS NULL LIMIT ${USAGE_COUNT_CAP + 1}) AS "uses"`,
      parameters: [VALUE_ID, PROJECT_ID],
    });

    expect(items).toEqual([
      {
        tableName: "Incident",
        title: "Incidents",
        singularTitle: "Incident",
        count: 3,
        isCountCapped: false,
        effect: ArchivableValueDeleteEffect.Refused,
        kind: ArchivableValueUsageKind.Records,
      },
    ]);
  });

  test("a list is counted in its join table by the value's id alone", async () => {
    const { source, calls } = countingSource(() => {
      return 0;
    });

    await ArchivableValueUsage.countUses({
      dataSource: source,
      valueTable: "Label",
      valueId: new ObjectID(VALUE_ID),
      projectId: new ObjectID(PROJECT_ID),
    });

    expect(
      calls.find((call: QueryCall) => {
        return call.sql.includes('FROM "MonitorLabel"');
      }),
    ).toEqual({
      sql: `SELECT COUNT(*) AS "count" FROM (SELECT 1 FROM "MonitorLabel" WHERE "labelId" = $1 LIMIT ${USAGE_COUNT_CAP + 1}) AS "uses"`,
      parameters: [VALUE_ID],
    });
  });

  test("ids in criteria, rule assignments and workflows: matched in the JSON's text, lower-cased", async () => {
    const { source, calls } = countingSource((call: QueryCall) => {
      return call.sql.includes('"monitorSteps"::text') &&
        call.sql.includes('FROM "Monitor" WHERE')
        ? 2
        : 0;
    });

    const items: Array<ArchivableValueUsageItem> =
      await ArchivableValueUsage.countUses({
        dataSource: source,
        valueTable: "IncidentSeverity",
        valueId: new ObjectID(VALUE_ID.toUpperCase()),
        projectId: new ObjectID(PROJECT_ID),
      });

    const monitorCall: QueryCall | undefined = calls.find((call: QueryCall) => {
      return (
        call.sql.includes('"monitorSteps"::text') &&
        call.sql.includes('FROM "Monitor" WHERE')
      );
    });

    expect(monitorCall!.sql).toBe(
      `SELECT COUNT(*) AS "count" FROM (SELECT 1 FROM "Monitor" WHERE "projectId" = $1 AND "deletedAt" IS NULL AND "monitorSteps"::text LIKE $2 LIMIT ${USAGE_COUNT_CAP + 1}) AS "uses"`,
    );
    expect(monitorCall!.parameters).toEqual([PROJECT_ID, `%${VALUE_ID}%`]);

    expect(items).toEqual([
      {
        tableName: "Monitor",
        title: "Monitors",
        singularTitle: "Monitor",
        count: 2,
        isCountCapped: false,
        effect: ArchivableValueDeleteEffect.LeftDangling,
        kind: ArchivableValueUsageKind.Settings,
      },
    ]);
  });

  test("reads only the JSON columns that can hold this kind of value", async () => {
    const { source, calls } = countingSource(() => {
      return 0;
    });

    await ArchivableValueUsage.countUses({
      dataSource: source,
      valueTable: "IncidentState",
      valueId: new ObjectID(VALUE_ID),
      projectId: new ObjectID(PROJECT_ID),
    });

    const jsonReads: Array<string> = calls
      .filter((call: QueryCall) => {
        return call.sql.includes("::text LIKE");
      })
      .map((call: QueryCall) => {
        return call.sql;
      });

    // Only a workflow's steps hold incident state ids.
    expect(jsonReads).toHaveLength(1);
    expect(jsonReads[0]).toContain('FROM "Workflow"');
    expect(jsonReads[0]).toContain('"graph"::text');
  });

  test("every JSON column is a real column of its table", () => {
    for (const jsonColumn of JSON_USAGE_COLUMNS as Array<JsonUsageColumn>) {
      const metadata: EntityMetadata | undefined =
        dataSource.entityMetadatas.find((candidate: EntityMetadata) => {
          return candidate.tableName === jsonColumn.tableName;
        });

      expect(metadata).toBeDefined();
      expect(
        metadata!.columns.some((column: { databaseName: string }) => {
          return column.databaseName === jsonColumn.column;
        }),
      ).toBe(true);
      expect(
        metadata!.columns.some((column: { databaseName: string }) => {
          return column.databaseName === "projectId";
        }),
      ).toBe(true);

      for (const valueTable of jsonColumn.valueTables) {
        expect(ARCHIVABLE_VALUE_TABLE_NAMES).toContain(valueTable);
      }
    }
  });

  test("a count past the cap stops at it, and says there are more", async () => {
    const { source } = countingSource((call: QueryCall) => {
      return call.sql.includes('FROM "Incident" WHERE')
        ? USAGE_COUNT_CAP + 1
        : 0;
    });

    const items: Array<ArchivableValueUsageItem> =
      await ArchivableValueUsage.countUses({
        dataSource: source,
        valueTable: "IncidentSeverity",
        valueId: new ObjectID(VALUE_ID),
        projectId: new ObjectID(PROJECT_ID),
      });

    expect(items[0]).toMatchObject({
      count: USAGE_COUNT_CAP,
      isCountCapped: true,
    });
  });

  test("an id that is not a uuid reads nothing", async () => {
    const { source, calls } = countingSource(() => {
      return 1;
    });

    expect(
      await ArchivableValueUsage.countUses({
        dataSource: source,
        valueTable: "Label",
        valueId: new ObjectID("not-a-uuid"),
        projectId: new ObjectID(PROJECT_ID),
      }),
    ).toEqual([]);
    expect(calls).toEqual([]);
  });

  test("a count the database answers oddly is no use", async () => {
    const { source } = countingSource(() => {
      return Number.NaN;
    });

    expect(
      await ArchivableValueUsage.countUses({
        dataSource: source,
        valueTable: "IncidentRole",
        valueId: new ObjectID(VALUE_ID),
        projectId: new ObjectID(PROJECT_ID),
      }),
    ).toEqual([]);
  });
});

describe("one line per table and effect", () => {
  const item: (
    overrides: Partial<ArchivableValueUsageItem>,
  ) => ArchivableValueUsageItem = (
    overrides: Partial<ArchivableValueUsageItem>,
  ): ArchivableValueUsageItem => {
    return {
      tableName: "IncidentTemplate",
      title: "Incident Templates",
      singularTitle: "Incident Template",
      count: 1,
      isCountCapped: false,
      effect: ArchivableValueDeleteEffect.RemovedFromList,
      kind: ArchivableValueUsageKind.Settings,
      ...overrides,
    };
  };

  test("the larger count of the ways the same records reach it", () => {
    expect(
      ArchivableValueUsage.mergeByTable([
        item({ count: 2 }),
        item({ count: 5 }),
        item({ count: 4, isCountCapped: true }),
      ]),
    ).toEqual([item({ count: 5, isCountCapped: true })]);
  });

  test("a different effect or kind is its own line", () => {
    expect(
      ArchivableValueUsage.mergeByTable([
        item({}),
        item({ effect: ArchivableValueDeleteEffect.Refused }),
        item({ kind: ArchivableValueUsageKind.Records }),
        item({ tableName: "Incident" }),
      ]),
    ).toHaveLength(4);
  });

  test("does not change the items it was given", () => {
    const first: ArchivableValueUsageItem = item({ count: 1 });

    ArchivableValueUsage.mergeByTable([first, item({ count: 9 })]);

    expect(first.count).toBe(1);
  });
});
