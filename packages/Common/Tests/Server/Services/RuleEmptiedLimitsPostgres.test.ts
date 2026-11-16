import Entities, {
  getModelTypeByName,
} from "../../../Models/DatabaseModels/Index";
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentOnCallRule from "../../../Models/DatabaseModels/IncidentOnCallRule";
import IncidentReminderRule from "../../../Models/DatabaseModels/IncidentReminderRule";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AuditLogService from "../../../Server/Services/AuditLogService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import logger from "../../../Server/Utils/Logger";
import RuleEmptiedLimits, {
  EmptiedLimitsOfDelete,
} from "../../../Server/Utils/Rules/RuleEmptiedLimits";
import {
  getRuleLimitLists,
  getRuleLimitListsOf,
  RuleLimitList,
  RuleLimitListKind,
} from "../../../Server/Utils/Rules/RuleLimitLists";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import BadDataException from "../../../Types/Exception/BadDataException";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import ObjectID from "../../../Types/ObjectID";
import {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import {
  readRuleEmptiedLimits,
  RuleEmptiedLimit,
} from "../../../Types/Rules/RuleEmptiedLimit";
import { DataSource, getMetadataArgsStorage } from "typeorm";
import { JoinTableMetadataArgs } from "typeorm/metadata-args/JoinTableMetadataArgs";

/*
 * A RULE IS NEVER WIDENED TO EVERYTHING BY A DELETE (#9066), on Postgres.
 *
 * Every list a rule can be limited to (RuleLimitLists: 152 match lists of
 * 87 rule kinds - monitors, incident and alert severities, every kind of
 * label list, services, network sites - and the AI rules' runbooks, code
 * repositories and external MCP servers) is run through the real delete
 * path, DatabaseService, on clones of the migrated tables carrying the
 * migrated foreign keys of every join table - so the cascade that empties a
 * list here is the one the migrations declared:
 *
 *   - the join tables really empty a list when its record is deleted
 *     (ON DELETE CASCADE, read from the migrated schema);
 *   - a rule limited to the deleted record alone is switched off and noted
 *     with the record's name; one that keeps another record, one saved
 *     empty on purpose, and - for a match list - one with conditions of its
 *     own are left exactly as they were; one off already is noted only;
 *   - a bulk delete, a retention purge (hardDeleteBy), a label in two lists
 *     of one rule, a rule of another project, a delete that fails and is
 *     put back, and a list emptied by a person between the reads and the
 *     DELETE;
 *   - switching such a rule on is refused until the list says something
 *     again, and clears the note;
 *   - the repair of existing installs finds the rules whose lists hold only
 *     soft-deleted records - and only those - and changes nothing on a
 *     second run.
 *
 * Opt in with RUN_POSTGRES_RULE_EMPTIED_LIMITS_TESTS=true against a
 * database the registered migrations have run on
 * (RULE_EMPTIED_LIMITS_TEST_DATABASE_HOST, _PORT, _NAME; DATABASE_USERNAME
 * / DATABASE_PASSWORD). The tables it writes are copied from public into a
 * schema of its own, every row is synthetic, and the schema is dropped
 * afterwards. CI runs it in .github/workflows/postgres-schema-drift.yaml.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_RULE_EMPTIED_LIMITS_TESTS"] === "true"
    ? describe
    : describe.skip;

type ModelType = { new (): BaseModel };

type Row = Record<string, unknown>;

const newId: () => string = (): string => {
  return ObjectID.generate().toString();
};

const LISTS: Array<RuleLimitList> = getRuleLimitLists();

const RULE_TABLES: Array<string> = Array.from(
  new Set<string>(
    LISTS.map((list: RuleLimitList): string => {
      return list.ruleTable;
    }),
  ),
).sort();

const JOIN_TABLES: Array<string> = Array.from(
  new Set<string>(
    LISTS.map((list: RuleLimitList): string => {
      return list.joinTable;
    }),
  ),
).sort();

const RECORD_TABLES: Array<string> = Array.from(
  new Set<string>(
    LISTS.map((list: RuleLimitList): string => {
      return list.recordTable;
    }),
  ),
).sort();

function modelOf(table: string): ModelType {
  const modelType: ModelType | null = getModelTypeByName(table);

  if (!modelType) {
    throw new Error(`No model for ${table}.`);
  }

  return modelType;
}

/*
 * The tables a delete of an audited record reads with it: it reads the
 * whole row, the records it links to included - a monitor's labels and
 * the monitors it depends on, who created it, its project.
 */
function tablesReadWith(table: string): Array<string> {
  const modelType: ModelType = modelOf(table);
  const model: BaseModel = new modelType();
  const tables: Array<string> = [];

  for (const column of model.getTableColumns().columns) {
    const metadata: TableColumnMetadata | undefined =
      model.getTableColumnMetadata(column);

    if (!metadata?.modelType) {
      continue;
    }

    if (
      metadata.type !== TableColumnType.Entity &&
      metadata.type !== TableColumnType.EntityArray
    ) {
      continue;
    }

    tables.push(new metadata.modelType().tableName!);

    const joinTable: JoinTableMetadataArgs | undefined =
      getMetadataArgsStorage().joinTables.find(
        (args: JoinTableMetadataArgs): boolean => {
          return args.target === modelType && args.propertyName === column;
        },
      );

    if (joinTable?.name) {
      tables.push(joinTable.name);
    }
  }

  return tables;
}

/*
 * Every table the suite writes, and the ones a delete of a record reads
 * with it; every other one is read, empty, from public.
 */
const TABLES: Array<string> = Array.from(
  new Set<string>([
    "Project",
    "User",
    ...RECORD_TABLES,
    ...RECORD_TABLES.flatMap(tablesReadWith),
    ...RULE_TABLES,
    ...JOIN_TABLES,
  ]),
).sort();

// A rule's conditions: about the list itself, for a match list.
function conditionsFor(list: RuleLimitList, recordId: string): unknown {
  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition: FilterCondition.All,
    filters:
      list.kind === RuleLimitListKind.Match
        ? [
            {
              field: list.list,
              operator: RuleCriteriaOperator.HasAnyOf,
              value: [recordId],
            },
          ]
        : [],
  };
}

