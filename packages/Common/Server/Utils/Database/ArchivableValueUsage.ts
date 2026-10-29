import { DataSource, EntityMetadata } from "typeorm";
import { RelationMetadata } from "typeorm/metadata/RelationMetadata";
import ObjectID from "../../../Types/ObjectID";
import {
  ArchivableValueUsageItem,
  ArchivableValueUsageKind,
  ArchivableValueDeleteEffect,
  ArchivableValuesUsage,
  ArchivableValuesUsagePurpose,
} from "../../../Types/ArchivableValue/ArchivableValueUsage";
import ProjectMembership from "../TeamMember/ProjectMembership";

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
 * WHAT IS COUNTED IS WHAT A PERSON WOULD COUNT. The Archive dialog once
 * said "Notification Rules (22)" for a severity in a project whose owners
 * had set up two rules: it counted the rows of every member's own on-call
 * rules - one per severity, kind (incidents, episodes) and notification
 * method, which OneUptime seeds for each person - as settings of the
 * project. So:
 *
 *   - a table whose rows belong to one person (@CurrentUserCanAccessRecordBy:
 *     their on-call rules, their notification settings) is a person's own
 *     settings (Personal), counted by person - and only people who are
 *     members of the project (ProjectMembership): rows a removed member
 *     left behind name nobody who can be paged;
 *   - every other line counts records, each once however many of its fields
 *     or lists name the value, and however many of the values it has when
 *     several are asked about at once (a bulk Archive or Delete);
 *   - a list's join rows are counted through the record that owns them, so
 *     they are narrowed to the project and leave out deleted records like
 *     everything else.
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
  // The lowest priority a playbook runs on: set up, like its steps.
  "SecurityPlaybook.minimumSecurityCasePriority",
  // Only hosts with one of these labels get the config.
  "HostCollectorConfig.labels",
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
 * One way records reach a value, as the counting reads it: a column of the
 * record's own table (a relation's ID column), or a join table's column (a
 * list), read through the record that owns the list.
 */
