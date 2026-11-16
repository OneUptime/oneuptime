import CacheGenerations from "../../Infrastructure/CacheGenerations";
import InMemoryTTLCache from "../../Infrastructure/InMemoryTTLCache";
import PostgresAppInstance from "../../Infrastructure/PostgresDatabase";
import Redis from "../../Infrastructure/Redis";
import type DatabaseService from "../../Services/DatabaseService";
import Query from "../../Types/Database/Query";
import Select from "../../Types/Database/Select";
import Sort from "../../Types/Database/Sort";
import logger from "../Logger";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AlertGroupingRule from "../../../Models/DatabaseModels/AlertGroupingRule";
import AlertIncidentRule from "../../../Models/DatabaseModels/AlertIncidentRule";
import AlertLabelRule from "../../../Models/DatabaseModels/AlertLabelRule";
import AlertOnCallRule from "../../../Models/DatabaseModels/AlertOnCallRule";
import AlertOwnerRule from "../../../Models/DatabaseModels/AlertOwnerRule";
import AlertPrivacyRule from "../../../Models/DatabaseModels/AlertPrivacyRule";
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import IncidentGroupingRule from "../../../Models/DatabaseModels/IncidentGroupingRule";
import IncidentLabelRule from "../../../Models/DatabaseModels/IncidentLabelRule";
import IncidentOnCallRule from "../../../Models/DatabaseModels/IncidentOnCallRule";
import IncidentOwnerRule from "../../../Models/DatabaseModels/IncidentOwnerRule";
import IncidentPrivacyRule from "../../../Models/DatabaseModels/IncidentPrivacyRule";
import RunbookRule from "../../../Models/DatabaseModels/RunbookRule";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import ObjectID from "../../../Types/ObjectID";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../../Utils/Rules/RuleEngineLimits";
import { DataSource } from "typeorm";
import { EntityMetadata } from "typeorm/metadata/EntityMetadata";
import { ForeignKeyMetadata } from "typeorm/metadata/ForeignKeyMetadata";
import { RelationMetadata } from "typeorm/metadata/RelationMetadata";

/*
 * A PROJECT'S RULES, READ ONCE AND KEPT UNTIL ANY OF THEM CHANGES.
 *
 * Every incident and every alert created runs its project's rules: privacy,
 * owner, label, on-call, runbook, grouping and remediation rules for an
 * incident, the same and the alert-to-incident rules for an alert. Each of
 * those engines read the project's enabled rules of its kind when it ran,
 * with every list a rule can hold (its monitors, severities, labels, owners,
 * on-call policies, ...) joined in: 9 to 19 tables a read, and a row for
 * each combination of the lists' entries. Fifteen such reads for every
 * record created, of rules that change when someone edits them - a handful
 * of times in a project's life - while an outage creates records by the
 * hundred.
 *
 * So each process keeps what a read returned, by project and read, under
 * the generation its project had when the read began (CacheGenerations, as
 * ProjectStateListCache, OnDutyPoliciesCache and StatusPageOverviewCache
 * keep theirs), and hands out copies of it until anything that read could
 * return changes. What a read returns is decided by the rules' own rows,
 * their lists, and the records those lists name, so a new generation starts
 * (DatabaseService calls the hooks below after each write, also a write
 * that skips the services' own hooks):
 *
 *   - of the project, on every create, update and delete of one of its
 *     rules (RULE_SET_MODELS) - a list of a rule is written with the rule;
 *   - of every project, on the delete of a record a rule's list or column
 *     can name (a label, a monitor, a team, a person, a severity, an on-call
 *     policy, a runbook, ...), and of any record whose delete the database
 *     carries on to those, read from the schema itself
 *     (getTablesWhoseDeleteChangesRules): the database takes the record out
 *     of every rule's list, or empties the rule's column, unseen. Every
 *     project, not only the record's: a rule saved before rules were held to
 *     their project can still name another project's record
 *     (RuleRecordScope);
 *   - of every project, on a write of a column a read takes from a named
 *     record (RELATED_COLUMNS_READ: a runbook's name) or of a named
 *     record's deletedAt (a join leaves out a record soft deleted), and on a
 *     write of a rule that skips the hooks (a column written by id).
 *
 * A change counts at once in the process that made it, and in every other
 * process within CacheGenerations.SHARED_READ_TTL_MS. An entry also runs out
 * after ENTRY_TTL_MS, so a write from outside OneUptime - a repair by hand -
 * is seen within minutes all the same. Nothing is kept while Redis is not
 * connected: a change made in another process could not be seen here, so
 * the rules are read every time, as before.
 *
 * What a read hands out is the same as a read of the database would be:
 * the same rules, in the same order, with the same lists. The rules handed
 * out are new instances every time, so no engine can change what the next
 * one reads. A read that fails is not kept.
 */

