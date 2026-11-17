/*
 * A PROJECT'S RULES, KEPT BETWEEN CREATES, ON A REAL POSTGRES.
 *
 * Every incident and alert created runs its project's rules, and each rule
 * engine used to read its rules from Postgres for every record: a read of 9
 * to 19 tables a kind, fifteen kinds. RuleSetCache keeps each read until
 * anything it could return changes. This suite holds it to the database:
 *
 *   - every engine a create runs reads its rules through RuleSetCache - the
 *     reads are taken off the engines themselves, so their own selects,
 *     conditions and orders are what is checked;
 *   - after every kind of write that can change what a read returns, made
 *     through the real services and with the database's own ON DELETE rules,
 *     each read hands out exactly what a read of the database returns then:
 *     the same rules, in the same order, with the same lists - a rule
 *     created, renamed, turned off, its lists changed, deleted, written
 *     without hooks; a label, a monitor, a team, a person, a severity, a
 *     runbook deleted (the database takes them out of every rule, of every
 *     project, and a rule a delete leaves limited to nothing is switched
 *     off, #9066); a runbook renamed;
 *   - and while nothing changes, a create reads no rule at all: the
 *     statements the reads cost a create, cold and warm, are counted.
 *
 * Opt in with RUN_POSTGRES_RULE_SET_CACHE_TESTS=true against a Postgres
 * migrated to head, e.g. the Postgres Schema Drift workflow's database
 * (.github/workflows/postgres-schema-drift.yaml runs it):
 *
 *   RUN_POSTGRES_RULE_SET_CACHE_TESTS=true \
 *   RULE_SET_CACHE_TEST_DATABASE_HOST=127.0.0.1 \
 *   RULE_SET_CACHE_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/RuleSetCachePostgres.test.ts
 *
 * RULE_SET_CACHE_PRINT=true prints the statements and time the reads cost.
 * The tables' STRUCTURE (and the foreign keys between them) is cloned into a
 * unique schema (search_path holds only that schema), dropped afterwards;
 * every row is synthetic. Redis is a map in memory.
 */

jest.mock("isolated-vm", () => {
  return {};
});

import Entities from "../../../Models/DatabaseModels/Index";
import Alert from "../../../Models/DatabaseModels/Alert";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import Redis from "../../../Server/Infrastructure/Redis";
import AlertGroupingEngineService from "../../../Server/Services/AlertGroupingEngineService";
import AlertIncidentRuleEngineService from "../../../Server/Services/AlertIncidentRuleEngineService";
import AlertLabelRuleEngineService from "../../../Server/Services/AlertLabelRuleEngineService";
import AlertOnCallRuleEngineService from "../../../Server/Services/AlertOnCallRuleEngineService";
import AlertOwnerRuleEngineService from "../../../Server/Services/AlertOwnerRuleEngineService";
import AlertPrivacyRuleEngineService from "../../../Server/Services/AlertPrivacyRuleEngineService";
import AutoRemediationRuleEngineService from "../../../Server/Services/AutoRemediationRuleEngineService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentGroupingEngineService from "../../../Server/Services/IncidentGroupingEngineService";
import IncidentLabelRuleEngineService from "../../../Server/Services/IncidentLabelRuleEngineService";
import IncidentOnCallRuleEngineService from "../../../Server/Services/IncidentOnCallRuleEngineService";
import IncidentOwnerRuleEngineService from "../../../Server/Services/IncidentOwnerRuleEngineService";
import IncidentPrivacyRuleEngineService from "../../../Server/Services/IncidentPrivacyRuleEngineService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import LabelService from "../../../Server/Services/LabelService";
import MonitorService from "../../../Server/Services/MonitorService";
import ProjectService from "../../../Server/Services/ProjectService";
import RunbookRuleEngineService from "../../../Server/Services/RunbookRuleEngineService";
import RunbookService from "../../../Server/Services/RunbookService";
import TeamService from "../../../Server/Services/TeamService";
import UserService from "../../../Server/Services/UserService";
import Select from "../../../Server/Types/Database/Select";
import logger from "../../../Server/Utils/Logger";
import { getRuleLimitListsHolding } from "../../../Server/Utils/Rules/RuleLimitLists";
import RuleSetCache, {
  EnabledRulesRead,
  RULE_SET_MODELS,
} from "../../../Server/Utils/Rules/RuleSetCache";
import ObjectID from "../../../Types/ObjectID";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../../Utils/Rules/RuleEngineLimits";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import { DataSource, Logger, QueryRunner } from "typeorm";
import { RelationMetadata } from "typeorm/metadata/RelationMetadata";