export interface ValueReference {
  // The table the value's id is read from: the record's, or the join table's.
  countTable: string;
  // Its column that holds the value's id.
  countColumn: string;
  // The records: their table, and the relation or list on them.
  recordTable: string;
  recordProperty: string;
  // For a list: the join table's column that holds the record's id.
  listRecordColumn?: string | undefined;
  // The record table's primary key, which a list's join column points at.
  recordIdColumn: string;
  /*
   * The record table's column that names its project (its tenant column -
   * a project itself is named by its own id), when it has one, and whether
   * its rows carry a "deletedAt".
   */
  projectColumn?: string | undefined;
  hasDeletedAtColumn: boolean;
  /*
   * For a person's own settings (Personal): the column that says whose a row
   * is. The line counts people by it, members of the project only.
   */
  personColumn?: string | undefined;
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

interface ModelFacts {
  pluralName?: string | null | undefined;
  singularName?: string | null | undefined;
  // @TenantColumn: the column that names the project.
  tenantColumn?: string | null | undefined;
  // @CurrentUserCanAccessRecordBy: the column that names whose a row is.
  currentUserCanAccessColumnBy?: string | null | undefined;
}

// What the model class itself says about its table, or nothing.
const getModelFacts: (metadata: EntityMetadata) => ModelFacts = (
  metadata: EntityMetadata,
): ModelFacts => {
  const target: unknown = metadata.target;

  if (typeof target !== "function") {
    return {};
  }

  try {
    return new (target as { new (): ModelFacts })();
  } catch {
    // A class that cannot be built without arguments says nothing.
    return {};
  }
};

// How a model names its records: "Incidents", and one of them, "Incident".
const getTitles: (metadata: EntityMetadata) => {
  title: string;
  singularTitle: string;
} = (metadata: EntityMetadata): { title: string; singularTitle: string } => {
  const model: ModelFacts = getModelFacts(metadata);

  if (model.pluralName) {
    return {
      title: model.pluralName,
      singularTitle: model.singularName || model.pluralName,
    };
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

/*
 * The column that names a record's project: the model's tenant column (a
 * project is its own: "_id"), else a "projectId" column, else none.
 */
export const getProjectColumn: (
  metadata: EntityMetadata,
) => string | undefined = (metadata: EntityMetadata): string | undefined => {
  const tenantColumn: string | null | undefined =
    getModelFacts(metadata).tenantColumn;

  if (tenantColumn && hasColumn(metadata, tenantColumn)) {
    return tenantColumn;
  }

  return hasColumn(metadata, "projectId") ? "projectId" : undefined;
};

/*
 * The column that says whose a row is, for a table of a person's own
 * settings in a project: rows only their owner reaches
 * (@CurrentUserCanAccessRecordBy), each in a project. Undefined for any
 * other table.
 */
export const getPersonColumn: (
  metadata: EntityMetadata,
) => string | undefined = (metadata: EntityMetadata): string | undefined => {
  const personColumn: string | null | undefined =
    getModelFacts(metadata).currentUserCanAccessColumnBy;

  if (
    !personColumn ||
    !hasColumn(metadata, personColumn) ||
    !hasColumn(metadata, "projectId")
  ) {
    return undefined;
  }

  return personColumn;
};

/*
 * One select of a count: a row per use, the record (or the person) it
 * counts as "countedId". Its placeholders are numbered by the statement it
 * goes into (StatementParameters).
 */
export interface UsageSource {
  recordTable: string;
  title: string;
  singularTitle: string;
  effect: ArchivableValueDeleteEffect;
  kind: ArchivableValueUsageKind;
  // A list holds several of the values at once: a row per value it holds.
  isList: boolean;
  // Counts people (a person's own settings), each once for many rows.
  isPersonal: boolean;
  getSql: (parameters: StatementParameters) => string;
}

/*
 * The values a statement binds, each once however many of its selects use
 * it: the ids asked about, the project, and the patterns the JSON is
 * matched with.
 */
export class StatementParameters {
  private readonly values: Array<unknown> = [];
  private readonly placeholders: Map<string, string> = new Map();

  public constructor(
    private readonly named: {
      valueIds: Array<string>;
      projectId: string;
    },
  ) {}

  private placeholderFor(name: string, value: () => unknown): string {
    const existing: string | undefined = this.placeholders.get(name);

    if (existing) {
      return existing;
    }

    this.values.push(value());
    const placeholder: string = `$${this.values.length}`;
    this.placeholders.set(name, placeholder);

    return placeholder;
  }

  public valueIds(): string {
    return `${this.placeholderFor("valueIds", () => {
      return this.named.valueIds;
    })}::uuid[]`;
  }

  public projectId(): string {
    return this.placeholderFor("projectId", () => {
      return this.named.projectId;
    });
  }

  /*
   * A uuid holds only hex digits and dashes, so it is matched as written
   * inside the JSON's text: there is nothing in it LIKE reads as a wildcard.
   */
  public jsonPatterns(): string {
    return `${this.placeholderFor("jsonPatterns", () => {
      return this.named.valueIds.map((id: string): string => {
        return `%${id}%`;
      });
    })}::text[]`;
  }

  public getValues(): Array<unknown> {
    return this.values;
  }
}

// What narrows a select to the project's records that are still there.
const getRecordConditions: (data: {
  projectColumn?: string | undefined;
  hasDeletedAtColumn: boolean;
  personColumn?: string | undefined;
  parameters: StatementParameters;
}) => Array<string> = (data: {
  projectColumn?: string | undefined;
  hasDeletedAtColumn: boolean;
  personColumn?: string | undefined;
  parameters: StatementParameters;
}): Array<string> => {
  const conditions: Array<string> = [];

  if (data.projectColumn) {
    conditions.push(
      `"record"."${data.projectColumn}" = ${data.parameters.projectId()}`,
    );
  }

  if (data.hasDeletedAtColumn) {
    conditions.push(`"record"."deletedAt" IS NULL`);
  }

  // Only people who are members of the project count. See the note above.
  if (data.personColumn) {
    conditions.push(
      ProjectMembership.getMembershipExistsSql({
        projectIdSql: data.parameters.projectId(),
        userIdSql: `"record"."${data.personColumn}"`,
      }),
    );
  }

  return conditions;
};

// Keyed by the data source and the value table.
const referencesByTable: WeakMap<
  DataSource,
  Map<string, Array<ValueReference>>
> = new WeakMap();

const groupKey: (source: {
  recordTable: string;
  kind: ArchivableValueUsageKind;
}) => string = (source: {
  recordTable: string;
  kind: ArchivableValueUsageKind;
}): string => {
  return `${source.recordTable}:${source.kind}`;
};

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
    const personColumn: string | undefined = getPersonColumn(metadata);

    const kind: ArchivableValueUsageKind = personColumn
      ? ArchivableValueUsageKind.Personal
      : isSettingsReference(metadata.tableName, relation.propertyName)
        ? ArchivableValueUsageKind.Settings
        : ArchivableValueUsageKind.Records;

    const recordIdColumn: string =
      metadata.primaryColumns[0]?.databaseName || "_id";

    const shared: {
      recordTable: string;
      recordProperty: string;
      recordIdColumn: string;
      projectColumn?: string | undefined;
      hasDeletedAtColumn: boolean;
      personColumn?: string | undefined;
      title: string;
      singularTitle: string;
      kind: ArchivableValueUsageKind;
    } = {
      recordTable: metadata.tableName,
      recordProperty: relation.propertyName,
      recordIdColumn: recordIdColumn,
      projectColumn: getProjectColumn(metadata),
      hasDeletedAtColumn: hasColumn(metadata, "deletedAt"),
      personColumn: personColumn,
      title: title,
      singularTitle: singularTitle,
      kind: kind,
    };

    if (relation.isManyToOne || relation.isOneToOneOwner) {
      const joinColumn: string | undefined =
        relation.joinColumns[0]?.databaseName;

      if (!joinColumn) {
        return null;
      }

      return {
        ...shared,
        countTable: metadata.tableName,
        countColumn: joinColumn,
        isList: false,
        effect: getEffect(relation.onDelete),
      };
    }

    if (relation.isManyToMany && relation.isOwning) {
      const junction: EntityMetadata | undefined =
        relation.junctionEntityMetadata;
      const valueColumn: string | undefined =
        relation.inverseJoinColumns[0]?.databaseName;
      const listRecordColumn: string | undefined =
        relation.joinColumns[0]?.databaseName;

      if (!junction || !valueColumn || !listRecordColumn) {
        return null;
      }

      return {
        ...shared,
        recordIdColumn:
          relation.joinColumns[0]?.referencedColumn?.databaseName ||
          recordIdColumn,
        countTable: junction.tableName,
        countColumn: valueColumn,
        listRecordColumn: listRecordColumn,
        isList: true,
        // Deleting the value deletes its rows of the join table.
        effect: ArchivableValueDeleteEffect.RemovedFromList,
      };
    }

    return null;
  }

  // A reference as one select of a count.
  private static toSource(reference: ValueReference): UsageSource {
    const counted: string = reference.personColumn
      ? `"record"."${reference.personColumn}"`
      : `"record"."${reference.recordIdColumn}"`;

    return {
      recordTable: reference.recordTable,
      title: reference.title,
      singularTitle: reference.singularTitle,
      effect: reference.effect,
      kind: reference.kind,
      isList: reference.isList,
      isPersonal: Boolean(reference.personColumn),
      getSql: (parameters: StatementParameters): string => {
        const from: string = reference.isList
          ? `"${reference.countTable}" AS "list" INNER JOIN "${reference.recordTable}" AS "record" ON "record"."${reference.recordIdColumn}" = "list"."${reference.listRecordColumn}"`
          : `"${reference.recordTable}" AS "record"`;

        const conditions: Array<string> = [
          `${reference.isList ? `"list"` : `"record"`}."${reference.countColumn}" = ANY(${parameters.valueIds()})`,
          ...getRecordConditions({
            projectColumn: reference.projectColumn,
            hasDeletedAtColumn: reference.hasDeletedAtColumn,
            personColumn: reference.personColumn,
            parameters: parameters,
          }),
        ];

        return `SELECT ${counted} AS "countedId" FROM ${from} WHERE ${conditions.join(" AND ")}`;
      },
    };
  }

  // A JSON column as one select of a count, or null when it has none.
  private static toJsonSource(data: {
    dataSource: DataSource;
    jsonColumn: JsonUsageColumn;
  }): UsageSource | null {
    const metadata: EntityMetadata | undefined =
      data.dataSource.entityMetadatas.find(
        (candidate: EntityMetadata): boolean => {
          return candidate.tableName === data.jsonColumn.tableName;
        },
      );

    if (!metadata || !hasColumn(metadata, data.jsonColumn.column)) {
      return null;
    }

    const projectColumn: string | undefined = getProjectColumn(metadata);
    const hasDeletedAtColumn: boolean = hasColumn(metadata, "deletedAt");
    const recordIdColumn: string =
      metadata.primaryColumns[0]?.databaseName || "_id";

    return {
      recordTable: data.jsonColumn.tableName,
      title: data.jsonColumn.title,
      singularTitle: data.jsonColumn.singularTitle,
      effect: ArchivableValueDeleteEffect.LeftDangling,
      kind: ArchivableValueUsageKind.Settings,
      isList: false,
      isPersonal: false,
      getSql: (parameters: StatementParameters): string => {
        const conditions: Array<string> = [
          ...getRecordConditions({
            projectColumn: projectColumn,
            hasDeletedAtColumn: hasDeletedAtColumn,
            parameters: parameters,
          }),
          `"record"."${data.jsonColumn.column}"::text LIKE ANY(${parameters.jsonPatterns()})`,
        ];

        return `SELECT "record"."${recordIdColumn}" AS "countedId" FROM "${data.jsonColumn.tableName}" AS "record" WHERE ${conditions.join(" AND ")}`;
      },
    };
  }

  // Every select that counts a use of `valueTable`, relations then JSON.
  public static getSources(data: {
    dataSource: DataSource;
    valueTable: string;
  }): Array<UsageSource> {
    const sources: Array<UsageSource> = ArchivableValueUsage.getReferences(
      data,
    ).map((reference: ValueReference): UsageSource => {
      return ArchivableValueUsage.toSource(reference);
    });

    for (const jsonColumn of JSON_USAGE_COLUMNS) {
      if (!jsonColumn.valueTables.includes(data.valueTable)) {
        continue;
      }

      const source: UsageSource | null = ArchivableValueUsage.toJsonSource({
        dataSource: data.dataSource,
        jsonColumn: jsonColumn,
      });

      if (source) {
        sources.push(source);
      }
    }

    return sources;
  }

  /*
   * The ids asked about, as the counts bind them: valid uuids only, lower
   * case (a JSON column holds them lower-cased), each once.
   */
  public static normalizeValueIds(
    valueIds: Array<ObjectID | string>,
  ): Array<string> {
    const ids: Array<string> = [];

    for (const valueId of valueIds) {
      const id: string = valueId.toString().trim().toLowerCase();

      if (ObjectID.isValidUUID(id) && !ids.includes(id)) {
        ids.push(id);
      }
    }

    return ids;
  }

  /*
   * How many of the project's records use the value - or any of `valueIds`
   * - by the way they reach it, and what deleting it would do to them: one
   * line per table, kind and effect, only uses there are. Run as OneUptime:
   * the caller has already been asked whether they may manage the value,
   * and only counts come back. `effects` narrows the lines read.
   */
  public static async countUses(data: {
    dataSource: DataSource;
    valueTable: string;
    valueId?: ObjectID | undefined;
    valueIds?: Array<ObjectID | string> | undefined;
    projectId: ObjectID;
    effects?: Array<ArchivableValueDeleteEffect> | undefined;
  }): Promise<Array<ArchivableValueUsageItem>> {
    const valueIds: Array<string> = ArchivableValueUsage.normalizeValueIds([
      ...(data.valueId ? [data.valueId] : []),
      ...(data.valueIds || []),
    ]);
    const projectId: string = data.projectId.toString();

    if (valueIds.length === 0 || !ObjectID.isValidUUID(projectId)) {
      return [];
    }

    const sources: Array<UsageSource> = ArchivableValueUsage.getSources({
      dataSource: data.dataSource,
      valueTable: data.valueTable,
    }).filter((source: UsageSource): boolean => {
      return !data.effects || data.effects.includes(source.effect);
    });

    // A line per table, kind and effect, in the order the sources come.
    const lines: Map<string, Array<UsageSource>> = new Map();
    // And every source of a table and kind, for its total.
    const tables: Map<string, Array<UsageSource>> = new Map();

    for (const source of sources) {
      const lineKey: string = `${groupKey(source)}:${source.effect}`;
      lines.set(lineKey, [...(lines.get(lineKey) || []), source]);
      tables.set(groupKey(source), [
        ...(tables.get(groupKey(source)) || []),
        source,
      ]);
    }

    const items: Array<ArchivableValueUsageItem> = [];

    for (const lineSources of lines.values()) {
      const first: UsageSource = lineSources[0]!;

      const count: number = await ArchivableValueUsage.countDistinct({
        dataSource: data.dataSource,
        sources: lineSources,
        valueIds: valueIds,
        projectId: projectId,
      });

      if (count > 0) {
        items.push({
          tableName: first.recordTable,
          title: first.title,
          singularTitle: first.singularTitle,
          count: Math.min(count, USAGE_COUNT_CAP),
          isCountCapped: count > USAGE_COUNT_CAP,
          effect: first.effect,
          kind: first.kind,
        });
      }
    }

    /*
     * A table reached in more than one way, with more than one effect: how
     * many of its records use the value at all, for the one line the
     * Archive dialog gives it.
     */
    for (const [key, tableSources] of tables) {
      const tableItems: Array<ArchivableValueUsageItem> = items.filter(
        (item: ArchivableValueUsageItem): boolean => {
          return (
            groupKey({ recordTable: item.tableName, kind: item.kind }) === key
          );
        },
      );

      if (tableItems.length < 2) {
        continue;
      }

      const total: number = await ArchivableValueUsage.countDistinct({
        dataSource: data.dataSource,
        sources: tableSources,
        valueIds: valueIds,
        projectId: projectId,
      });

      for (const item of tableItems) {
        item.totalCount = Math.max(
          Math.min(total, USAGE_COUNT_CAP),
          item.count,
        );
        item.isTotalCountCapped = total > USAGE_COUNT_CAP;
      }
    }

    return items;
  }

  /*
   * Which of `valueIds` the project's records still have under a key that
   * refuses a delete (an incident's severity, a template's): those values
   * can't be deleted. One statement per such key, each value looked up by
   * its index.
   */
  public static async getRefusedValueIds(data: {
    dataSource: DataSource;
    valueTable: string;
    valueIds: Array<ObjectID | string>;
    projectId: ObjectID;
  }): Promise<Array<string>> {
    const valueIds: Array<string> = ArchivableValueUsage.normalizeValueIds(
      data.valueIds,
    );
    const projectId: string = data.projectId.toString();

    if (valueIds.length === 0 || !ObjectID.isValidUUID(projectId)) {
      return [];
    }

    const refused: Set<string> = new Set<string>();

    for (const reference of ArchivableValueUsage.getReferences({
      dataSource: data.dataSource,
      valueTable: data.valueTable,
    })) {
      if (
        reference.effect !== ArchivableValueDeleteEffect.Refused ||
        reference.isList
      ) {
        continue;
      }

      const parameters: StatementParameters = new StatementParameters({
        valueIds: valueIds,
        projectId: projectId,
      });

      // The values asked about first: $1, as in every count.
      const asked: string = parameters.valueIds();

      const conditions: Array<string> = [
        `"record"."${reference.countColumn}" = "asked"."valueId"`,
        ...getRecordConditions({
          projectColumn: reference.projectColumn,
          hasDeletedAtColumn: reference.hasDeletedAtColumn,
          personColumn: reference.personColumn,
          parameters: parameters,
        }),
      ];

      const sql: string = `SELECT "asked"."valueId" AS "valueId" FROM unnest(${asked}) AS "asked"("valueId") WHERE EXISTS (SELECT 1 FROM "${reference.recordTable}" AS "record" WHERE ${conditions.join(" AND ")})`;

      const rows: Array<{ valueId: unknown }> = await data.dataSource.query(
        sql,
        parameters.getValues(),
      );

      for (const row of rows) {
        if (row && row.valueId) {
          refused.add(String(row.valueId).toLowerCase());
        }
      }
    }

    return valueIds.filter((id: string): boolean => {
      return refused.has(id);
    });
  }

  /*
   * What a bulk Archive's or Delete's dialog says about several values
   * (ArchivableValuesUsage): for an Archive, every use of any of them; for
   * a Delete, which of them records still have - those are left as they
   * are - with what has them, and what deleting the rest changes.
   */
  public static async countValuesUsage(data: {
    dataSource: DataSource;
    valueTable: string;
    valueIds: Array<ObjectID | string>;
    projectId: ObjectID;
    purpose: ArchivableValuesUsagePurpose;
  }): Promise<ArchivableValuesUsage> {
    const valueIds: Array<string> = ArchivableValueUsage.normalizeValueIds(
      data.valueIds,
    );

    if (data.purpose === ArchivableValuesUsagePurpose.Archive) {
      return {
        usage: await ArchivableValueUsage.countUses({
          dataSource: data.dataSource,
          valueTable: data.valueTable,
          valueIds: valueIds,
          projectId: data.projectId,
        }),
        refusedValueIds: [],
        refusedUsage: [],
      };
    }

    const refusedValueIds: Array<string> =
      await ArchivableValueUsage.getRefusedValueIds({
        dataSource: data.dataSource,
        valueTable: data.valueTable,
        valueIds: valueIds,
        projectId: data.projectId,
      });

    const deletable: Array<string> = valueIds.filter((id: string): boolean => {
      return !refusedValueIds.includes(id);
    });

    return {
      usage:
        deletable.length > 0
          ? await ArchivableValueUsage.countUses({
              dataSource: data.dataSource,
              valueTable: data.valueTable,
              valueIds: deletable,
              projectId: data.projectId,
            })
          : [],
      refusedValueIds: refusedValueIds,
      refusedUsage:
        refusedValueIds.length > 0
          ? await ArchivableValueUsage.countUses({
              dataSource: data.dataSource,
              valueTable: data.valueTable,
              valueIds: refusedValueIds,
              projectId: data.projectId,
              effects: [ArchivableValueDeleteEffect.Refused],
            })
          : [],
    };
  }

  /*
   * The statement that counts what `sources` reach, each record or person
   * once, up to one past the cap. A record is a row of a relation's select
   * at most once, and of a list's once per value it holds - so the rows
   * read before the distinct are bounded by that, and the count stops
   * early on a big table. People have no such bound (a person has a row per
   * rule), and their tables are a project's people, so theirs is not.
   */
  public static getCountStatement(data: {
    sources: Array<UsageSource>;
    valueIds: Array<string>;
    projectId: string;
  }): { sql: string; parameters: Array<unknown> } {
    const parameters: StatementParameters = new StatementParameters({
      valueIds: data.valueIds,
      projectId: data.projectId,
    });

    const isPersonal: boolean = data.sources.some(
      (source: UsageSource): boolean => {
        return source.isPersonal;
      },
    );

    const rowsPerRecord: number = data.sources.reduce(
      (total: number, source: UsageSource): number => {
        return total + (source.isList ? data.valueIds.length : 1);
      },
      0,
    );

    const selects: Array<string> = data.sources.map(
      (source: UsageSource): string => {
        return source.getSql(parameters);
      },
    );

    if (!isPersonal && rowsPerRecord === 1) {
      return {
        sql: `SELECT COUNT(*) AS "count" FROM (${selects[0]} LIMIT ${USAGE_COUNT_CAP + 1}) AS "uses"`,
        parameters: parameters.getValues(),
      };
    }

    const rows: string = `${selects.join(" UNION ALL ")}${
      isPersonal ? "" : ` LIMIT ${(USAGE_COUNT_CAP + 1) * rowsPerRecord}`
    }`;

    return {
      sql: `SELECT COUNT(*) AS "count" FROM (SELECT DISTINCT "countedId" FROM (${rows}) AS "rows" LIMIT ${USAGE_COUNT_CAP + 1}) AS "uses"`,
      parameters: parameters.getValues(),
    };
  }

  private static async countDistinct(data: {
    dataSource: DataSource;
    sources: Array<UsageSource>;
    valueIds: Array<string>;
    projectId: string;
  }): Promise<number> {
    const statement: { sql: string; parameters: Array<unknown> } =
      ArchivableValueUsage.getCountStatement(data);

    const rows: Array<{ count: number | string }> = await data.dataSource.query(
      statement.sql,
      statement.parameters,
    );

    const count: number = Number(rows[0]?.count || 0);

    return Number.isFinite(count) ? count : 0;
  }
}