/*
 * The rules kept: those the create of an incident or an alert runs. A read
 * of any other model is read every time (and logged: a read added here must
 * be added to this list, so its writes start new generations).
 */
export const RULE_SET_MODELS: ReadonlyArray<{ new (): BaseModel }> = [
  IncidentPrivacyRule,
  IncidentOwnerRule,
  IncidentLabelRule,
  IncidentOnCallRule,
  IncidentGroupingRule,
  AlertPrivacyRule,
  AlertOwnerRule,
  AlertLabelRule,
  AlertOnCallRule,
  AlertGroupingRule,
  AlertIncidentRule,
  RunbookRule,
  AutoRemediationRule,
];

/*
 * The columns a read may take from the records a rule's lists name, beyond
 * their ids, by table: a write of one of them starts a new generation of
 * every project. A read that takes another is read every time (and logged).
 */
export const RELATED_COLUMNS_READ: Readonly<Record<string, Array<string>>> = {
  // The remediation rules' runbooks, by name (AutoRemediationRuleEngine).
  Runbook: ["name"],
};

// The column TypeORM leaves a joined record out by, when it is set.
const DELETED_AT_COLUMN: string = "deletedAt";

// The generation every project's reads are also kept under.
const EVERY_PROJECT_KEY: string = "*";

/*
 * Which tables a write of starts a new generation, worked out from the
 * schema of the data source the writes go to.
 */
interface RuleSetTables {
  // The rules' own tables, and the tables of their lists (junctions).
  ruleTables: Set<string>;
  // The tables of the records the rules' lists and columns name.
  namedTables: Set<string>;
  /*
   * The tables a delete of changes what a read returns: the rules' tables,
   * their lists', the records those name, and every table whose delete the
   * database carries on to one of these.
   */
  deleteTables: Set<string>;
}

// One read of a project's enabled rules, as an engine makes it.
export interface EnabledRulesRead<TModel extends BaseModel> {
  service: DatabaseService<TModel>;
  projectId: ObjectID;
  select: Select<TModel>;
  // Conditions beside the project and isEnabled: a trigger, plain values.
  query?: Query<TModel> | undefined;
  sort?: Sort<TModel> | undefined;
}

export default class RuleSetCache {
  // How long an entry is kept at most, whatever its generation says.
  public static readonly ENTRY_TTL_MS: number = 5 * 60 * 1000;

  // How long a generation is kept, many times an entry's life.
  public static readonly GENERATION_TTL_SECONDS: number = 24 * 60 * 60;

  // At most how many reads (a project's rules of one kind) a process keeps.
  public static readonly MAX_ENTRIES: number = 10_000;

  private static generations: CacheGenerations = new CacheGenerations({
    namespace: "rule-set-generation",
    ttlSeconds: RuleSetCache.GENERATION_TTL_SECONDS,
    maxKeys: RuleSetCache.MAX_ENTRIES,
    description: "projects' rules",
  });

  // What each read returned, by read, project and generation.
  private static entries: InMemoryTTLCache<Promise<Array<BaseModel>>> =
    new InMemoryTTLCache<Promise<Array<BaseModel>>>(RuleSetCache.MAX_ENTRIES);

  // The tables writes start new generations for, per data source.
  private static tablesBySource: WeakMap<DataSource, RuleSetTables> =
    new WeakMap<DataSource, RuleSetTables>();

  // The rules' own tables, from RULE_SET_MODELS (no data source needed).
  private static ruleModelTables: Set<string> | null = null;

  // Reads already logged as not kept, so each is logged once.
  private static readsLoggedAsNotKept: Set<string> = new Set<string>();

  /*
   * What getSelectKey made of each select, by table: engines hand the same
   * select object to every read, so each is looked through once.
   */
  private static selectKeys: WeakMap<
    Record<string, unknown>,
    Map<string, string | null>
  > = new WeakMap<Record<string, unknown>, Map<string, string | null>>();

