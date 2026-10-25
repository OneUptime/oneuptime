import { DataSource, EntityMetadata } from "typeorm";
import { RelationMetadata } from "typeorm/metadata/RelationMetadata";
import ObjectID from "../../../Types/ObjectID";
import {
  ArchivableValueUsageItem,
  ArchivableValueUsageKind,
  ArchivableValueDeleteEffect,
} from "../../../Types/ArchivableValue/ArchivableValueUsage";

/*
 * WHAT USES A VALUE, AND WHAT DELETING IT WOULD DO TO EACH (Common/Utils/
 * ArchivableValues).
 *
 * Archiving changes nothing that already uses a value, and deleting changes
 * everything that does: an incident that has a severity refuses the delete,
 * a state takes its rows of every incident's history with it, a label comes
 * off every monitor and incident that has it, a person's notification rules
 * for a severity are deleted. So before either, the dashboard asks how many
 * records use the value and what deleting it would do to them, and says so.
 *
 * The references are read from the database's own mapping (TypeORM's entity
 * metadata, which the schema drift check holds to the database), so a model
 * that starts pointing at a value is counted without anyone remembering to:
 *
 *   - a record's relation to the value (an incident's severity), with the
 *     foreign key's ON DELETE: NO ACTION refuses the delete, CASCADE deletes
 *     the record (a state timeline row, a notification rule), SET NULL
 *     clears the field;
 *   - a many-to-many list (a monitor's labels, a rule's severities): deleting
 *     the value takes it out of the list;
 *   - the ids a monitor's criteria, a monitor template's criteria, an
 *     incident grouping rule's role assignments and a workflow's steps hold
 *     in JSON, with no foreign key behind them.
 *
 * Each count is of the project's records only, leaves out records deleted
 * already (deletedAt), and stops at USAGE_COUNT_CAP: the dialog needs to
 * know "in use", and roughly how much, not to scan a history of millions.
 */

// A count stops here: the dashboard shows "10,000+".
export const USAGE_COUNT_CAP: number = 10000;

/*
 * Tables whose rows set things up rather than being the things that have
 * a value: they keep using an archived value until someone changes them.
 * A permission scoped to a label (an API key's, a team's, a custom role's)
 * is one too.
 */
export const SETTINGS_TABLE_SUFFIXES: Array<string> = [
  "Rule",
  "Template",
  "Setting",
  "Measurement",
  "Feed",
  "Connection",
  "Permission",
];

// Single references and lists on other records that are settings too.
export const SETTINGS_REFERENCES: Array<string> = [
  "Project.incidentInvestigationMinimumSeverity",
  "Project.alertInvestigationMinimumSeverity",
  "StatusPage.downtimeMonitorStatuses",
  "ServiceLevelObjective.downtimeMonitorStatuses",
  "ServiceLevelObjective.monitorLabels",
  "Monitor.suppressAlertsWhenParentMonitorStatuses",
  "NetworkSite.alertSeverity",
];

/*
 * JSON columns that hold value ids with no foreign key behind them: the
 * criteria of monitors and monitor templates, the role assignments of an
 * incident grouping rule, a workflow's steps and a security playbook's
 * steps. All of them set things up, so all are settings; none stops a
 * delete.
 */
export interface JsonUsageColumn {
  tableName: string;
  column: string;
  // The value tables whose ids it may hold.
  valueTables: Array<string>;
  title: string;
  singularTitle: string;
}

