import Entities from "../../../../Models/DatabaseModels/Index";
import ArchivableValueUsage, {
  JSON_USAGE_COLUMNS,
  JsonUsageColumn,
  SETTINGS_REFERENCES,
  USAGE_COUNT_CAP,
  UsageSource,
  ValueReference,
  getEffect,
  getPersonColumn,
  getProjectColumn,
  isSettingsReference,
} from "../../../../Server/Utils/Database/ArchivableValueUsage";
import ProjectMembership from "../../../../Server/Utils/TeamMember/ProjectMembership";
import {
  ArchivableValueDeleteEffect,
  ArchivableValueUsageItem,
  ArchivableValueUsageKind,
  ArchivableValuesUsage,
  ArchivableValuesUsagePurpose,
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
 *
 * The maintainer's report: an incident severity's Archive dialog said
 * "Notification Rules (22)" in a project whose owners had set up two rules.
 * It counted the rows of every member's own on-call rules - one per
 * severity, kind and notification method - as settings of the project.
 * People's own settings are a kind of their own now, counted by person.
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
      recordTable: "Incident",
      recordProperty: "incidentSeverity",
      recordIdColumn: "_id",
      projectColumn: "projectId",
      hasDeletedAtColumn: true,
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

  test("a label comes off every list it is in: read from the join table, through the record that owns it", () => {
    expect(referenceTo("Label", "Monitor", "labels")).toMatchObject({
      countTable: "MonitorLabel",
      countColumn: "labelId",
      // The join row's record: its project, and whether it is still there.
      listRecordColumn: "monitorId",
      recordIdColumn: "_id",
      projectColumn: "projectId",
      hasDeletedAtColumn: true,
      isList: true,
      effect: ArchivableValueDeleteEffect.RemovedFromList,
      kind: ArchivableValueUsageKind.Records,
      title: "Monitors",
    });
  });

  test("every list names the join table's column of its record, and every reference its project", () => {
    for (const valueTable of ARCHIVABLE_VALUE_TABLE_NAMES) {
      for (const reference of referencesOf(valueTable)) {
        expect({
          reference: `${reference.recordTable}.${reference.recordProperty}`,
          projectColumn: reference.projectColumn,
        }).toEqual({
          reference: `${reference.recordTable}.${reference.recordProperty}`,
          projectColumn: expect.any(String),
        });

        if (!reference.isList) {
          continue;
        }

        const junction: EntityMetadata | undefined =
          dataSource.entityMetadatas.find((candidate: EntityMetadata) => {
            return candidate.tableName === reference.countTable;
          });

        expect(
          junction!.columns.some((column: { databaseName: string }) => {
            return column.databaseName === reference.listRecordColumn;
          }),
        ).toBe(true);
      }
    }
  });

  test("a project's own setting is narrowed by the project's own id", () => {
    expect(
      referenceTo(
        "IncidentSeverity",
        "Project",
        "incidentInvestigationMinimumSeverity",
      ),
    ).toMatchObject({
      projectColumn: "_id",
      kind: ArchivableValueUsageKind.Settings,
    });
  });

  test("a person's own on-call rules are their own settings, counted by person - never the project's", () => {
    for (const [valueTable, recordProperty] of [
      ["IncidentSeverity", "incidentSeverity"],
      ["AlertSeverity", "alertSeverity"],
    ] as Array<[string, string]>) {
      expect(
        referenceTo(valueTable, "UserNotificationRule", recordProperty),
      ).toMatchObject({
        title: "Notification Rules",
        kind: ArchivableValueUsageKind.Personal,
        personColumn: "userId",
        projectColumn: "projectId",
        // Deleting the severity still deletes them with it.
        effect: ArchivableValueDeleteEffect.Deleted,
      });
    }

    // A person's notification settings: the priority they hear about cases from.
    expect(
      referenceTo(
        "SecurityCasePriority",
        "UserNotificationSetting",
        "minimumSecurityCasePriority",
      ),
    ).toMatchObject({
      kind: ArchivableValueUsageKind.Personal,
      personColumn: "userId",
      effect: ArchivableValueDeleteEffect.Cleared,
    });
  });

  test("only tables whose rows belong to one person are people's own settings", () => {
    const personal: Array<string> = [];

    for (const valueTable of ARCHIVABLE_VALUE_TABLE_NAMES) {
      for (const reference of referencesOf(valueTable)) {
        if (reference.kind === ArchivableValueUsageKind.Personal) {
          personal.push(`${valueTable} <- ${reference.recordTable}`);
          expect(reference.personColumn).toBe("userId");
        } else {
          expect(reference.personColumn).toBeUndefined();
        }
      }
    }

    expect(personal.sort()).toEqual([
      "AlertSeverity <- UserNotificationRule",
      "IncidentSeverity <- UserNotificationRule",
      "SecurityCasePriority <- UserNotificationSetting",
    ]);
  });

  test("a person column is read from the model's owner, in a project's table only", () => {
    const metadataOf: (table: string) => EntityMetadata = (
      table: string,
    ): EntityMetadata => {
      return dataSource.entityMetadatas.find((candidate: EntityMetadata) => {
        return candidate.tableName === table;
      })!;
    };

    expect(getPersonColumn(metadataOf("UserNotificationRule"))).toBe("userId");
    expect(getPersonColumn(metadataOf("UserNotificationSetting"))).toBe(
      "userId",
    );
    // A project's records, and a person who is not in a project.
    expect(getPersonColumn(metadataOf("Incident"))).toBeUndefined();
    expect(getPersonColumn(metadataOf("IncidentOwnerRule"))).toBeUndefined();
    expect(getPersonColumn(metadataOf("User"))).toBeUndefined();

    expect(getProjectColumn(metadataOf("Incident"))).toBe("projectId");
    expect(getProjectColumn(metadataOf("Project"))).toBe("_id");
  });

  test("templates, rules, measurements and permissions are settings", () => {
    expect(
      referenceTo("IncidentSeverity", "IncidentTemplate", "incidentSeverity"),
    ).toMatchObject({
      kind: ArchivableValueUsageKind.Settings,
      effect: ArchivableValueDeleteEffect.Refused,
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
      // The lowest priority a playbook runs on, and the hosts a config is for.
      [
        "SecurityCasePriority",
        "SecurityPlaybook",
        "minimumSecurityCasePriority",
      ],
      ["Label", "HostCollectorConfig", "labels"],
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
  parameters: Array<unknown>;
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
    parameters: Array<unknown>,
  ): Promise<Array<{ count: string }>> => {
    const call: QueryCall = { sql, parameters };
    calls.push(call);

    return [{ count: String(countFor(call)) }];
  };

  return { source, calls };
};

const CAP: number = USAGE_COUNT_CAP + 1;

// What the membership condition is, as ProjectMembership writes it.
const MEMBERS_ONLY: string = ProjectMembership.getMembershipExistsSql({
  projectIdSql: "$2",
  userIdSql: '"record"."userId"',
});

describe("counting a value's uses", () => {
  test("narrows a record's count to the project and leaves deleted ones out, capped one past the cap", async () => {
    const { source, calls } = countingSource((call: QueryCall) => {
      return call.sql.includes('FROM "Incident" AS "record"') ? 3 : 0;
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
        return call.sql.includes('FROM "Incident" AS "record"');
      },
    );

    // One row per incident: counted without a distinct, and it stops early.
    expect(incidentCall).toEqual({
      sql: `SELECT COUNT(*) AS "count" FROM (SELECT "record"."_id" AS "countedId" FROM "Incident" AS "record" WHERE "record"."incidentSeverityId" = ANY($1::uuid[]) AND "record"."projectId" = $2 AND "record"."deletedAt" IS NULL LIMIT ${CAP}) AS "uses"`,
      parameters: [[VALUE_ID], PROJECT_ID],
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

  test("a list is read from its join table through the records that own it: the project's, still there", async () => {
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
      sql: `SELECT COUNT(*) AS "count" FROM (SELECT "record"."_id" AS "countedId" FROM "MonitorLabel" AS "list" INNER JOIN "Monitor" AS "record" ON "record"."_id" = "list"."monitorId" WHERE "list"."labelId" = ANY($1::uuid[]) AND "record"."projectId" = $2 AND "record"."deletedAt" IS NULL LIMIT ${CAP}) AS "uses"`,
      parameters: [[VALUE_ID], PROJECT_ID],
    });

    // No count reads a join table on its own any more.
    for (const call of calls) {
      expect(call.sql).toContain('AS "record"');
      expect(call.sql).toContain('"record"."projectId" = $');
    }
  });

  test("people's own on-call rules: one person each, members of the project only", async () => {
    const { source, calls } = countingSource((call: QueryCall) => {
      return call.sql.includes('FROM "UserNotificationRule"') ? 2 : 0;
    });

    const items: Array<ArchivableValueUsageItem> =
      await ArchivableValueUsage.countUses({
        dataSource: source,
        valueTable: "IncidentSeverity",
        valueId: new ObjectID(VALUE_ID),
        projectId: new ObjectID(PROJECT_ID),
      });

    const peopleCall: QueryCall | undefined = calls.find((call: QueryCall) => {
      return call.sql.includes('FROM "UserNotificationRule"');
    });

    // Distinct people, however many rules each has: no bound on rows per person.
    expect(peopleCall).toEqual({
      sql: `SELECT COUNT(*) AS "count" FROM (SELECT DISTINCT "countedId" FROM (SELECT "record"."userId" AS "countedId" FROM "UserNotificationRule" AS "record" WHERE "record"."incidentSeverityId" = ANY($1::uuid[]) AND "record"."projectId" = $2 AND "record"."deletedAt" IS NULL AND ${MEMBERS_ONLY}) AS "rows" LIMIT ${CAP}) AS "uses"`,
      parameters: [[VALUE_ID], PROJECT_ID],
    });

    expect(items).toEqual([
      {
        tableName: "UserNotificationRule",
        title: "Notification Rules",
        singularTitle: "Notification Rule",
        count: 2,
        isCountCapped: false,
        effect: ArchivableValueDeleteEffect.Deleted,
        kind: ArchivableValueUsageKind.Personal,
      },
    ]);
  });

  test("a table reached by several lists is counted once per record, its rows bounded by the lists", async () => {
    const { source, calls } = countingSource((call: QueryCall) => {
      return call.sql.includes('INNER JOIN "IncidentGroupingRule"') ? 1 : 0;
    });

    const items: Array<ArchivableValueUsageItem> =
      await ArchivableValueUsage.countUses({
        dataSource: source,
        valueTable: "Label",
        valueId: new ObjectID(VALUE_ID),
        projectId: new ObjectID(PROJECT_ID),
      });

    const groupingCalls: Array<QueryCall> = calls.filter((call: QueryCall) => {
      return call.sql.includes('INNER JOIN "IncidentGroupingRule"');
    });

    // One statement for the three lists a grouping rule holds labels in.
    expect(groupingCalls).toHaveLength(1);
    expect(groupingCalls[0]!.sql.split(" UNION ALL ")).toHaveLength(3);
    expect(groupingCalls[0]!.sql).toContain('SELECT DISTINCT "countedId"');
    expect(groupingCalls[0]!.sql).toContain(`LIMIT ${CAP * 3}) AS "rows"`);

    expect(
      items.filter((item: ArchivableValueUsageItem) => {
        return item.tableName === "IncidentGroupingRule";
      }),
    ).toEqual([
      expect.objectContaining({
        count: 1,
        kind: ArchivableValueUsageKind.Settings,
        effect: ArchivableValueDeleteEffect.RemovedFromList,
      }),
    ]);
  });

  test("ids in criteria, rule assignments and workflows: matched in the JSON's text, lower-cased", async () => {
    const { source, calls } = countingSource((call: QueryCall) => {
      return call.sql.includes('"monitorSteps"::text') &&
        call.sql.includes('FROM "Monitor" AS "record"')
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
        call.sql.includes('FROM "Monitor" AS "record"')
      );
    });

    expect(monitorCall!.sql).toBe(
      `SELECT COUNT(*) AS "count" FROM (SELECT "record"."_id" AS "countedId" FROM "Monitor" AS "record" WHERE "record"."projectId" = $1 AND "record"."deletedAt" IS NULL AND "record"."monitorSteps"::text LIKE ANY($2::text[]) LIMIT ${CAP}) AS "uses"`,
    );
    expect(monitorCall!.parameters).toEqual([PROJECT_ID, [`%${VALUE_ID}%`]]);

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
    expect(jsonReads[0]).toContain('FROM "Workflow" AS "record"');
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

  test("every settings reference by name is a real reference of a model", () => {
    for (const named of SETTINGS_REFERENCES) {
      const [recordTable, recordProperty] = named.split(".");

      const found: boolean = ARCHIVABLE_VALUE_TABLE_NAMES.some(
        (valueTable: string): boolean => {
          return referencesOf(valueTable).some(
            (reference: ValueReference): boolean => {
              return (
                reference.recordTable === recordTable &&
                reference.recordProperty === recordProperty
              );
            },
          );
        },
      );

      expect({ named, found }).toEqual({ named, found: true });
    }
  });

  test("a count past the cap stops at it, and says there are more", async () => {
    const { source } = countingSource((call: QueryCall) => {
      return call.sql.includes('FROM "Incident" AS "record"')
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

  test("effects narrow the lines read", async () => {
    const { source, calls } = countingSource(() => {
      return 1;
    });

    const items: Array<ArchivableValueUsageItem> =
      await ArchivableValueUsage.countUses({
        dataSource: source,
        valueTable: "IncidentSeverity",
        valueId: new ObjectID(VALUE_ID),
        projectId: new ObjectID(PROJECT_ID),
        effects: [ArchivableValueDeleteEffect.Refused],
      });

    expect(items.length).toBeGreaterThan(0);

    for (const item of items) {
      expect(item.effect).toBe(ArchivableValueDeleteEffect.Refused);
    }

    // No list, JSON or person is read for the refusing lines alone.
    for (const call of calls) {
      expect(call.sql).not.toContain("INNER JOIN");
      expect(call.sql).not.toContain("::text LIKE");
      expect(call.sql).not.toContain('"UserNotificationRule"');
    }
  });
});

describe("one line per table, kind and effect, and a table's total", () => {
  test("a table reached with two effects gets a total of its records, every way together", async () => {
    /*
     * A monitor status: monitors suppress alerts on it (a list) and their
     * criteria name it (JSON). 2 and 3 monitors, 4 of them in all.
     */
    const { source, calls } = countingSource((call: QueryCall) => {
      const suppress: boolean = call.sql.includes(
        '"MonitorDependencySuppressionStatus"',
      );
      const criteria: boolean =
        call.sql.includes('"monitorSteps"::text') &&
        call.sql.includes('FROM "Monitor" AS "record"');

      if (suppress && criteria) {
        return 4;
      }

      return suppress ? 2 : criteria ? 3 : 0;
    });

    const items: Array<ArchivableValueUsageItem> =
      await ArchivableValueUsage.countUses({
        dataSource: source,
        valueTable: "MonitorStatus",
        valueId: new ObjectID(VALUE_ID),
        projectId: new ObjectID(PROJECT_ID),
      });

    const monitors: Array<ArchivableValueUsageItem> = items.filter(
      (item: ArchivableValueUsageItem) => {
        return (
          item.tableName === "Monitor" &&
          item.kind === ArchivableValueUsageKind.Settings
        );
      },
    );

    expect(monitors).toEqual([
      expect.objectContaining({
        effect: ArchivableValueDeleteEffect.RemovedFromList,
        count: 2,
        totalCount: 4,
        isTotalCountCapped: false,
      }),
      expect.objectContaining({
        effect: ArchivableValueDeleteEffect.LeftDangling,
        count: 3,
        totalCount: 4,
        isTotalCountCapped: false,
      }),
    ]);

    // The total is one statement over both ways, each monitor once.
    const totalCall: QueryCall | undefined = calls.find((call: QueryCall) => {
      return (
        call.sql.includes('"MonitorDependencySuppressionStatus"') &&
        call.sql.includes('"monitorSteps"::text')
      );
    });

    expect(totalCall!.sql).toContain('SELECT DISTINCT "countedId"');
    expect(totalCall!.sql).toContain(" UNION ALL ");
  });

  test("a table reached one way has no total: its count is the line's", async () => {
    const { source } = countingSource((call: QueryCall) => {
      return call.sql.includes('FROM "Incident" AS "record"') ? 5 : 0;
    });

    const items: Array<ArchivableValueUsageItem> =
      await ArchivableValueUsage.countUses({
        dataSource: source,
        valueTable: "IncidentSeverity",
        valueId: new ObjectID(VALUE_ID),
        projectId: new ObjectID(PROJECT_ID),
      });

    expect(items[0]!.totalCount).toBeUndefined();
  });
});

describe("several values at once", () => {
  const OTHER_ID: string = "0193c0de-cccc-4ccc-8ccc-0000000000a2";

  test("one statement each way for all of them, a record or person once however many of them it has", async () => {
    const { source, calls } = countingSource(() => {
      return 0;
    });

    await ArchivableValueUsage.countUses({
      dataSource: source,
      valueTable: "Label",
      valueIds: [new ObjectID(VALUE_ID), new ObjectID(OTHER_ID.toUpperCase())],
      projectId: new ObjectID(PROJECT_ID),
    });

    const monitorLabels: QueryCall | undefined = calls.find(
      (call: QueryCall) => {
        return call.sql.includes('FROM "MonitorLabel"');
      },
    );

    // A monitor can have both labels: distinct, its rows bounded by two.
    expect(monitorLabels!.sql).toBe(
      `SELECT COUNT(*) AS "count" FROM (SELECT DISTINCT "countedId" FROM (SELECT "record"."_id" AS "countedId" FROM "MonitorLabel" AS "list" INNER JOIN "Monitor" AS "record" ON "record"."_id" = "list"."monitorId" WHERE "list"."labelId" = ANY($1::uuid[]) AND "record"."projectId" = $2 AND "record"."deletedAt" IS NULL LIMIT ${CAP * 2}) AS "rows" LIMIT ${CAP}) AS "uses"`,
    );
    expect(monitorLabels!.parameters).toEqual([
      [VALUE_ID, OTHER_ID],
      PROJECT_ID,
    ]);

    // A monitor has one status at a time: no distinct for a relation.
    const statuses: { source: DataSource; calls: Array<QueryCall> } =
      countingSource(() => {
        return 0;
      });

    await ArchivableValueUsage.countUses({
      dataSource: statuses.source,
      valueTable: "MonitorStatus",
      valueIds: [new ObjectID(VALUE_ID), new ObjectID(OTHER_ID)],
      projectId: new ObjectID(PROJECT_ID),
    });

    const current: QueryCall | undefined = statuses.calls.find(
      (call: QueryCall) => {
        return call.sql.includes('"record"."currentMonitorStatusId"');
      },
    );

    expect(current!.sql).not.toContain("DISTINCT");
  });

  test("ids are read once each, lower-cased, and only the valid ones", () => {
    expect(
      ArchivableValueUsage.normalizeValueIds([
        VALUE_ID.toUpperCase(),
        new ObjectID(VALUE_ID),
        " not-an-id ",
        OTHER_ID,
      ]),
    ).toEqual([VALUE_ID, OTHER_ID]);
  });

  /*
   * A data source that answers the refusal checks: `refusedBy` names, for
   * each table whose key refuses a delete, the values its rows still have.
   */
  const refusingSource: (refusedBy: Record<string, Array<string>>) => {
    source: DataSource;
    calls: Array<QueryCall>;
  } = (
    refusedBy: Record<string, Array<string>>,
  ): { source: DataSource; calls: Array<QueryCall> } => {
    const calls: Array<QueryCall> = [];
    const source: DataSource = Object.create(dataSource) as DataSource;

    (source as unknown as { query: unknown }).query = async (
      sql: string,
      parameters: Array<unknown>,
    ): Promise<Array<unknown>> => {
      calls.push({ sql, parameters });

      if (sql.includes("FROM unnest(")) {
        for (const [table, ids] of Object.entries(refusedBy)) {
          if (sql.includes(`FROM "${table}" AS "record"`)) {
            return ids.map((id: string) => {
              return { valueId: id };
            });
          }
        }

        return [];
      }

      return [{ count: "1" }];
    };

    return { source, calls };
  };

  test("the values records still have, each looked up by its key, in the order asked", async () => {
    const { source, calls } = refusingSource({
      Incident: [OTHER_ID.toUpperCase()],
    });

    expect(
      await ArchivableValueUsage.getRefusedValueIds({
        dataSource: source,
        valueTable: "IncidentSeverity",
        valueIds: [VALUE_ID, OTHER_ID],
        projectId: new ObjectID(PROJECT_ID),
      }),
    ).toEqual([OTHER_ID]);

    const incidentCheck: QueryCall | undefined = calls.find(
      (call: QueryCall) => {
        return call.sql.includes('FROM "Incident" AS "record"');
      },
    );

    expect(incidentCheck).toEqual({
      sql: `SELECT "asked"."valueId" AS "valueId" FROM unnest($1::uuid[]) AS "asked"("valueId") WHERE EXISTS (SELECT 1 FROM "Incident" AS "record" WHERE "record"."incidentSeverityId" = "asked"."valueId" AND "record"."projectId" = $2 AND "record"."deletedAt" IS NULL)`,
      parameters: [[VALUE_ID, OTHER_ID], PROJECT_ID],
    });

    // Only keys that refuse: never a list, a rule a delete takes with it, or JSON.
    for (const call of calls) {
      expect(call.sql).not.toContain('"UserNotificationRule"');
      expect(call.sql).not.toContain("INNER JOIN");
    }
  });

  test("a label refuses nothing: every list it is in lets it go", async () => {
    const { source, calls } = refusingSource({});

    expect(
      await ArchivableValueUsage.getRefusedValueIds({
        dataSource: source,
        valueTable: "Label",
        valueIds: [VALUE_ID],
        projectId: new ObjectID(PROJECT_ID),
      }),
    ).toEqual([]);
    expect(calls).toEqual([]);
  });

  test("for a bulk Delete: which are refused, what has them, and what deleting the rest changes", async () => {
    const { source, calls } = refusingSource({ Incident: [OTHER_ID] });

    const answer: ArchivableValuesUsage =
      await ArchivableValueUsage.countValuesUsage({
        dataSource: source,
        valueTable: "IncidentSeverity",
        valueIds: [VALUE_ID, OTHER_ID],
        projectId: new ObjectID(PROJECT_ID),
        purpose: ArchivableValuesUsagePurpose.Delete,
      });

    expect(answer.refusedValueIds).toEqual([OTHER_ID]);

    // What has the refused one: the refusing lines only.
    expect(answer.refusedUsage.length).toBeGreaterThan(0);
    for (const item of answer.refusedUsage) {
      expect(item.effect).toBe(ArchivableValueDeleteEffect.Refused);
    }

    // What deleting the other changes: counted for it alone.
    const counts: Array<QueryCall> = calls.filter((call: QueryCall) => {
      return call.sql.startsWith("SELECT COUNT(*)");
    });
    const restCounts: Array<QueryCall> = counts.filter((call: QueryCall) => {
      return (
        JSON.stringify(call.parameters[0]) === JSON.stringify([VALUE_ID]) ||
        JSON.stringify(call.parameters[1]) === JSON.stringify([VALUE_ID])
      );
    });

    expect(restCounts.length).toBeGreaterThan(0);
    expect(
      answer.usage.some((item: ArchivableValueUsageItem) => {
        return item.kind === ArchivableValueUsageKind.Personal;
      }),
    ).toBe(true);
  });

  test("for a bulk Delete where every value is refused: nothing to change", async () => {
    const { source } = refusingSource({ Incident: [VALUE_ID] });

    const answer: ArchivableValuesUsage =
      await ArchivableValueUsage.countValuesUsage({
        dataSource: source,
        valueTable: "IncidentSeverity",
        valueIds: [VALUE_ID],
        projectId: new ObjectID(PROJECT_ID),
        purpose: ArchivableValuesUsagePurpose.Delete,
      });

    expect(answer.refusedValueIds).toEqual([VALUE_ID]);
    expect(answer.usage).toEqual([]);
  });

  test("for a bulk Archive: every use of any of them, nothing refused", async () => {
    const { source, calls } = refusingSource({ Incident: [VALUE_ID] });

    const answer: ArchivableValuesUsage =
      await ArchivableValueUsage.countValuesUsage({
        dataSource: source,
        valueTable: "IncidentSeverity",
        valueIds: [VALUE_ID, OTHER_ID],
        projectId: new ObjectID(PROJECT_ID),
        purpose: ArchivableValuesUsagePurpose.Archive,
      });

    expect(answer.refusedValueIds).toEqual([]);
    expect(answer.refusedUsage).toEqual([]);
    expect(answer.usage.length).toBeGreaterThan(0);
    // An archive refuses nothing: no refusal check is read.
    expect(
      calls.some((call: QueryCall) => {
        return call.sql.includes("unnest(");
      }),
    ).toBe(false);
  });
});

describe("the count statement", () => {
  const source: (data: Partial<UsageSource>) => UsageSource = (
    data: Partial<UsageSource>,
  ): UsageSource => {
    return {
      recordTable: "Thing",
      title: "Things",
      singularTitle: "Thing",
      effect: ArchivableValueDeleteEffect.Refused,
      kind: ArchivableValueUsageKind.Records,
      isList: false,
      isPersonal: false,
      getSql: (): string => {
        return 'SELECT "record"."_id" AS "countedId" FROM "Thing" AS "record"';
      },
      ...data,
    };
  };

  test("binds each value once, however many selects use it", () => {
    const statement: { sql: string; parameters: Array<unknown> } =
      ArchivableValueUsage.getCountStatement({
        sources: [
          source({
            getSql: (parameters: {
              valueIds: () => string;
              projectId: () => string;
            }): string => {
              return `SELECT 1 AS "countedId" WHERE ${parameters.valueIds()} IS NOT NULL AND ${parameters.projectId()} IS NOT NULL`;
            },
          } as unknown as Partial<UsageSource>),
          source({
            isList: true,
            getSql: (parameters: {
              valueIds: () => string;
              projectId: () => string;
            }): string => {
              return `SELECT 2 AS "countedId" WHERE ${parameters.projectId()} IS NOT NULL AND ${parameters.valueIds()} IS NOT NULL`;
            },
          } as unknown as Partial<UsageSource>),
        ],
        valueIds: [VALUE_ID],
        projectId: PROJECT_ID,
      });

    expect(statement.parameters).toEqual([[VALUE_ID], PROJECT_ID]);
    expect(statement.sql).toContain(
      "$1::uuid[] IS NOT NULL AND $2 IS NOT NULL",
    );
    expect(statement.sql).toContain(
      "$2 IS NOT NULL AND $1::uuid[] IS NOT NULL",
    );
    // A relation and a list: up to two rows per record, read before the distinct.
    expect(statement.sql).toContain(`LIMIT ${CAP * 2}) AS "rows"`);
  });

  test("people are never bounded before the distinct: a person has a row per rule", () => {
    const statement: { sql: string; parameters: Array<unknown> } =
      ArchivableValueUsage.getCountStatement({
        sources: [source({ isPersonal: true })],
        valueIds: [VALUE_ID],
        projectId: PROJECT_ID,
      });

    expect(statement.sql).toBe(
      `SELECT COUNT(*) AS "count" FROM (SELECT DISTINCT "countedId" FROM (SELECT "record"."_id" AS "countedId" FROM "Thing" AS "record") AS "rows" LIMIT ${CAP}) AS "uses"`,
    );
  });
});