const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_RULE_SET_CACHE_TESTS"] === "true"
    ? describe
    : describe.skip;

const PRINT: boolean = process.env["RULE_SET_CACHE_PRINT"] === "true";

// A statement that waits on a lock fails instead of hanging the suite.
const LOCK_TIMEOUT_MS: number = 5000;

// Cloning the tables and loading every entity takes a while on a busy runner.
const SETUP_TIMEOUT_MS: number = 5 * 60 * 1000;
const TEST_TIMEOUT_MS: number = 2 * 60 * 1000;

const DASHES: RegExp = /-/g;

// Transaction control is not a statement of its own for this count.
const TRANSACTION_CONTROL: RegExp =
  /^\s*(START TRANSACTION|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE SAVEPOINT)/i;

/*
 * Read by the engines' create paths before or after their rules, so their
 * rows can be looked for (and found missing) without failing the read.
 */
const OTHER_TABLES_READ: Array<string> = [
  "Incident",
  "Alert",
  "AutoRemediationSuggestion",
];

// Every statement the DataSource runs while counting is on.
class StatementLog implements Logger {
  public statements: Array<string> = [];
  public isCounting: boolean = false;

  public logQuery(
    query: string,
    _parameters?: Array<unknown>,
    _queryRunner?: QueryRunner,
  ): void {
    if (this.isCounting && !TRANSACTION_CONTROL.test(query)) {
      this.statements.push(query);
    }
  }

  public logQueryError(): void {}
  public logQuerySlow(): void {}
  public logSchemaBuild(): void {}
  public logMigration(): void {}
  public log(): void {}
}

type AnyRead = EnabledRulesRead<BaseModel>;