export const JSON_USAGE_COLUMNS: Array<JsonUsageColumn> = [
  {
    tableName: "Monitor",
    column: "monitorSteps",
    valueTables: [
      "MonitorStatus",
      "IncidentSeverity",
      "AlertSeverity",
      "Label",
      "IncidentRole",
    ],
    title: "Monitors",
    singularTitle: "Monitor",
  },
  {
    tableName: "MonitorTemplate",
    column: "monitorSteps",
    valueTables: [
      "MonitorStatus",
      "IncidentSeverity",
      "AlertSeverity",
      "Label",
      "IncidentRole",
    ],
    title: "Monitor Templates",
    singularTitle: "Monitor Template",
  },
  {
    tableName: "IncidentGroupingRule",
    column: "episodeMemberRoleAssignments",
    valueTables: ["IncidentRole"],
    title: "Incident Grouping Rules",
    singularTitle: "Incident Grouping Rule",
  },
  {
    tableName: "Workflow",
    column: "graph",
    valueTables: [
      "IncidentState",
      "IncidentSeverity",
      "AlertState",
      "AlertSeverity",
      "MonitorStatus",
      "ScheduledMaintenanceState",
      "Label",
      "IncidentRole",
    ],
    title: "Workflows",
    singularTitle: "Workflow",
  },
  // Set priority, Set status and Check threat intel's raise name the project's own by id.
  {
    tableName: "SecurityPlaybook",
    column: "steps",
    valueTables: ["SecurityCasePriority", "SecurityCaseStatus"],
    title: "Security Playbooks",
    singularTitle: "Security Playbook",
  },
];

/*
 * One way records reach a value, as the counting reads it: a column of a
 * table (a relation's ID column), or a join table's column (a list) with
 * the table that owns the list.
 */
export interface ValueReference {
  // The table counted: the record's, or the join table's.
  countTable: string;
  // The column that holds the value's id.
  countColumn: string;
  // Whether countTable has a "projectId" / "deletedAt" column to narrow by.
  hasProjectColumn: boolean;
  hasDeletedAtColumn: boolean;
  // The records: their table, and the relation or list on them.
  recordTable: string;
  recordProperty: string;
  // How the records are named: the model's plural name, "Incidents".
  title: string;
  singularTitle: string;
  isList: boolean;
  // What deleting the value does to the records, by the foreign key.
  effect: ArchivableValueDeleteEffect;
  kind: ArchivableValueUsageKind;
}

export const isSettingsReference: (
  recordTable: string,
  recordProperty: string,
) => boolean = (recordTable: string, recordProperty: string): boolean => {
  if (
    SETTINGS_TABLE_SUFFIXES.some((suffix: string): boolean => {
      return recordTable.endsWith(suffix);
    })
  ) {
    return true;
  }

  return SETTINGS_REFERENCES.includes(`${recordTable}.${recordProperty}`);
};

export const getEffect: (
  onDelete: string | undefined,
) => ArchivableValueDeleteEffect = (
  onDelete: string | undefined,
): ArchivableValueDeleteEffect => {
  switch ((onDelete || "NO ACTION").toUpperCase()) {
    case "CASCADE":
      return ArchivableValueDeleteEffect.Deleted;
    case "SET NULL":
    case "SET DEFAULT":
      return ArchivableValueDeleteEffect.Cleared;
    default:
      return ArchivableValueDeleteEffect.Refused;
  }
};

// How a model names its records: "Incidents", and one of them, "Incident".
const getTitles: (metadata: EntityMetadata) => {
  title: string;
  singularTitle: string;
} = (metadata: EntityMetadata): { title: string; singularTitle: string } => {
  const target: unknown = metadata.target;

  if (typeof target === "function") {
    try {
      const model: {
        pluralName?: string | null;
        singularName?: string | null;
      } = new (target as {
        new (): {
          pluralName?: string | null;
          singularName?: string | null;
        };
      })();

      if (model.pluralName) {
        return {
          title: model.pluralName,
          singularTitle: model.singularName || model.pluralName,
        };
      }
    } catch {
      // A class that cannot be built without arguments: its table name.
    }
  }

  return { title: metadata.tableName, singularTitle: metadata.tableName };
};

const hasColumn: (metadata: EntityMetadata, databaseName: string) => boolean = (
  metadata: EntityMetadata,
  databaseName: string,
): boolean => {
  return metadata.columns.some((column: { databaseName: string }): boolean => {
    return column.databaseName === databaseName;
  });
};

// Keyed by the data source and the value table.
const referencesByTable: WeakMap<
  DataSource,
  Map<string, Array<ValueReference>>
> = new WeakMap();