describePostgres(
  "rules limited to deleted records, on Postgres (#9066)",
  () => {
    const schema: string = `rule_emptied_limits_${newId().replace(/-/g, "")}`;
    let database: DataSource;
    const columnsOf: Map<string, Set<string>> = new Map<string, Set<string>>();

    const insert: (table: string, values: Row) => Promise<void> = async (
      table: string,
      values: Row,
    ): Promise<void> => {
      const columns: Set<string> | undefined = columnsOf.get(table);

      if (!columns) {
        throw new Error(`${table} was not cloned.`);
      }

      const keys: Array<string> = Object.keys(values).filter(
        (key: string): boolean => {
          return columns.has(key);
        },
      );

      await database.query(
        `INSERT INTO "${schema}"."${table}" (${keys
          .map((key: string): string => {
            return `"${key}"`;
          })
          .join(", ")}) VALUES (${keys
          .map((_key: string, index: number): string => {
            return `$${index + 1}`;
          })
          .join(", ")})`,
        keys.map((key: string): unknown => {
          const value: unknown = values[key];

          return value !== null &&
            typeof value === "object" &&
            !(value instanceof Date)
            ? JSON.stringify(value)
            : value;
        }),
      );
    };

    const insertProject: () => Promise<string> = async (): Promise<string> => {
      const projectId: string = newId();
      await insert("Project", {
        _id: projectId,
        name: `Project ${projectId}`,
        slug: `project-${projectId}`,
        version: 1,
      });
      return projectId;
    };

    const insertRecord: (data: {
      table: string;
      projectId: string;
      name: string;
      deletedAt?: Date | undefined;
    }) => Promise<string> = async (data: {
      table: string;
      projectId: string;
      name: string;
      deletedAt?: Date | undefined;
    }): Promise<string> => {
      const recordId: string = newId();
      await insert(data.table, {
        _id: recordId,
        projectId: data.projectId,
        name: data.name,
        slug: `${data.table.toLowerCase()}-${recordId}`,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: data.deletedAt || null,
      });
      return recordId;
    };

    const insertRule: (data: {
      list: RuleLimitList;
      projectId: string;
      name: string;
      isEnabled: boolean | null;
      recordIds: Array<string>;
      criteria?: unknown;
    }) => Promise<string> = async (data: {
      list: RuleLimitList;
      projectId: string;
      name: string;
      isEnabled: boolean | null;
      recordIds: Array<string>;
      criteria?: unknown;
    }): Promise<string> => {
      const ruleId: string = newId();
      await insert(data.list.ruleTable, {
        _id: ruleId,
        projectId: data.projectId,
        name: data.name,
        isEnabled: data.isEnabled,
        criteria: data.criteria ?? null,
        triggerEntityType: "Incident",
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      for (const recordId of data.recordIds) {
        await insert(data.list.joinTable, {
          [data.list.ruleColumn]: ruleId,
          [data.list.recordColumn]: recordId,
        });
      }

      return ruleId;
    };

    interface RuleRow {
      isEnabled: boolean | null;
      emptiedLimits: Array<RuleEmptiedLimit>;
      rawEmptiedLimits: unknown;
      version: number;
      recordIds: Array<string>;
    }

    const readRule: (
      list: RuleLimitList,
      ruleId: string,
    ) => Promise<RuleRow> = async (
      list: RuleLimitList,
      ruleId: string,
    ): Promise<RuleRow> => {
      const rows: Array<Row> = await database.query(
        `SELECT "isEnabled", "emptiedLimits", "version" FROM "${schema}"."${list.ruleTable}" WHERE "_id" = $1`,
        [ruleId],
      );
      const held: Array<Row> = await database.query(
        `SELECT "${list.recordColumn}"::text AS "recordId" FROM "${schema}"."${list.joinTable}" WHERE "${list.ruleColumn}" = $1 ORDER BY 1`,
        [ruleId],
      );

      return {
        isEnabled: rows[0]!["isEnabled"] as boolean | null,
        emptiedLimits: readRuleEmptiedLimits(rows[0]!["emptiedLimits"]),
        rawEmptiedLimits: rows[0]!["emptiedLimits"],
        version: Number(rows[0]!["version"]),
        recordIds: held.map((row: Row): string => {
          return String(row["recordId"]);
        }),
      };
    };

    const serviceOf: (table: string) => DatabaseService<BaseModel> = (
      table: string,
    ): DatabaseService<BaseModel> => {
      return new DatabaseService<BaseModel>(modelOf(table));
    };

    // A delete as OneUptime makes one: through DatabaseService, as root.
    const deleteRecords: (
      table: string,
      recordIds: Array<string>,
      method?: "deleteBy" | "hardDeleteBy",
    ) => Promise<number> = async (
      table: string,
      recordIds: Array<string>,
      method: "deleteBy" | "hardDeleteBy" = "deleteBy",
    ): Promise<number> => {
      return await serviceOf(table)[method]({
        query: {
          _id: QueryHelper.any(
            recordIds.map((recordId: string): ObjectID => {
              return new ObjectID(recordId);
            }),
          ),
        } as never,
        limit: 100,
        skip: 0,
        props: { isRoot: true },
      });
    };

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["RULE_EMPTIED_LIMITS_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["RULE_EMPTIED_LIMITS_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["RULE_EMPTIED_LIMITS_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema: schema,
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();

      /*
       * The migrated join tables' foreign keys, read before the clones exist
       * so their definitions name the tables they refer to without a schema.
       */
      const foreignKeys: Array<{
        table: string;
        name: string;
        definition: string;
      }> = await database.query(
        `SELECT t.relname AS "table", c.conname AS "name", pg_get_constraintdef(c.oid) AS "definition"
           FROM pg_constraint c
           JOIN pg_class t ON t.oid = c.conrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = 'public' AND t.relname = ANY($1) AND c.contype = 'f'`,
        [JOIN_TABLES],
      );

      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );

        const columns: Array<{
          column_name: string;
          is_nullable: string;
          in_primary_key: boolean;
        }> = await database.query(
          `SELECT c.column_name, c.is_nullable,
                EXISTS (
                  SELECT 1
                    FROM information_schema.table_constraints t
                    JOIN information_schema.key_column_usage k
                      ON k.constraint_name = t.constraint_name
                     AND k.table_schema = t.table_schema
                     AND k.table_name = t.table_name
                   WHERE t.table_schema = c.table_schema
                     AND t.table_name = c.table_name
                     AND t.constraint_type = 'PRIMARY KEY'
                     AND k.column_name = c.column_name
                ) AS in_primary_key
           FROM information_schema.columns c
          WHERE c.table_schema = $1 AND c.table_name = $2`,
          [schema, table],
        );

        columnsOf.set(
          table,
          new Set<string>(
            columns.map((column: { column_name: string }): string => {
              return column.column_name;
            }),
          ),
        );

        // A fixture writes only what the code under test reads.
        for (const column of columns) {
          if (column.is_nullable === "NO" && !column.in_primary_key) {
            await database.query(
              `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
            );
          }
        }
      }

      for (const foreignKey of foreignKeys) {
        await database.query(
          `ALTER TABLE "${schema}"."${foreignKey.table}" ADD CONSTRAINT "${foreignKey.name}" ${foreignKey.definition.replace(
            /REFERENCES public\./g,
            "REFERENCES ",
          )}`,
        );
      }

      const currentSchema: Array<{ current_schema: string }> =
        await database.query("SELECT current_schema()");
      expect(currentSchema[0]?.current_schema).toBe(schema);
    }, 600_000);

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(() => {
      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);
      jest
        .spyOn(DatabaseService.prototype, "onTriggerWorkflow")
        .mockResolvedValue(undefined);
      jest
        .spyOn(DatabaseService.prototype, "onTriggerRealtime")
        .mockResolvedValue(undefined);
      jest.spyOn(AuditLogService, "recordDelete").mockResolvedValue(undefined);
      jest.spyOn(AuditLogService, "recordUpdate").mockResolvedValue(undefined);
      jest.spyOn(AuditLogService, "recordCreate").mockResolvedValue(undefined);

      for (const level of ["debug", "info", "warn"] as const) {
        jest.spyOn(logger, level).mockImplementation(() => {
          return undefined as never;
        });
      }
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("every join table of a list is emptied of a record by the database when the record is deleted", async () => {
      const rows: Array<{
        table: string;
        column: string;
        referenced: string;
        onDelete: string;
      }> = await database.query(
        `SELECT t.relname AS "table", a.attname AS "column", r.relname AS "referenced", c.confdeltype AS "onDelete"
           FROM pg_constraint c
           JOIN pg_class t ON t.oid = c.conrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
           JOIN pg_class r ON r.oid = c.confrelid
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
          WHERE n.nspname = 'public' AND t.relname = ANY($1) AND c.contype = 'f'`,
        [JOIN_TABLES],
      );

      const missing: Array<string> = LISTS.filter(
        (list: RuleLimitList): boolean => {
          return !rows.some(
            (row: {
              table: string;
              column: string;
              referenced: string;
              onDelete: string;
            }) => {
              return (
                row.table === list.joinTable &&
                row.column === list.recordColumn &&
                row.referenced === list.recordTable &&
                row.onDelete === "c"
              );
            },
          );
        },
      ).map((list: RuleLimitList): string => {
        return `${list.ruleTable}.${list.list}`;
      });

      expect(missing).toEqual([]);
      expect(LISTS.length).toBeGreaterThanOrEqual(155);
    });

    describe.each(
      LISTS.map((list: RuleLimitList) => {
        return { name: `${list.ruleTable}.${list.list}`, list: list };
      }),
    )("$name", ({ list }: { name: string; list: RuleLimitList }) => {
      test("deleting the only record switches the rule off, and leaves every other rule as it was", async () => {
        const projectId: string = await insertProject();
        const deleted: string = await insertRecord({
          table: list.recordTable,
          projectId: projectId,
          name: `Checkout ${list.list}`,
        });
        const kept: string = await insertRecord({
          table: list.recordTable,
          projectId: projectId,
          name: `Billing ${list.list}`,
        });

        // A reminder rule with conditions stores its switch in them.
        const enabledWithConditions: boolean | null = list.ruleTable.endsWith(
          "ReminderRule",
        )
          ? null
          : true;

        const onlyThat: string = await insertRule({
          list,
          projectId,
          name: "Only that one",
          isEnabled: true,
          recordIds: [deleted],
        });
        const twoOfThem: string = await insertRule({
          list,
          projectId,
          name: "Two of them",
          isEnabled: true,
          recordIds: [deleted, kept],
        });
        const emptyOnPurpose: string = await insertRule({
          list,
          projectId,
          name: "Every one on purpose",
          isEnabled: true,
          recordIds: [],
        });
        const offAlready: string = await insertRule({
          list,
          projectId,
          name: "Off already",
          isEnabled: false,
          recordIds: [deleted],
        });
        const withConditions: string = await insertRule({
          list,
          projectId,
          name: "With conditions",
          isEnabled: enabledWithConditions,
          recordIds: [deleted],
          criteria: conditionsFor(list, deleted),
        });

        const before: Map<string, RuleRow> = new Map<string, RuleRow>();
        for (const ruleId of [twoOfThem, emptyOnPurpose, withConditions]) {
          before.set(ruleId, await readRule(list, ruleId));
        }

        expect(await deleteRecords(list.recordTable, [deleted])).toBe(1);

        // Switched off, with the record's name, and its list emptied by the database.
        const switchedOff: RuleRow = await readRule(list, onlyThat);
        expect(switchedOff.isEnabled).toBe(false);
        expect(switchedOff.recordIds).toEqual([]);
        expect(switchedOff.emptiedLimits).toEqual([
          {
            list: list.list,
            names: [`Checkout ${list.list}`],
            count: 1,
            deletedAt: expect.any(String),
            switchedOff: true,
          },
        ]);

        // Off already: noted, still off.
        const noted: RuleRow = await readRule(list, offAlready);
        expect(noted.isEnabled).toBe(false);
        expect(noted.emptiedLimits).toEqual([
          expect.objectContaining({ list: list.list, switchedOff: false }),
        ]);

        // Keeps its other record: as it was, less the deleted record.
        const keepsOne: RuleRow = await readRule(list, twoOfThem);
        expect(keepsOne.isEnabled).toBe(true);
        expect(keepsOne.rawEmptiedLimits).toBeNull();
        expect(keepsOne.recordIds).toEqual([kept]);
        expect(keepsOne.version).toBe(before.get(twoOfThem)!.version);

        // Saved empty on purpose: never touched.
        expect(await readRule(list, emptyOnPurpose)).toEqual(
          before.get(emptyOnPurpose),
        );

        const conditions: RuleRow = await readRule(list, withConditions);

        if (list.kind === RuleLimitListKind.Match) {
          // Its conditions decide, and keep the deleted record's id: untouched.
          expect(conditions.isEnabled).toBe(enabledWithConditions);
          expect(conditions.rawEmptiedLimits).toBeNull();
          expect(conditions.version).toBe(before.get(withConditions)!.version);
        } else {
          // What it may use is its list whatever its conditions: switched off.
          expect(conditions.isEnabled).toBe(false);
          expect(conditions.emptiedLimits).toHaveLength(1);
        }
      });
    });

    describe("deletes of several records, and of records in several lists", () => {
      const monitors: RuleLimitList = getRuleLimitListsOf(
        "IncidentOnCallRule",
      ).find((list: RuleLimitList): boolean => {
        return list.list === "monitors";
      })!;
      const incidentLabels: RuleLimitList = getRuleLimitListsOf(
        "IncidentOnCallRule",
      ).find((list: RuleLimitList): boolean => {
        return list.list === "incidentLabels";
      })!;
      const monitorLabels: RuleLimitList = getRuleLimitListsOf(
        "IncidentOnCallRule",
      ).find((list: RuleLimitList): boolean => {
        return list.list === "monitorLabels";
      })!;

      test("a bulk delete of every record a rule holds switches it off once, naming them all", async () => {
        const projectId: string = await insertProject();
        const names: Array<string> = [
          "Zeta",
          "Alpha",
          "Mu",
          "Beta",
          "Kappa",
          "Eta",
        ];
        const recordIds: Array<string> = [];
        for (const name of names) {
          recordIds.push(
            await insertRecord({ table: "Monitor", projectId, name }),
          );
        }
        const ruleId: string = await insertRule({
          list: monitors,
          projectId,
          name: "Six monitors",
          isEnabled: true,
          recordIds: recordIds,
        });

        expect(await deleteRecords("Monitor", recordIds)).toBe(6);

        const rule: RuleRow = await readRule(monitors, ruleId);
        expect(rule.isEnabled).toBe(false);
        expect(rule.emptiedLimits).toEqual([
          expect.objectContaining({
            list: "monitors",
            // The first five by name, and how many there were.
            names: ["Alpha", "Beta", "Eta", "Kappa", "Mu"],
            count: 6,
          }),
        ]);
      });

      test("a label in two lists of one rule is noted in both, with one write", async () => {
        const projectId: string = await insertProject();
        const labelId: string = await insertRecord({
          table: "Label",
          projectId,
          name: "Production",
        });
        const ruleId: string = await insertRule({
          list: incidentLabels,
          projectId,
          name: "Production, twice",
          isEnabled: true,
          recordIds: [labelId],
        });
        await insert(monitorLabels.joinTable, {
          [monitorLabels.ruleColumn]: ruleId,
          [monitorLabels.recordColumn]: labelId,
        });

        await deleteRecords("Label", [labelId]);

        const rule: RuleRow = await readRule(incidentLabels, ruleId);
        expect(rule.isEnabled).toBe(false);
        expect(
          rule.emptiedLimits
            .map((entry: RuleEmptiedLimit): string => {
              return entry.list;
            })
            .sort(),
        ).toEqual(["incidentLabels", "monitorLabels"]);
        // Switched off by the one write: its version moved once.
        expect(rule.version).toBe(2);
      });

      test("a rule of another project that names the record is switched off too", async () => {
        const projectId: string = await insertProject();
        const otherProjectId: string = await insertProject();
        const monitorId: string = await insertRecord({
          table: "Monitor",
          projectId,
          name: "Checkout",
        });
        const ruleId: string = await insertRule({
          list: monitors,
          projectId: otherProjectId,
          name: "Saved before rules were held to their project",
          isEnabled: true,
          recordIds: [monitorId],
        });

        await deleteRecords("Monitor", [monitorId]);

        expect((await readRule(monitors, ruleId)).isEnabled).toBe(false);
      });

      test("a record nothing holds is deleted with no write to any rule", async () => {
        const projectId: string = await insertProject();
        const monitorId: string = await insertRecord({
          table: "Monitor",
          projectId,
          name: "Nobody's",
        });
        const spy: jest.SpyInstance = jest.spyOn(
          RuleEmptiedLimits as never,
          "writeNotes" as never,
        );

        expect(await deleteRecords("Monitor", [monitorId])).toBe(1);
        expect(spy).not.toHaveBeenCalled();
      });

      test("a retention purge of a soft-deleted record switches the rule off as a delete does", async () => {
        const projectId: string = await insertProject();
        const monitorId: string = await insertRecord({
          table: "Monitor",
          projectId,
          name: "Retired SNMP monitor",
          deletedAt: new Date("2025-01-01T00:00:00.000Z"),
        });
        const ruleId: string = await insertRule({
          list: monitors,
          projectId,
          name: "Page for the retired monitor",
          isEnabled: true,
          recordIds: [monitorId],
        });

        expect(
          await deleteRecords("Monitor", [monitorId], "hardDeleteBy"),
        ).toBe(1);

        const rule: RuleRow = await readRule(monitors, ruleId);
        expect(rule.isEnabled).toBe(false);
        expect(rule.emptiedLimits).toEqual([
          expect.objectContaining({
            list: "monitors",
            names: ["Retired SNMP monitor"],
          }),
        ]);
      });

      test("a rule that keeps only a soft-deleted record is left with no record that is read: switched off", async () => {
        const projectId: string = await insertProject();
        const live: string = await insertRecord({
          table: "Monitor",
          projectId,
          name: "Live",
        });
        const softDeleted: string = await insertRecord({
          table: "Monitor",
          projectId,
          name: "Soft deleted",
          deletedAt: new Date(),
        });
        const ruleId: string = await insertRule({
          list: monitors,
          projectId,
          name: "Live and soft deleted",
          isEnabled: true,
          recordIds: [live, softDeleted],
        });

        await deleteRecords("Monitor", [live]);

        expect((await readRule(monitors, ruleId)).isEnabled).toBe(false);
      });
    });

    describe("a delete racing an edit, and a delete that fails", () => {
      const monitors: RuleLimitList = getRuleLimitListsOf(
        "IncidentOnCallRule",
      ).find((list: RuleLimitList): boolean => {
        return list.list === "monitors";
      })!;

      test("a rule whose other record is taken out between the reads and the DELETE is switched off after it", async () => {
        const projectId: string = await insertProject();
        const deleted: string = await insertRecord({
          table: "Monitor",
          projectId,
          name: "Checkout",
        });
        const other: string = await insertRecord({
          table: "Monitor",
          projectId,
          name: "Billing",
        });
        const ruleId: string = await insertRule({
          list: monitors,
          projectId,
          name: "Checkout and Billing",
          isEnabled: true,
          recordIds: [deleted, other],
        });

        const beforeDelete: typeof RuleEmptiedLimits.beforeDelete =
          RuleEmptiedLimits.beforeDelete.bind(RuleEmptiedLimits);

        jest
          .spyOn(RuleEmptiedLimits, "beforeDelete")
          .mockImplementation(
            async (
              data: Parameters<typeof RuleEmptiedLimits.beforeDelete>[0],
            ): Promise<EmptiedLimitsOfDelete | null> => {
              const of: EmptiedLimitsOfDelete | null = await beforeDelete(data);
              // A person takes Billing out of the rule meanwhile.
              await database.query(
                `DELETE FROM "${schema}"."${monitors.joinTable}" WHERE "${monitors.ruleColumn}" = $1 AND "${monitors.recordColumn}" = $2`,
                [ruleId, other],
              );
              return of;
            },
          );

        await deleteRecords("Monitor", [deleted]);

        const rule: RuleRow = await readRule(monitors, ruleId);
        expect(rule.isEnabled).toBe(false);
        expect(rule.emptiedLimits).toEqual([
          expect.objectContaining({ list: "monitors", names: ["Checkout"] }),
        ]);
      });

      test("a DELETE that fails puts the rules back as they were", async () => {
        const projectId: string = await insertProject();
        const monitorId: string = await insertRecord({
          table: "Monitor",
          projectId,
          name: "Held by a key",
        });
        const ruleId: string = await insertRule({
          list: monitors,
          projectId,
          name: "Checkout only",
          isEnabled: true,
          recordIds: [monitorId],
        });
        const before: RuleRow = await readRule(monitors, ruleId);

        // Something else refers to the monitor and refuses its delete.
        const holder: string = `holder_${newId().replace(/-/g, "")}`;
        await database.query(
          `CREATE TABLE "${schema}"."${holder}" ("monitorId" uuid REFERENCES "${schema}"."Monitor"("_id") ON DELETE RESTRICT)`,
        );
        await database.query(
          `INSERT INTO "${schema}"."${holder}" ("monitorId") VALUES ($1)`,
          [monitorId],
        );

        await expect(deleteRecords("Monitor", [monitorId])).rejects.toThrow();

        const after: RuleRow = await readRule(monitors, ruleId);
        expect(after.isEnabled).toBe(true);
        expect(after.rawEmptiedLimits).toBeNull();
        expect(after.recordIds).toEqual([monitorId]);
        expect(after.version).toBeGreaterThan(before.version);

        await database.query(`DROP TABLE "${schema}"."${holder}"`);
      });

      test("a delete whose rules cannot be switched off is refused, and nothing is deleted", async () => {
        const projectId: string = await insertProject();
        const monitorId: string = await insertRecord({
          table: "Monitor",
          projectId,
          name: "Checkout",
        });
        const ruleId: string = await insertRule({
          list: monitors,
          projectId,
          name: "Checkout only",
          isEnabled: true,
          recordIds: [monitorId],
        });

        jest
          .spyOn(RuleEmptiedLimits as never, "writeNotes" as never)
          .mockRejectedValue(new Error("could not write") as never);

        await expect(deleteRecords("Monitor", [monitorId])).rejects.toThrow();

        const rule: RuleRow = await readRule(monitors, ruleId);
        expect(rule.isEnabled).toBe(true);
        expect(rule.recordIds).toEqual([monitorId]);
      });
    });

    describe("switching such a rule on again", () => {
      const monitors: RuleLimitList = getRuleLimitListsOf(
        "IncidentOnCallRule",
      ).find((list: RuleLimitList): boolean => {
        return list.list === "monitors";
      })!;
      const runbooks: RuleLimitList = getRuleLimitListsOf(
        "AutoRemediationRule",
      ).find((list: RuleLimitList): boolean => {
        return list.list === "runbooks";
      })!;
      const reminderLabels: RuleLimitList = getRuleLimitListsOf(
        "IncidentReminderRule",
      ).find((list: RuleLimitList): boolean => {
        return list.list === "labels";
      })!;

      const onCallRules: DatabaseService<IncidentOnCallRule> =
        new DatabaseService<IncidentOnCallRule>(IncidentOnCallRule);
      const aiRules: DatabaseService<AutoRemediationRule> =
        new DatabaseService<AutoRemediationRule>(AutoRemediationRule);
      const reminderRules: DatabaseService<IncidentReminderRule> =
        new DatabaseService<IncidentReminderRule>(IncidentReminderRule);

      const switchedOffRule: (
        list: RuleLimitList,
      ) => Promise<{ projectId: string; ruleId: string }> = async (
        list: RuleLimitList,
      ): Promise<{ projectId: string; ruleId: string }> => {
        const projectId: string = await insertProject();
        const recordId: string = await insertRecord({
          table: list.recordTable,
          projectId,
          name: "Checkout",
        });
        const ruleId: string = await insertRule({
          list,
          projectId,
          name: "Checkout only",
          isEnabled: true,
          recordIds: [recordId],
        });
        await deleteRecords(list.recordTable, [recordId]);
        expect((await readRule(list, ruleId)).isEnabled).toBe(false);
        return { projectId, ruleId };
      };

      test("is refused while the list is still empty, saying what was deleted", async () => {
        const { ruleId } = await switchedOffRule(monitors);

        await expect(
          onCallRules.updateOneById({
            id: new ObjectID(ruleId),
            data: { isEnabled: true },
            props: { isRoot: true },
          }),
        ).rejects.toThrow(BadDataException);

        await expect(
          onCallRules.updateOneById({
            id: new ObjectID(ruleId),
            data: { isEnabled: true },
            props: { isRoot: true },
          }),
        ).rejects.toThrow(
          /every record it was limited to in Monitors was deleted: Checkout/,
        );

        const rule: RuleRow = await readRule(monitors, ruleId);
        expect(rule.isEnabled).toBe(false);
        expect(rule.emptiedLimits).toHaveLength(1);
      });

      test("is let through when the same write says the list is empty on purpose, and clears the note", async () => {
        const { ruleId } = await switchedOffRule(monitors);

        await onCallRules.updateOneById({
          id: new ObjectID(ruleId),
          data: { isEnabled: true, monitors: [] } as never,
          props: { isRoot: true },
        });

        const rule: RuleRow = await readRule(monitors, ruleId);
        expect(rule.isEnabled).toBe(true);
        expect(rule.rawEmptiedLimits).toBeNull();
      });

      test("is let through once the list holds a record again", async () => {
        const { projectId, ruleId } = await switchedOffRule(monitors);
        const billing: string = await insertRecord({
          table: "Monitor",
          projectId,
          name: "Billing",
        });

        await onCallRules.updateOneById({
          id: new ObjectID(ruleId),
          data: { monitors: [new ObjectID(billing)] } as never,
          props: { isRoot: true },
        });

        // Still off, and still saying why, until it is switched on.
        expect((await readRule(monitors, ruleId)).emptiedLimits).toHaveLength(
          1,
        );

        await onCallRules.updateOneById({
          id: new ObjectID(ruleId),
          data: { isEnabled: true },
          props: { isRoot: true },
        });

        const rule: RuleRow = await readRule(monitors, ruleId);
        expect(rule.isEnabled).toBe(true);
        expect(rule.rawEmptiedLimits).toBeNull();
        expect(rule.recordIds).toEqual([billing]);
      });

      test("is let through when the write gives the rule conditions of its own, for a match list", async () => {
        const { ruleId } = await switchedOffRule(monitors);

        await onCallRules.updateOneById({
          id: new ObjectID(ruleId),
          data: {
            isEnabled: true,
            criteria: {
              schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
              filterCondition: FilterCondition.All,
              filters: [],
            },
          } as never,
          props: { isRoot: true },
        });

        const rule: RuleRow = await readRule(monitors, ruleId);
        expect(rule.isEnabled).toBe(true);
        expect(rule.rawEmptiedLimits).toBeNull();
      });

      test("is refused for an AI rule's runbooks whatever its conditions, until the write says what it may run", async () => {
        const { ruleId } = await switchedOffRule(runbooks);

        await expect(
          aiRules.updateOneById({
            id: new ObjectID(ruleId),
            data: {
              isEnabled: true,
              criteria: {
                schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
                filterCondition: FilterCondition.All,
                filters: [],
              },
            } as never,
            props: { isRoot: true },
          }),
        ).rejects.toThrow(/Runbooks/);

        await aiRules.updateOneById({
          id: new ObjectID(ruleId),
          data: { isEnabled: true, runbooks: [] } as never,
          props: { isRoot: true },
        });

        expect((await readRule(runbooks, ruleId)).isEnabled).toBe(true);
      });

      test("is refused for a reminder rule too, whose switch its conditions hold once it has them", async () => {
        const { ruleId } = await switchedOffRule(reminderLabels);

        await expect(
          reminderRules.updateOneById({
            id: new ObjectID(ruleId),
            data: { isEnabled: true },
            props: { isRoot: true },
          }),
        ).rejects.toThrow(BadDataException);

        await reminderRules.updateOneById({
          id: new ObjectID(ruleId),
          data: { isEnabled: true, labels: [] } as never,
          props: { isRoot: true },
        });

        const rule: RuleRow = await readRule(reminderLabels, ruleId);
        expect(rule.isEnabled).toBe(true);
        expect(rule.rawEmptiedLimits).toBeNull();
      });

      test("a write that keeps the rule off is never refused", async () => {
        const { ruleId } = await switchedOffRule(monitors);

        await onCallRules.updateOneById({
          id: new ObjectID(ruleId),
          data: { name: "Renamed while off" },
          props: { isRoot: true },
        });

        expect((await readRule(monitors, ruleId)).emptiedLimits).toHaveLength(
          1,
        );
      });
    });

    describe("rules emptied before this release: the repair", () => {
      const monitors: RuleLimitList = getRuleLimitListsOf(
        "IncidentOnCallRule",
      ).find((list: RuleLimitList): boolean => {
        return list.list === "monitors";
      })!;
      const hostLabels: RuleLimitList = getRuleLimitListsOf(
        "HostLabelRule",
      ).find((list: RuleLimitList): boolean => {
        return list.list === "hostLabels";
      })!;

      test("switches off only the rules whose lists hold records that are all soft deleted, once", async () => {
        const projectId: string = await insertProject();
        const softDeleted: string = await insertRecord({
          table: "Monitor",
          projectId,
          name: "Retired SNMP monitor",
          deletedAt: new Date("2025-03-04T05:06:07.000Z"),
        });
        const live: string = await insertRecord({
          table: "Monitor",
          projectId,
          name: "Live",
        });
        const softDeletedLabel: string = await insertRecord({
          table: "Label",
          projectId,
          name: "Old label",
          deletedAt: new Date("2025-03-04T05:06:07.000Z"),
        });

        const onlySoftDeleted: string = await insertRule({
          list: monitors,
          projectId,
          name: "Only the retired monitor",
          isEnabled: true,
          recordIds: [softDeleted],
        });
        const alsoLive: string = await insertRule({
          list: monitors,
          projectId,
          name: "Retired and live",
          isEnabled: true,
          recordIds: [softDeleted, live],
        });
        const emptyOnPurpose: string = await insertRule({
          list: monitors,
          projectId,
          name: "Every monitor on purpose",
          isEnabled: true,
          recordIds: [],
        });
        const withConditions: string = await insertRule({
          list: monitors,
          projectId,
          name: "With conditions",
          isEnabled: true,
          recordIds: [softDeleted],
          criteria: conditionsFor(monitors, softDeleted),
        });
        const labelRule: string = await insertRule({
          list: hostLabels,
          projectId,
          name: "Hosts with the old label",
          isEnabled: false,
          recordIds: [softDeletedLabel],
        });

        expect(
          await RuleEmptiedLimits.switchOffRulesLimitedOnlyToDeletedRecords(),
        ).toBeGreaterThanOrEqual(2);

        const switchedOff: RuleRow = await readRule(monitors, onlySoftDeleted);
        expect(switchedOff.isEnabled).toBe(false);
        expect(switchedOff.emptiedLimits).toEqual([
          {
            list: "monitors",
            names: ["Retired SNMP monitor"],
            count: 1,
            deletedAt: "2025-03-04T05:06:07.000Z",
            switchedOff: true,
          },
        ]);
        // The join row stays: the record is still there, soft deleted.
        expect(switchedOff.recordIds).toEqual([softDeleted]);

        const labelled: RuleRow = await readRule(hostLabels, labelRule);
        expect(labelled.isEnabled).toBe(false);
        expect(labelled.emptiedLimits).toEqual([
          expect.objectContaining({ list: "hostLabels", switchedOff: false }),
        ]);

        for (const untouched of [alsoLive, emptyOnPurpose, withConditions]) {
          const rule: RuleRow = await readRule(monitors, untouched);
          expect(rule.isEnabled).toBe(true);
          expect(rule.rawEmptiedLimits).toBeNull();
          expect(rule.version).toBe(1);
        }

        // A second run changes nothing.
        const versionBefore: number = switchedOff.version;
        await RuleEmptiedLimits.switchOffRulesLimitedOnlyToDeletedRecords();
        expect((await readRule(monitors, onlySoftDeleted)).version).toBe(
          versionBefore,
        );
      });

      test("the rules read a list of soft-deleted records as empty - which is why the repair switches them off", async () => {
        const projectId: string = await insertProject();
        const softDeleted: string = await insertRecord({
          table: "Monitor",
          projectId,
          name: "Soft deleted",
          deletedAt: new Date(),
        });
        const ruleId: string = await insertRule({
          list: monitors,
          projectId,
          name: "Reads as every monitor",
          isEnabled: true,
          recordIds: [softDeleted],
        });

        const rule: IncidentOnCallRule | null =
          await new DatabaseService<IncidentOnCallRule>(
            IncidentOnCallRule,
          ).findOneById({
            id: new ObjectID(ruleId),
            select: { _id: true, monitors: { _id: true } },
            props: { isRoot: true },
          });

        expect(rule?.monitors || []).toEqual([]);
      });
    });
  },
);