  /*
   * The project's enabled rules of the service's kind, as
   *
   *   service.findBy({
   *     query: { projectId, isEnabled: true, ...query },
   *     select, sort, limit: MAX_RULES_EVALUATED_PER_PROJECT, skip: 0,
   *     props: { isRoot: true },
   *   })
   *
   * returns them: from what this process kept while nothing they depend on
   * changed, read otherwise (once for every caller that asks together).
   * Never throws more than that read would.
   */
  public static async findEnabledRules<TModel extends BaseModel>(
    read: EnabledRulesRead<TModel>,
  ): Promise<Array<TModel>> {
    const readFromDatabase: () => Promise<Array<TModel>> = async (): Promise<
      Array<TModel>
    > => {
      return await read.service.findBy({
        query: {
          projectId: read.projectId,
          isEnabled: true,
          ...(read.query || {}),
        } as Query<TModel>,
        select: read.select,
        ...(read.sort ? { sort: read.sort } : {}),
        limit: MAX_RULES_EVALUATED_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      });
    };

    if (!Redis.isConnected()) {
      return await readFromDatabase();
    }

    let key: string | null = null;

    try {
      key = await this.getEntryKey(read);
    } catch (err) {
      // What cannot be keyed is read, as before.
      logger.error(err);
    }

    if (!key) {
      return await readFromDatabase();
    }

    const entryKey: string = key;

    let rules: Promise<Array<BaseModel>> | undefined =
      this.entries.get(entryKey);

    if (!rules) {
      const reading: Promise<Array<BaseModel>> = readFromDatabase();
      rules = reading;
      this.entries.set(entryKey, reading, this.ENTRY_TTL_MS);

      // A read that failed is not kept: the next caller reads again.
      reading.catch((): void => {
        if (this.entries.get(entryKey) === reading) {
          this.entries.delete(entryKey);
        }
      });
    }

    return (await rules).map((rule: BaseModel): TModel => {
      return RuleSetCache.copy(rule) as TModel;
    });
  }

  /*
   * Where a read's rules are kept: the read, its project, and the
   * generations of the project and of every project - read before the
   * rules are, so a change made meanwhile starts a new one and what is read
   * is never asked for again. Null when the read is not kept (getReadKey).
   */
  private static async getEntryKey<TModel extends BaseModel>(
    read: EnabledRulesRead<TModel>,
  ): Promise<string | null> {
    const readKey: string | null = this.getReadKey(read);

    if (!readKey) {
      return null;
    }

    const projectKey: string = read.projectId.toString().toLowerCase();

    const [projectGeneration, everyProjectGeneration]: [string, string] =
      await Promise.all([
        this.generations.get(projectKey),
        this.generations.get(EVERY_PROJECT_KEY),
      ]);

    return [
      readKey,
      projectKey,
      projectGeneration,
      everyProjectGeneration,
    ].join("|");
  }

  /*
   * After a record is created: a rule starts a new generation of its
   * project. Never throws.
   */
  public static async afterCreate(data: {
    tableName: string | null | undefined;
    row: unknown;
  }): Promise<void> {
    await this.safely(async (): Promise<void> => {
      if (!data.tableName || !this.getRuleModelTables().has(data.tableName)) {
        return;
      }

      await this.forgetProjectsOfRows([data.row]);
    });
  }

  /*
   * After records are updated: a rule starts a new generation of its
   * project; a record a rule names, when the write can change what a read
   * takes from it, of every project. Never throws.
   */
  public static async afterUpdate(data: {
    tableName: string | null | undefined;
    rows: Array<unknown>;
    written: unknown;
  }): Promise<void> {
    await this.safely(async (): Promise<void> => {
      if (!data.tableName || data.rows.length === 0) {
        return;
      }

      if (this.getRuleModelTables().has(data.tableName)) {
        await this.forgetProjectsOfRows(data.rows);
        return;
      }

      if (this.isReadColumnOfNamedRecordWritten(data.tableName, data.written)) {
        await this.forgetEveryProject();
      }
    });
  }

  /*
   * After records are deleted: a rule starts a new generation of its
   * project; a record whose delete can change what a read returns, of every
   * project. Never throws.
   */
  public static async afterDelete(data: {
    tableName: string | null | undefined;
    rows: Array<unknown>;
  }): Promise<void> {
    await this.safely(async (): Promise<void> => {
      if (!data.tableName || data.rows.length === 0) {
        return;
      }

      if (this.getRuleModelTables().has(data.tableName)) {
        await this.forgetProjectsOfRows(data.rows);
        return;
      }

      const tables: RuleSetTables | null = this.getTables();

      if (tables?.deleteTables.has(data.tableName)) {
        await this.forgetEveryProject();
      }
    });
  }