export default class ArchivableValueUsage {
  /*
   * Every relation and list that points at `valueTable`, from the data
   * source's entity metadata. Read once per value table.
   */
  public static getReferences(data: {
    dataSource: DataSource;
    valueTable: string;
  }): Array<ValueReference> {
    let byTable: Map<string, Array<ValueReference>> | undefined =
      referencesByTable.get(data.dataSource);

    if (!byTable) {
      byTable = new Map();
      referencesByTable.set(data.dataSource, byTable);
    }

    const cached: Array<ValueReference> | undefined = byTable.get(
      data.valueTable,
    );

    if (cached) {
      return cached;
    }

    const references: Array<ValueReference> = [];

    for (const metadata of data.dataSource.entityMetadatas) {
      if (metadata.isJunction) {
        continue;
      }

      for (const relation of metadata.relations) {
        const reference: ValueReference | null =
          ArchivableValueUsage.toReference({
            metadata: metadata,
            relation: relation,
            valueTable: data.valueTable,
          });

        if (reference) {
          references.push(reference);
        }
      }
    }

    byTable.set(data.valueTable, references);

    return references;
  }

  private static toReference(data: {
    metadata: EntityMetadata;
    relation: RelationMetadata;
    valueTable: string;
  }): ValueReference | null {
    const relation: RelationMetadata = data.relation;
    const metadata: EntityMetadata = data.metadata;

    if (relation.inverseEntityMetadata?.tableName !== data.valueTable) {
      return null;
    }

    // Who archived or created a value is a person, never the value.
    if (metadata.tableName === data.valueTable) {
      return null;
    }

    const { title, singularTitle } = getTitles(metadata);
    const kind: ArchivableValueUsageKind = isSettingsReference(
      metadata.tableName,
      relation.propertyName,
    )
      ? ArchivableValueUsageKind.Settings
      : ArchivableValueUsageKind.Records;

    if (relation.isManyToOne || relation.isOneToOneOwner) {
      const joinColumn: string | undefined =
        relation.joinColumns[0]?.databaseName;

      if (!joinColumn) {
        return null;
      }

      return {
        countTable: metadata.tableName,
        countColumn: joinColumn,
        hasProjectColumn: hasColumn(metadata, "projectId"),
        hasDeletedAtColumn: hasColumn(metadata, "deletedAt"),
        recordTable: metadata.tableName,
        recordProperty: relation.propertyName,
        title: title,
        singularTitle: singularTitle,
        isList: false,
        effect: getEffect(relation.onDelete),
        kind: kind,
      };
    }

    if (relation.isManyToMany && relation.isOwning) {
      const junction: EntityMetadata | undefined =
        relation.junctionEntityMetadata;
      const valueColumn: string | undefined =
        relation.inverseJoinColumns[0]?.databaseName;

      if (!junction || !valueColumn) {
        return null;
      }

      return {
        countTable: junction.tableName,
        countColumn: valueColumn,
        hasProjectColumn: false,
        hasDeletedAtColumn: false,
        recordTable: metadata.tableName,
        recordProperty: relation.propertyName,
        title: title,
        singularTitle: singularTitle,
        isList: true,
        // Deleting the value deletes its rows of the join table.
        effect: ArchivableValueDeleteEffect.RemovedFromList,
        kind: kind,
      };
    }

    return null;
  }