describePostgres("rules kept between creates (Postgres)", () => {
  const schema: string = `rule_set_cache_${ObjectID.generate()
    .toString()
    .replace(DASHES, "")}`;

  const statementLog: StatementLog = new StatementLog();
  let database: DataSource;

  const projectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();

  // The records the rules name, by table: two of each in the project.
  const named: Map<string, Array<string>> = new Map<string, Array<string>>();

  /*
   * Two records of the project that only the other project's rule names, in
   * one list: the first deleted leaves the rule limited to the second, the
   * second leaves it limited to nothing.
   */
  const crossProjectLabelIds: Array<string> = [
    ObjectID.generate().toString(),
    ObjectID.generate().toString(),
  ];

  // The reads the engines make, taken off them (see the first test).
  let reads: Array<AnyRead> = [];

  // The in-memory stand-in for Redis.
  const cache: Map<string, string> = new Map<string, string>();

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["RULE_SET_CACHE_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["RULE_SET_CACHE_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["RULE_SET_CACHE_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      logging: ["query"],
      logger: statementLog,
      extra: {
        options: `-c search_path=${schema} -c lock_timeout=${LOCK_TIMEOUT_MS} -c jit=off`,
      },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    const tables: ReturnType<typeof RuleSetCache.getTables> =
      RuleSetCache.getTables();

    expect(tables).not.toBeNull();

    const cloned: Set<string> = new Set<string>([
      ...tables!.ruleTables,
      ...tables!.namedTables,
      ...tables!.deleteTables,
      ...OTHER_TABLES_READ,
    ]);

    /*
     * What the named records' own relations reach (a monitor's labels, its
     * template), which their deletes read.
     */
    for (const table of tables!.namedTables) {
      for (const relation of database.getMetadata(table).relations) {
        if (relation.junctionEntityMetadata) {
          cloned.add(relation.junctionEntityMetadata.tableName);
        }

        cloned.add(relation.inverseEntityMetadata.tableName);
      }

      /*
       * Every rule list that can hold a named record, of every rule kind -
       * not only the kinds kept here - with its rule's table: a delete reads
       * them all first, to switch off a rule it would leave with none
       * (RuleEmptiedLimits, #9066).
       */
      for (const list of getRuleLimitListsHolding(table)) {
        cloned.add(list.ruleTable);
        cloned.add(list.joinTable);
      }
    }

    for (const table of cloned) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    /*
     * The foreign keys between the cloned tables, as the migrations made
     * them: what the database deletes or empties along with a row is the
     * point of half of this suite.
     */
    const foreignKeys: Array<{
      child: string;
      parent: string;
      name: string;
      definition: string;
    }> = await database.query(
      `SELECT child.relname AS child, parent.relname AS parent, c.conname AS name,
              pg_get_constraintdef(c.oid) AS definition
         FROM pg_constraint c
         JOIN pg_class child ON child.oid = c.conrelid
         JOIN pg_class parent ON parent.oid = c.confrelid
         JOIN pg_namespace n ON n.oid = child.relnamespace
        WHERE c.contype = 'f' AND n.nspname = 'public'`,
    );

    for (const foreignKey of foreignKeys) {
      if (!cloned.has(foreignKey.child) || !cloned.has(foreignKey.parent)) {
        continue;
      }

      await database.query(
        `ALTER TABLE "${schema}"."${foreignKey.child}" ADD CONSTRAINT "${foreignKey.name}" ${foreignKey.definition.replace(
          /REFERENCES public\./,
          "REFERENCES ",
        )}`,
      );
    }

    // A fixture names only what the path reads; keys stay NOT NULL.
    const columns: Array<{ table_name: string; column_name: string }> =
      await database.query(
        `SELECT c.table_name, c.column_name FROM information_schema.columns c
         WHERE c.table_schema = $1 AND c.is_nullable = 'NO'
           AND NOT EXISTS (
             SELECT 1 FROM information_schema.table_constraints t
             JOIN information_schema.key_column_usage k
               ON k.constraint_name = t.constraint_name
              AND k.table_schema = t.table_schema
             WHERE t.constraint_type = 'PRIMARY KEY'
               AND t.table_schema = c.table_schema
               AND k.table_name = c.table_name
               AND k.column_name = c.column_name
           )`,
        [schema],
      );

    for (const column of columns) {
      await database.query(
        `ALTER TABLE "${schema}"."${column.table_name}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
      );
    }

    expect(
      (await database.query("SELECT current_schema()"))[0].current_schema,
    ).toBe(schema);

    await seedProjects(tables!.namedTables);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    if (database?.isInitialized) {
      // Table by table: one DROP SCHEMA CASCADE takes more locks than a server allows.
      const tables: Array<{ tablename: string }> = await database.query(
        `SELECT tablename FROM pg_tables WHERE schemaname = $1`,
        [schema],
      );

      for (const table of tables) {
        await database.query(
          `DROP TABLE IF EXISTS "${schema}"."${table.tablename}" CASCADE`,
        );
      }

      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(() => {
    for (const level of ["debug", "info", "warn", "error"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);

    // A write's workflow and realtime events go to other servers.
    jest
      .spyOn(DatabaseService.prototype, "onTriggerWorkflow")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(DatabaseService.prototype, "onTriggerRealtime")
      .mockResolvedValue(undefined as never);

    jest.spyOn(Redis, "isConnected").mockReturnValue(true);

    jest
      .spyOn(GlobalCache, "getString")
      .mockImplementation(async (namespace: string, key: string) => {
        return cache.get(`${namespace}-${key}`) ?? null;
      });

    jest
      .spyOn(GlobalCache, "setString")
      .mockImplementation(
        async (namespace: string, key: string, value: string) => {
          cache.set(`${namespace}-${key}`, value);
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    statementLog.isCounting = false;
  });

  async function seedProjects(namedTables: Set<string>): Promise<void> {
    for (const [id, name] of [
      [projectId, "Rules"],
      [otherProjectId, "Other rules"],
    ] as Array<[ObjectID, string]>) {
      await database.query(
        `INSERT INTO "Project" ("_id", "name", "slug", "isBlocked", "enableAi", "enableAutomaticIncidentRemediation", "enableAutomaticAlertRemediation")
         VALUES ($1::uuid, $2, $1::text, false, true, true, true)`,
        [id.toString(), name],
      );
    }

    for (const table of namedTables) {
      if (table === "Project") {
        continue;
      }

      const ids: Array<string> = [];
      const hasProject: boolean = Boolean(
        database.getMetadata(table).findColumnWithPropertyName("projectId"),
      );
      const hasName: boolean = Boolean(
        database.getMetadata(table).findColumnWithPropertyName("name"),
      );

      for (let i: number = 1; i <= 2; i++) {
        const id: string = ObjectID.generate().toString();
        ids.push(id);

        const columns: Array<string> = ["_id"];
        const values: Array<unknown> = [id];

        if (hasProject) {
          columns.push("projectId");
          values.push(projectId.toString());
        }

        if (hasName) {
          columns.push("name");
          values.push(`${table} ${i}`);
        }

        if (table === "User") {
          columns.push("email");
          values.push(`rules-${id}@example.com`);
        }

        await database.query(
          `INSERT INTO "${table}" (${columns
            .map((column: string) => {
              return `"${column}"`;
            })
            .join(", ")}) VALUES (${columns
            .map((_column: string, index: number) => {
              return `$${index + 1}`;
            })
            .join(", ")})`,
          values,
        );
      }

      named.set(table, ids);
    }

    // Labels of the project, named only by the other project's rule.
    for (const [index, labelId] of crossProjectLabelIds.entries()) {
      await database.query(
        `INSERT INTO "Label" ("_id", "projectId", "name") VALUES ($1, $2, $3)`,
        [labelId, projectId.toString(), `Shared ${index + 1}`],
      );
    }
  }

  // A row of `table` with this id, as a relation names it.
  function ref(table: string, id: string): BaseModel {
    const metadata: ReturnType<DataSource["getMetadata"]> =
      database.getMetadata(table);
    const row: BaseModel = metadata.create() as BaseModel;
    row._id = id;
    return row;
  }

  // A rule of `modelType` naming two records in each of its lists.
  function newRule(
    modelType: { new (): BaseModel },
    data: { projectId: ObjectID; name: string; trigger?: string },
  ): BaseModel {
    const rule: BaseModel = new modelType();
    const metadata: ReturnType<DataSource["getMetadata"]> =
      database.getMetadata(modelType);
    const record: Record<string, unknown> = rule as unknown as Record<
      string,
      unknown
    >;

    record["projectId"] = data.projectId;
    record["name"] = data.name;
    record["isEnabled"] = true;

    if (metadata.findColumnWithPropertyName("triggerEntityType")) {
      record["triggerEntityType"] = data.trigger || "Incident";
    }

    if (metadata.findColumnWithPropertyName("priority")) {
      record["priority"] = 1;
    }

    for (const relation of metadata.relations as Array<RelationMetadata>) {
      const table: string = relation.inverseEntityMetadata.tableName;
      const ids: Array<string> | undefined = named.get(table);

      if (
        !ids ||
        table === "Project" ||
        relation.propertyName.endsWith("ByUser")
      ) {
        continue;
      }

      if (relation.isManyToMany) {
        record[relation.propertyName] = ids.map((id: string) => {
          return ref(table, id);
        });
      } else if (
        relation.isManyToOne &&
        metadata.findColumnWithPropertyName(`${relation.propertyName}Id`)
      ) {
        // A record named by its id column: incidentSeverity, incidentSeverityId.
        record[`${relation.propertyName}Id`] = new ObjectID(ids[0]!);
      }
    }

    return rule;
  }

  function serviceOf(read: AnyRead): DatabaseService<BaseModel> {
    return read.service;
  }

  // What a read of the database returns, as the engines read it before.
  async function readDatabase(read: AnyRead): Promise<Array<BaseModel>> {
    return await serviceOf(read).findBy({
      query: {
        projectId: read.projectId,
        isEnabled: true,
        ...(read.query || {}),
      } as never,
      select: read.select,
      ...(read.sort ? { sort: read.sort } : {}),
      limit: MAX_RULES_EVALUATED_PER_PROJECT,
      skip: 0,
      props: { isRoot: true },
    });
  }

  /*
   * A rule as a read hands it out, to compare: its selected columns, and its
   * lists as sorted ids (and names where read) - a join gives a list's
   * entries in no set order, to the engines as to this suite.
   */
  function normalize(
    rules: Array<BaseModel>,
    select: Select<BaseModel>,
  ): Array<Record<string, unknown>> {
    return rules.map((rule: BaseModel) => {
      const out: Record<string, unknown> = {};

      for (const [column, value] of Object.entries(
        select as Record<string, unknown>,
      )) {
        const held: unknown = (rule as unknown as Record<string, unknown>)[
          column
        ];

        if (value && typeof value === "object") {
          out[column] = (Array.isArray(held) ? held : held ? [held] : [])
            .map((related: unknown) => {
              return JSON.stringify(
                Object.keys(value as Record<string, unknown>)
                  .sort()
                  .map((key: string) => {
                    return [
                      key,
                      String(
                        (related as Record<string, unknown>)[key] ?? "",
                      ).toLowerCase(),
                    ];
                  }),
              );
            })
            .sort();
          continue;
        }

        out[column] = JSON.parse(JSON.stringify(held ?? null));
      }

      return out;
    });
  }

  // Every read the engines make: what RuleSetCache hands out is what Postgres does.
  async function expectEveryReadAsTheDatabase(
    forProject: ObjectID = projectId,
  ): Promise<void> {
    expect(reads.length).toBeGreaterThan(0);

    for (const engineRead of reads) {
      const read: AnyRead = { ...engineRead, projectId: forProject };

      const kept: Array<BaseModel> = await RuleSetCache.findEnabledRules(read);
      const fromDatabase: Array<BaseModel> = await readDatabase(read);

      expect({
        table: read.service.getModel().tableName,
        rules: normalize(kept, read.select),
      }).toEqual({
        table: read.service.getModel().tableName,
        rules: normalize(fromDatabase, read.select),
      });
    }
  }

  // What the reads cost now, in statements and milliseconds.
  async function countReads(
    forProject: ObjectID = projectId,
  ): Promise<{ statements: number; ms: number }> {
    statementLog.statements = [];
    statementLog.isCounting = true;
    const startedAt: number = performance.now();

    for (const engineRead of reads) {
      await RuleSetCache.findEnabledRules({
        ...engineRead,
        projectId: forProject,
      });
    }

    const ms: number = performance.now() - startedAt;
    statementLog.isCounting = false;

    return { statements: statementLog.statements.length, ms };
  }

  // The rules of a kind as Postgres has them, in the project.
  async function rulesOf(
    tableName: string,
    forProject: ObjectID = projectId,
  ): Promise<Array<BaseModel>> {
    const read: AnyRead | undefined = reads.find((engineRead: AnyRead) => {
      return engineRead.service.getModel().tableName === tableName;
    });

    expect(read).toBeTruthy();

    return await RuleSetCache.findEnabledRules({
      ...read!,
      projectId: forProject,
    });
  }

  function probeIncident(): Incident {
    const incident: Incident = new Incident();
    incident.id = ObjectID.generate();
    incident.projectId = projectId;
    incident.title = "Probe";
    incident.description = "Probe";
    incident.isPrivate = false;
    incident.monitors = [];
    incident.labels = [];
    return incident;
  }

  function probeAlert(): Alert {
    const alert: Alert = new Alert();
    alert.id = ObjectID.generate();
    alert.projectId = projectId;
    alert.title = "Probe";
    alert.description = "Probe";
    alert.isPrivate = false;
    alert.labels = [];
    return alert;
  }

  test(
    "every engine an incident or alert create runs reads its rules through RuleSetCache",
    async () => {
      const taken: Array<AnyRead> = [];
      const findEnabledRules: typeof RuleSetCache.findEnabledRules =
        RuleSetCache.findEnabledRules.bind(RuleSetCache);

      jest.spyOn(RuleSetCache, "findEnabledRules").mockImplementation((async (
        read: AnyRead,
      ) => {
        taken.push(read);
        return await findEnabledRules(read);
      }) as never);

      const engines: Array<() => Promise<unknown>> = [
        () => {
          return IncidentPrivacyRuleEngineService.applyRulesToIncident(
            probeIncident(),
          );
        },
        () => {
          return IncidentOwnerRuleEngineService.applyRulesToIncident(
            probeIncident(),
          );
        },
        () => {
          return IncidentLabelRuleEngineService.applyRulesToIncident(
            probeIncident(),
          );
        },
        () => {
          return IncidentOnCallRuleEngineService.applyRulesToIncident(
            probeIncident(),
          );
        },
        () => {
          return RunbookRuleEngineService.applyRulesToIncident(probeIncident());
        },
        () => {
          return IncidentGroupingEngineService.processIncident(probeIncident());
        },
        () => {
          return AutoRemediationRuleEngineService.applyRulesToIncident(
            probeIncident(),
          );
        },
        () => {
          return AlertPrivacyRuleEngineService.applyRulesToAlert(probeAlert());
        },
        () => {
          return AlertOwnerRuleEngineService.applyRulesToAlert(probeAlert());
        },
        () => {
          return AlertLabelRuleEngineService.applyRulesToAlert(probeAlert());
        },
        () => {
          return AlertOnCallRuleEngineService.applyRulesToAlert(probeAlert());
        },
        () => {
          return RunbookRuleEngineService.applyRulesToAlert(probeAlert());
        },
        () => {
          return AlertIncidentRuleEngineService.applyRulesToAlert(probeAlert());
        },
        () => {
          return AlertGroupingEngineService.processAlert(probeAlert());
        },
        () => {
          return AutoRemediationRuleEngineService.applyRulesToAlert(
            probeAlert(),
          );
        },
      ];

      for (const engine of engines) {
        try {
          await engine();
        } catch {
          // What an engine does after its read is not this suite's.
        }
      }

      const readTables: Array<string> = taken.map((read: AnyRead) => {
        return read.service.getModel().tableName!;
      });

      // Every kind kept, each read through the cache.
      expect(Array.from(new Set(readTables)).sort()).toEqual(
        RULE_SET_MODELS.map((modelType: { new (): BaseModel }) => {
          return new modelType().tableName!;
        }).sort(),
      );

      // Runbook and remediation rules are read per trigger: one read each.
      expect(taken).toHaveLength(15);

      // Every read is one RuleSetCache keeps.
      for (const read of taken) {
        expect(RuleSetCache.getReadKey(read)).not.toBeNull();
      }

      reads = taken;
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a project without rules: kept, and as the database has it",
    async () => {
      RuleSetCache.clear();

      await expectEveryReadAsTheDatabase();

      const cold: { statements: number; ms: number } =
        await countReads(otherProjectId);
      const warm: { statements: number; ms: number } =
        await countReads(otherProjectId);

      // One single-table statement a kind with no rules, then none.
      expect(cold.statements).toBe(reads.length);
      expect(warm.statements).toBe(0);

      if (PRINT) {
        // eslint-disable-next-line no-console
        console.log(
          `No rules: ${cold.statements} statements (${cold.ms.toFixed(1)} ms) cold, ${warm.statements} (${warm.ms.toFixed(1)} ms) warm`,
        );
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "rules of every kind created: read again at once, as the database has them, and then kept",
    async () => {
      await expectEveryReadAsTheDatabase();

      for (const modelType of RULE_SET_MODELS) {
        const triggers: Array<string> = database
          .getMetadata(modelType)
          .findColumnWithPropertyName("triggerEntityType")
          ? ["Incident", "Alert"]
          : [undefined as unknown as string];

        for (const trigger of triggers) {
          const service: DatabaseService<BaseModel> = reads.find(
            (read: AnyRead) => {
              return (
                read.service.getModel().tableName === new modelType().tableName
              );
            },
          )!.service;

          await service.create({
            data: newRule(modelType, {
              projectId,
              name: `${modelType.name} ${trigger || ""}`.trim(),
              trigger,
            }),
            props: { isRoot: true, ignoreHooks: true },
          });
        }
      }

      // The other project's rule names labels of this project.
      await reads
        .find((read: AnyRead) => {
          return read.service.getModel().tableName === "IncidentLabelRule";
        })!
        .service.create({
          data: (() => {
            const rule: BaseModel = newRule(
              RULE_SET_MODELS.find((modelType: { new (): BaseModel }) => {
                return modelType.name === "IncidentLabelRule";
              })!,
              { projectId: otherProjectId, name: "Across projects" },
            );
            (rule as unknown as Record<string, unknown>)["incidentLabels"] =
              crossProjectLabelIds.map((labelId: string) => {
                return ref("Label", labelId);
              });
            return rule;
          })(),
          props: { isRoot: true, ignoreHooks: true },
        });

      await expectEveryReadAsTheDatabase();
      await expectEveryReadAsTheDatabase(otherProjectId);

      for (const read of reads) {
        expect(
          (await rulesOf(read.service.getModel().tableName!)).length,
        ).toBeGreaterThan(0);
      }

      const warm: { statements: number; ms: number } = await countReads();

      expect(warm.statements).toBe(0);

      // Cold: the reads a create cost before, with a rule of every kind.
      RuleSetCache.clear();
      const cold: { statements: number; ms: number } = await countReads();
      const coldStatements: Array<string> = [...statementLog.statements];
      const warmAgain: { statements: number; ms: number } = await countReads();

      // A page of ids, then the rules with their lists: two a kind.
      expect(cold.statements).toBe(reads.length * 2);
      expect(warmAgain.statements).toBe(0);

      if (PRINT) {
        /*
         * What the fifteen reads cost this process, cold and warm - and
         * Postgres, when RULE_SET_CACHE_PG_CPU_STAT names its cgroup's
         * cpu.stat (a container's, e.g.
         * /sys/fs/cgroup/system.slice/docker-<id>.scope/cpu.stat).
         */
        const rounds: number = 30;
        const cpuStat: string | undefined =
          process.env["RULE_SET_CACHE_PG_CPU_STAT"];
        const postgresCpuMs: () => number = (): number => {
          if (!cpuStat) {
            return 0;
          }

          const usage: RegExpMatchArray | null = fs
            .readFileSync(cpuStat, "utf8")
            .match(/usage_usec (\d+)/);

          return usage ? Number(usage[1]) / 1000 : 0;
        };
        const cost: (isCold: boolean) => Promise<string> = async (
          isCold: boolean,
        ): Promise<string> => {
          const cpuBefore: NodeJS.CpuUsage = process.cpuUsage();
          const postgresBefore: number = postgresCpuMs();
          let ms: number = 0;

          for (let round: number = 0; round < rounds; round++) {
            if (isCold) {
              RuleSetCache.clear();
            }

            ms += (await countReads()).ms;
          }

          const cpu: NodeJS.CpuUsage = process.cpuUsage(cpuBefore);
          const postgres: number = postgresCpuMs() - postgresBefore;

          return `${((cpu.user + cpu.system) / 1000 / rounds).toFixed(2)} ms of this process's CPU${cpuStat ? `, ${(postgres / rounds).toFixed(2)} ms of Postgres's` : ""}, ${(ms / rounds).toFixed(2)} ms wall`;
        };

        const coldCost: string = await cost(true);
        await countReads();
        const warmCost: string = await cost(false);

        // eslint-disable-next-line no-console
        console.log(
          `A rule of every kind: ${cold.statements} statements cold, ${warmAgain.statements} warm. The 15 reads, mean of ${rounds}: cold ${coldCost}; warm ${warmCost}.\n${coldStatements.join("\n")}`,
        );
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a rule renamed, turned off, given other lists or written without hooks: read again, as the database has it",
    async () => {
      for (const read of reads) {
        const tableName: string = read.service.getModel().tableName!;
        const rule: BaseModel = (await rulesOf(tableName))[0]!;

        await read.service.updateOneById({
          id: rule.id!,
          data: { name: `${tableName} renamed` } as never,
          props: { isRoot: true, ignoreHooks: true },
        });
      }

      await expectEveryReadAsTheDatabase();

      // A list changed: the label rules' labels to add, one taken off.
      const labelRules: AnyRead = reads.find((read: AnyRead) => {
        return read.service.getModel().tableName === "IncidentLabelRule";
      })!;
      const labelRule: BaseModel = (await rulesOf("IncidentLabelRule"))[0]!;

      await labelRules.service.updateOneById({
        id: labelRule.id!,
        data: {
          labelsToAdd: [ref("Label", named.get("Label")![1]!)],
        } as never,
        props: { isRoot: true, ignoreHooks: true },
      });

      expect(
        (
          (await rulesOf("IncidentLabelRule"))[0] as unknown as {
            labelsToAdd: Array<BaseModel>;
          }
        ).labelsToAdd.map((label: BaseModel) => {
          return label.id!.toString();
        }),
      ).toEqual([named.get("Label")![1]]);
      await expectEveryReadAsTheDatabase();

      // Turned off.
      const ownerRules: AnyRead = reads.find((read: AnyRead) => {
        return read.service.getModel().tableName === "IncidentOwnerRule";
      })!;
      const ownerRule: BaseModel = (await rulesOf("IncidentOwnerRule"))[0]!;

      await ownerRules.service.updateOneById({
        id: ownerRule.id!,
        data: { isEnabled: false } as never,
        props: { isRoot: true, ignoreHooks: true },
      });

      expect(await rulesOf("IncidentOwnerRule")).toHaveLength(0);
      await expectEveryReadAsTheDatabase();

      // Written without hooks: the privacy rule turned off by id.
      const privacyRules: AnyRead = reads.find((read: AnyRead) => {
        return read.service.getModel().tableName === "IncidentPrivacyRule";
      })!;
      const privacyRule: BaseModel = (await rulesOf("IncidentPrivacyRule"))[0]!;

      await privacyRules.service.updateColumnsByIdWithoutHooks({
        id: privacyRule.id!,
        data: { isEnabled: false } as never,
      });

      expect(await rulesOf("IncidentPrivacyRule")).toHaveLength(0);
      await expectEveryReadAsTheDatabase();
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a record the rules name deleted: the database takes it out of every rule, of every project, and the reads say so",
    async () => {
      const deletes: Array<{
        table: string;
        service: DatabaseService<BaseModel>;
        id: string;
      }> = [
        {
          table: "Label",
          service: LabelService as unknown as DatabaseService<BaseModel>,
          id: named.get("Label")![0]!,
        },
        {
          table: "Monitor",
          service: MonitorService as unknown as DatabaseService<BaseModel>,
          id: named.get("Monitor")![0]!,
        },
        {
          table: "Team",
          service: TeamService as unknown as DatabaseService<BaseModel>,
          id: named.get("Team")![0]!,
        },
        {
          table: "User",
          service: UserService as unknown as DatabaseService<BaseModel>,
          id: named.get("User")![0]!,
        },
        {
          // The alert incident rules' severity is emptied (SET NULL).
          table: "IncidentSeverity",
          service:
            IncidentSeverityService as unknown as DatabaseService<BaseModel>,
          id: named.get("IncidentSeverity")![0]!,
        },
        {
          table: "Runbook",
          service: RunbookService as unknown as DatabaseService<BaseModel>,
          id: named.get("Runbook")![0]!,
        },
      ];

      for (const deleted of deletes) {
        // Every read kept before the delete.
        await countReads();
        await countReads(otherProjectId);

        const before: string = JSON.stringify(
          await Promise.all(
            reads.map(async (read: AnyRead) => {
              return normalize(
                await RuleSetCache.findEnabledRules(read),
                read.select,
              );
            }),
          ),
        );

        expect(before).toContain(deleted.id);

        await deleted.service.deleteBy({
          query: { _id: deleted.id } as never,
          limit: 1,
          skip: 0,
          props: { isRoot: true, ignoreHooks: true },
        });

        const after: string = JSON.stringify(
          await Promise.all(
            reads.map(async (read: AnyRead) => {
              return normalize(
                await RuleSetCache.findEnabledRules(read),
                read.select,
              );
            }),
          ),
        );

        // Gone from the rules kept, as from the database's.
        expect(after).not.toContain(deleted.id);
        await expectEveryReadAsTheDatabase();
      }

      // The other project's rule, as its project's reads hand it out.
      const otherProjectLabelRules: () => Promise<string> =
        async (): Promise<string> => {
          return JSON.stringify(
            normalize(
              await rulesOf("IncidentLabelRule", otherProjectId),
              reads.find((read: AnyRead) => {
                return (
                  read.service.getModel().tableName === "IncidentLabelRule"
                );
              })!.select,
            ),
          );
        };

      const deleteLabel: (labelId: string) => Promise<void> = async (
        labelId: string,
      ): Promise<void> => {
        await LabelService.deleteBy({
          query: { _id: labelId } as never,
          limit: 1,
          skip: 0,
          props: { isRoot: true, ignoreHooks: true },
        });
      };

      /*
       * The other project's rule named two labels of this one. The first
       * deleted leaves it limited to the second, and on: nothing writes the
       * rule, so only the delete's new generation of every project shows
       * the other project's reads the label gone.
       */
      expect(await otherProjectLabelRules()).toContain(crossProjectLabelIds[0]);

      await deleteLabel(crossProjectLabelIds[0]!);

      expect(await rulesOf("IncidentLabelRule", otherProjectId)).toHaveLength(
        1,
      );
      expect(await otherProjectLabelRules()).not.toContain(
        crossProjectLabelIds[0],
      );
      expect(await otherProjectLabelRules()).toContain(crossProjectLabelIds[1]);
      await expectEveryReadAsTheDatabase(otherProjectId);

      /*
       * The second deleted leaves it limited to nothing: it is switched off
       * rather than widened to every incident (RuleEmptiedLimits, #9066),
       * and the other project's reads say so.
       */
      await deleteLabel(crossProjectLabelIds[1]!);

      expect(await rulesOf("IncidentLabelRule", otherProjectId)).toHaveLength(
        0,
      );
      await expectEveryReadAsTheDatabase(otherProjectId);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a runbook renamed: the remediation rules hand out its new name",
    async () => {
      const runbookId: string = named.get("Runbook")![1]!;

      await countReads();

      await RunbookService.updateOneById({
        id: new ObjectID(runbookId),
        data: { name: "Restart the payments pods" } as never,
        props: { isRoot: true, ignoreHooks: true },
      });

      const remediationRules: Array<BaseModel> = await rulesOf(
        "AutoRemediationRule",
      );

      expect(
        remediationRules.flatMap((rule: BaseModel) => {
          return (
            (rule as unknown as { runbooks: Array<{ name: string }> })
              .runbooks || []
          ).map((runbook: { name: string }) => {
            return runbook.name;
          });
        }),
      ).toContain("Restart the payments pods");

      await expectEveryReadAsTheDatabase();
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a rule deleted: read again, as the database has it, and the other project's kept",
    async () => {
      await countReads(otherProjectId);

      for (const read of reads) {
        for (const rule of await rulesOf(read.service.getModel().tableName!)) {
          await read.service.deleteBy({
            query: { _id: rule.id!.toString() } as never,
            limit: 1,
            skip: 0,
            props: { isRoot: true, ignoreHooks: true },
          });
        }
      }

      for (const read of reads) {
        expect(await rulesOf(read.service.getModel().tableName!)).toHaveLength(
          0,
        );
      }

      await expectEveryReadAsTheDatabase();

      // The other project's rules were not read again for this project's deletes.
      const otherProject: { statements: number; ms: number } =
        await countReads(otherProjectId);

      expect(otherProject.statements).toBe(0);
      await expectEveryReadAsTheDatabase(otherProjectId);
    },
    TEST_TIMEOUT_MS,
  );
});