  /*
   * After a write that skips the hooks (a column written by id, a counter):
   * one of a rule, or one that can change what a read takes from a record a
   * rule names, starts a new generation of every project - the write does
   * not say whose. Never throws.
   */
  public static async afterWriteWithoutHooks(data: {
    tableName: string | null | undefined;
    written: unknown;
  }): Promise<void> {
    await this.safely(async (): Promise<void> => {
      if (!data.tableName) {
        return;
      }

      if (
        this.getRuleModelTables().has(data.tableName) ||
        this.isReadColumnOfNamedRecordWritten(data.tableName, data.written)
      ) {
        await this.forgetEveryProject();
      }
    });
  }

  /*
   * Runs a hook so it never fails the write it follows: one that cannot
   * work out what changed starts a new generation of every project, rather
   * than leave one serving what it no longer has.
   */
  private static async safely(hook: () => Promise<void>): Promise<void> {
    try {
      await hook();
    } catch (err) {
      logger.error(err);
      await this.forgetEveryProject();
    }
  }

  /*
   * Starts a new generation of these projects' rules: nothing read before
   * is handed out again. Never throws.
   */
  public static async forgetProjects(
    projectIds: Array<ObjectID | string | null | undefined>,
  ): Promise<void> {
    const keys: Array<string> = Array.from(
      new Set<string>(
        projectIds
          .filter((projectId: ObjectID | string | null | undefined) => {
            return Boolean(projectId?.toString());
          })
          .map((projectId: ObjectID | string | null | undefined): string => {
            return projectId!.toString().toLowerCase();
          }),
      ),
    );

    if (keys.length === 0) {
      return;
    }

    await this.bump(keys);
  }

  // Starts a new generation of every project's rules. Never throws.
  public static async forgetEveryProject(): Promise<void> {
    await this.bump([EVERY_PROJECT_KEY]);
  }

  /*
   * The tables a write of starts a new generation, from the data source's
   * schema: null before there is one (no write reaches a database then).
   */
  public static getTables(): RuleSetTables | null {
    const dataSource: DataSource | null = PostgresAppInstance.getDataSource();

    if (!dataSource || !dataSource.entityMetadatas) {
      return null;
    }

    let tables: RuleSetTables | undefined = this.tablesBySource.get(dataSource);

    if (!tables) {
      tables = this.buildTables(dataSource.entityMetadatas);
      this.tablesBySource.set(dataSource, tables);
    }

    return tables;
  }

  /*
   * Worked out from the entities' metadata, which the schema is generated
   * from (the Postgres Schema Drift check holds the two together):
   *
   *   - the rules' tables, and the junction tables of their lists;
   *   - the tables of the records their relations name;
   *   - every table whose delete the database carries on (ON DELETE
   *     CASCADE) to one of those, or which a rule's own column refers to
   *     (ON DELETE SET NULL empties the column) - and so on, until nothing
   *     more is found.
   */
  public static buildTables(
    entityMetadatas: ReadonlyArray<EntityMetadata>,
  ): RuleSetTables {
    const ruleModelTables: Set<string> = this.getRuleModelTables();

    const ruleTables: Set<string> = new Set<string>(ruleModelTables);
    const namedTables: Set<string> = new Set<string>();

    for (const metadata of entityMetadatas) {
      if (!ruleModelTables.has(metadata.tableName)) {
        continue;
      }

      for (const relation of metadata.relations as Array<RelationMetadata>) {
        namedTables.add(relation.inverseEntityMetadata.tableName);

        if (relation.junctionEntityMetadata) {
          ruleTables.add(relation.junctionEntityMetadata.tableName);
        }
      }
    }

    const deleteTables: Set<string> = new Set<string>([
      ...ruleTables,
      ...namedTables,
    ]);

    let isGrowing: boolean = true;

    while (isGrowing) {
      isGrowing = false;

      for (const metadata of entityMetadatas) {
        if (!deleteTables.has(metadata.tableName)) {
          continue;
        }

        for (const foreignKey of metadata.foreignKeys as Array<ForeignKeyMetadata>) {
          const parentTable: string =
            foreignKey.referencedEntityMetadata.tableName;

          if (deleteTables.has(parentTable)) {
            continue;
          }

          /*
           * A delete of the parent removes this table's rows - or, for a
           * rule's own row, empties the column that names it.
           */
          const isCarriedOn: boolean =
            foreignKey.onDelete === "CASCADE" ||
            (ruleTables.has(metadata.tableName) &&
              (foreignKey.onDelete === "SET NULL" ||
                foreignKey.onDelete === "DEFAULT"));

          if (isCarriedOn) {
            deleteTables.add(parentTable);
            isGrowing = true;
          }
        }
      }
    }

    return { ruleTables, namedTables, deleteTables };
  }