  /*
   * How many of the project's records use the value, by the way they reach
   * it, and what deleting it would do to them. Only uses there are. Run as
   * OneUptime: the caller has already been asked whether they may manage
   * the value, and only counts come back.
   */
  public static async countUses(data: {
    dataSource: DataSource;
    valueTable: string;
    valueId: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<ArchivableValueUsageItem>> {
    const valueId: string = data.valueId.toString();
    const projectId: string = data.projectId.toString();

    if (!ObjectID.isValidUUID(valueId) || !ObjectID.isValidUUID(projectId)) {
      return [];
    }

    const items: Array<ArchivableValueUsageItem> = [];

    for (const reference of ArchivableValueUsage.getReferences({
      dataSource: data.dataSource,
      valueTable: data.valueTable,
    })) {
      const count: number = await ArchivableValueUsage.countReference({
        dataSource: data.dataSource,
        reference: reference,
        valueId: valueId,
        projectId: projectId,
      });

      if (count > 0) {
        items.push({
          tableName: reference.recordTable,
          title: reference.title,
          singularTitle: reference.singularTitle,
          count: Math.min(count, USAGE_COUNT_CAP),
          isCountCapped: count > USAGE_COUNT_CAP,
          effect: reference.effect,
          kind: reference.kind,
        });
      }
    }

    for (const jsonColumn of JSON_USAGE_COLUMNS) {
      if (!jsonColumn.valueTables.includes(data.valueTable)) {
        continue;
      }

      const metadata: EntityMetadata | undefined =
        data.dataSource.entityMetadatas.find(
          (candidate: EntityMetadata): boolean => {
            return candidate.tableName === jsonColumn.tableName;
          },
        );

      if (!metadata || !hasColumn(metadata, jsonColumn.column)) {
        continue;
      }

      /*
       * A uuid holds only hex digits and dashes, so it is matched as written
       * inside the JSON's text: there is nothing in it LIKE reads as a
       * wildcard.
       */
      const count: number = await ArchivableValueUsage.runCount({
        dataSource: data.dataSource,
        sql: `SELECT 1 FROM "${jsonColumn.tableName}" WHERE "projectId" = $1${
          hasColumn(metadata, "deletedAt") ? ` AND "deletedAt" IS NULL` : ""
        } AND "${jsonColumn.column}"::text LIKE $2`,
        parameters: [projectId, `%${valueId.toLowerCase()}%`],
      });

      if (count > 0) {
        items.push({
          tableName: jsonColumn.tableName,
          title: jsonColumn.title,
          singularTitle: jsonColumn.singularTitle,
          count: Math.min(count, USAGE_COUNT_CAP),
          isCountCapped: count > USAGE_COUNT_CAP,
          effect: ArchivableValueDeleteEffect.LeftDangling,
          kind: ArchivableValueUsageKind.Settings,
        });
      }
    }

    return ArchivableValueUsage.mergeByTable(items);
  }

  /*
   * One line per table and effect: an incident template that names a
   * severity and lists it among its rule severities is one template.
   */
  public static mergeByTable(
    items: Array<ArchivableValueUsageItem>,
  ): Array<ArchivableValueUsageItem> {
    const merged: Array<ArchivableValueUsageItem> = [];

    for (const item of items) {
      const existing: ArchivableValueUsageItem | undefined = merged.find(
        (candidate: ArchivableValueUsageItem): boolean => {
          return (
            candidate.tableName === item.tableName &&
            candidate.effect === item.effect &&
            candidate.kind === item.kind
          );
        },
      );

      if (!existing) {
        merged.push({ ...item });
        continue;
      }

      // The larger count: the same records may reach it both ways.
      if (item.count > existing.count) {
        existing.count = item.count;
      }

      existing.isCountCapped = existing.isCountCapped || item.isCountCapped;
    }

    return merged;
  }

  private static async countReference(data: {
    dataSource: DataSource;
    reference: ValueReference;
    valueId: string;
    projectId: string;
  }): Promise<number> {
    const reference: ValueReference = data.reference;
    const conditions: Array<string> = [`"${reference.countColumn}" = $1`];
    const parameters: Array<string> = [data.valueId];

    if (reference.hasProjectColumn) {
      parameters.push(data.projectId);
      conditions.push(`"projectId" = $${parameters.length}`);
    }

    if (reference.hasDeletedAtColumn) {
      conditions.push(`"deletedAt" IS NULL`);
    }

    return await ArchivableValueUsage.runCount({
      dataSource: data.dataSource,
      sql: `SELECT 1 FROM "${reference.countTable}" WHERE ${conditions.join(" AND ")}`,
      parameters: parameters,
    });
  }

  // Counts the rows a select returns, up to one past the cap.
  private static async runCount(data: {
    dataSource: DataSource;
    sql: string;
    parameters: Array<string>;
  }): Promise<number> {
    const rows: Array<{ count: number | string }> = await data.dataSource.query(
      `SELECT COUNT(*) AS "count" FROM (${data.sql} LIMIT ${USAGE_COUNT_CAP + 1}) AS "uses"`,
      data.parameters,
    );

    const count: number = Number(rows[0]?.count || 0);

    return Number.isFinite(count) ? count : 0;
  }
}