  // Drops everything this process keeps. For tests.
  public static clear(): void {
    this.entries.clear();
    this.generations.clear();
    this.tablesBySource = new WeakMap<DataSource, RuleSetTables>();
    this.readsLoggedAsNotKept.clear();
    this.selectKeys = new WeakMap<
      Record<string, unknown>,
      Map<string, string | null>
    >();
  }

  /*
   * What a read is, as a key: the table, the columns and lists it selects,
   * its conditions and its order - or null when it is not kept: a read of a
   * model outside RULE_SET_MODELS, one that takes a column of a named
   * record outside RELATED_COLUMNS_READ (its writes would start no
   * generation), or one with a condition that is not a plain value.
   */
  public static getReadKey<TModel extends BaseModel>(
    read: EnabledRulesRead<TModel>,
  ): string | null {
    const model: TModel = read.service.getModel();
    const tableName: string = model.tableName || "";

    const selectKey: string | null = this.getSelectKey(
      model,
      tableName,
      read.select as Record<string, unknown>,
    );

    if (selectKey === null) {
      return null;
    }

    for (const [column, value] of Object.entries(
      (read.query || {}) as Record<string, unknown>,
    )) {
      if (
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean"
      ) {
        return this.notKept(
          tableName,
          `its condition on ${column} is not a plain value`,
        );
      }
    }

    return [
      selectKey,
      RuleSetCache.stableJson(read.query || {}),
      RuleSetCache.stableJson(read.sort || {}),
    ].join("|");
  }

  /*
   * The table and select of a read, as a key (see getReadKey), worked out
   * once per select object.
   */
  private static getSelectKey(
    model: BaseModel,
    tableName: string,
    select: Record<string, unknown>,
  ): string | null {
    let byTable: Map<string, string | null> | undefined =
      this.selectKeys.get(select);

    if (byTable?.has(tableName)) {
      return byTable.get(tableName)!;
    }

    const selectKey: string | null = this.buildSelectKey(
      model,
      tableName,
      select,
    );

    if (!byTable) {
      byTable = new Map<string, string | null>();
      this.selectKeys.set(select, byTable);
    }

    byTable.set(tableName, selectKey);

    return selectKey;
  }

  private static buildSelectKey(
    model: BaseModel,
    tableName: string,
    select: Record<string, unknown>,
  ): string | null {
    if (!tableName || !this.getRuleModelTables().has(tableName)) {
      return this.notKept(tableName, "the model is not one of RULE_SET_MODELS");
    }

    for (const [column, value] of Object.entries(
      select as Record<string, unknown>,
    )) {
      if (!value || typeof value !== "object") {
        continue;
      }

      const metadata: TableColumnMetadata | undefined =
        model.getTableColumnMetadata(column);

      const relatedTable: string | null | undefined =
        metadata &&
        (metadata.type === TableColumnType.Entity ||
          metadata.type === TableColumnType.EntityArray) &&
        metadata.modelType
          ? new metadata.modelType().tableName
          : undefined;

      if (!relatedTable) {
        return this.notKept(
          tableName,
          `it selects ${column}, which is not a relation`,
        );
      }

      for (const relatedColumn of Object.keys(
        value as Record<string, unknown>,
      )) {
        if (
          relatedColumn !== "_id" &&
          !(RELATED_COLUMNS_READ[relatedTable] || []).includes(relatedColumn)
        ) {
          return this.notKept(
            tableName,
            `it selects ${column}.${relatedColumn}, which is not in RELATED_COLUMNS_READ`,
          );
        }
      }
    }

    return [tableName, RuleSetCache.stableJson(select)].join("|");
  }

  // Says once why a read is read every time; null, for getReadKey.
  private static notKept(tableName: string, reason: string): null {
    const logKey: string = `${tableName}:${reason}`;

    if (!this.readsLoggedAsNotKept.has(logKey)) {
      this.readsLoggedAsNotKept.add(logKey);
      logger.error(
        `Rules of ${tableName || "an unknown table"} are read every time, not kept (RuleSetCache): ${reason}`,
      );
    }

    return null;
  }

  /*
   * A copy of a rule as read: a new instance of its class, with copies of
   * its lists, of the records in them and of its JSON columns, so nothing
   * done to it reaches what is kept.
   */
  public static copy<T>(value: T): T {
    return RuleSetCache.copyValue(value, 0) as T;
  }

  private static copyValue(value: unknown, depth: number): unknown {
    if (value === null || typeof value !== "object") {
      return value;
    }

    // Rules hold no cycles; this only keeps a bad value from looping.
    if (depth > 32) {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item: unknown): unknown => {
        return RuleSetCache.copyValue(item, depth + 1);
      });
    }

    if (value instanceof Date) {
      return new Date(value.getTime());
    }

    if (value instanceof ObjectID) {
      return new ObjectID(value.toString());
    }

    if (value instanceof Map) {
      return new Map(
        Array.from(value.entries()).map(
          ([key, item]: [unknown, unknown]): [unknown, unknown] => {
            return [key, RuleSetCache.copyValue(item, depth + 1)];
          },
        ),
      );
    }

    if (value instanceof Set) {
      return new Set(
        Array.from(value.values()).map((item: unknown): unknown => {
          return RuleSetCache.copyValue(item, depth + 1);
        }),
      );
    }

    // What holds its value outside its own keys is passed on as it is.
    if (value instanceof RegExp || ArrayBuffer.isView(value)) {
      return value;
    }

    const copied: Record<string, unknown> = Object.create(
      Object.getPrototypeOf(value),
    ) as Record<string, unknown>;

    for (const key of Object.keys(value as Record<string, unknown>)) {
      copied[key] = RuleSetCache.copyValue(
        (value as Record<string, unknown>)[key],
        depth + 1,
      );
    }

    return copied;
  }

  private static async bump(keys: Array<string>): Promise<void> {
    try {
      await this.generations.bump(keys);
    } catch (err) {
      // CacheGenerations does not throw; this is only ever a safety net.
      logger.error(err);
    }
  }

  private static async forgetProjectsOfRows(
    rows: Array<unknown>,
  ): Promise<void> {
    const projectIds: Array<string> = [];

    for (const row of rows) {
      const projectId: unknown = ((row || {}) as Record<string, unknown>)[
        "projectId"
      ];

      if (projectId === undefined || projectId === null || projectId === "") {
        /*
         * A rule whose project is not known here: every project, rather
         * than one left serving what it no longer has.
         */
        await this.forgetEveryProject();
        return;
      }

      projectIds.push(String(projectId));
    }

    await this.forgetProjects(projectIds);
  }

  // Whether a write of a table writes a column a read takes from it.
  private static isReadColumnOfNamedRecordWritten(
    tableName: string,
    written: unknown,
  ): boolean {
    const tables: RuleSetTables | null = this.getTables();

    if (!tables?.namedTables.has(tableName)) {
      return false;
    }

    const readColumns: Array<string> = [
      DELETED_AT_COLUMN,
      ...(RELATED_COLUMNS_READ[tableName] || []),
    ];

    return Object.entries((written || {}) as Record<string, unknown>).some(
      ([column, value]: [string, unknown]): boolean => {
        return value !== undefined && readColumns.includes(column);
      },
    );
  }

  private static getRuleModelTables(): Set<string> {
    if (!this.ruleModelTables) {
      this.ruleModelTables = new Set<string>(
        RULE_SET_MODELS.map((modelType: { new (): BaseModel }): string => {
          return new modelType().tableName || "";
        }).filter((tableName: string): boolean => {
          return Boolean(tableName);
        }),
      );
    }

    return this.ruleModelTables;
  }

  // JSON of a value with every object's keys in order: the same read, one key.
  private static stableJson(value: unknown): string {
    return JSON.stringify(value, (_key: string, item: unknown): unknown => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const sorted: Record<string, unknown> = {};

        for (const key of Object.keys(item as Record<string, unknown>).sort()) {
          sorted[key] = (item as Record<string, unknown>)[key];
        }

        return sorted;
      }

      return item;
    });
  }
}
