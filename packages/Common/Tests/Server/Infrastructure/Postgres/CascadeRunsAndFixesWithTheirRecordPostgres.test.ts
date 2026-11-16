import {
  CascadeRunsAndFixesWithTheirRecord1809182600000,
  RECORD_LINKS,
  RecordLink,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809182600000-CascadeRunsAndFixesWithTheirRecord";
import { DeleteRunsAndFixesOfDeletedRecords1809182610000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809182610000-DeleteRunsAndFixesOfDeletedRecords";
import ObjectID from "../../../../Types/ObjectID";
import RunbookTriggerType from "../../../../Types/Runbook/RunbookTriggerType";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource, QueryRunner } from "typeorm";

/*
 * A RUNBOOK RUN AND A FIX GO WITH THEIR INCIDENT OR ALERT, ON A REAL POSTGRES
 * (#9103): the migrations CascadeRunsAndFixesWithTheirRecord and
 * DeleteRunsAndFixesOfDeletedRecords, run on copies of the migrated tables
 * as they were before them - the run's and the fix's incident and alert keys
 * ON DELETE SET NULL - holding every kind of run and fix there is:
 *
 *   - the keys come out ON DELETE CASCADE, validated, under the generated
 *     names the schema drift check compares;
 *   - what already outlived its record is deleted: a fix naming neither an
 *     incident nor an alert, the run it started, a run a rule or
 *     auto-remediation started that names no record - with their Runner
 *     jobs; nothing else is: a run started by a person, OneUptime AI, a
 *     schedule, a webhook or a security playbook naming no record, a run
 *     from before triggers were recorded, a rule's run for a maintenance
 *     event, and every run and fix still naming its record, stay;
 *   - each key is swapped in one statement (OnlineDdl.replaceForeignKey):
 *     a run naming a record deleted while its key was lost is deleted
 *     before the key is validated, a key a stop part way left swapped but
 *     NOT VALID is validated, and the migration finishes;
 *   - from then on, deleting an incident or an alert deletes its runs, their
 *     Runner jobs and its fixes;
 *   - run again, the migration changes nothing; down() puts SET NULL back.
 *
 * Opt in with RUN_POSTGRES_CASCADE_RUNS_AND_FIXES_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_CASCADE_RUNS_AND_FIXES_TESTS=true \
 *   CASCADE_RUNS_AND_FIXES_TEST_DATABASE_HOST=127.0.0.1 \
 *   CASCADE_RUNS_AND_FIXES_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Infrastructure/Postgres/CascadeRunsAndFixesWithTheirRecordPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml. The tables are
 * cloned from public (LIKE ... INCLUDING ALL, which copies no foreign key)
 * into a uniquely named schema that is dropped afterwards; the keys are made
 * there as the migrations before these left them. The connection's search
 * path is that schema, then public, so the migrations' unqualified names
 * reach the copies.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_CASCADE_RUNS_AND_FIXES_TESTS"] === "true"
    ? describe
    : describe.skip;

jest.setTimeout(300_000);

const TABLES: Array<string> = [
  "Incident",
  "Alert",
  "RunbookExecution",
  "AutoRemediationSuggestion",
  "RunnerJob",
];

interface RequiredColumn {
  name: string;
  type: string;
  maxLength: number | null;
}

type SqlRow = Record<string, unknown>;

function newId(): string {
  return ObjectID.generate().toString();
}

describePostgres(
  "runbook runs and fixes go with their incident or alert, on Postgres",
  () => {
    const schema: string = `cascade_runs_fixes_${newId().replace(/-/g, "")}`;
    const projectId: string = newId();

    let database: DataSource;
    const required: Record<string, Array<RequiredColumn>> = {};

    async function withRunner<T>(
      step: (queryRunner: QueryRunner) => Promise<T>,
    ): Promise<T> {
      const queryRunner: QueryRunner = database.createQueryRunner();

      try {
        return await step(queryRunner);
      } finally {
        await queryRunner.release();
      }
    }

    // As TypeORM runs them: the first without a transaction, the second in one.
    async function runMigrations(): Promise<void> {
      await withRunner(async (queryRunner: QueryRunner) => {
        await new CascadeRunsAndFixesWithTheirRecord1809182600000().up(
          queryRunner,
        );
      });

      await withRunner(async (queryRunner: QueryRunner) => {
        await queryRunner.startTransaction();
        await new DeleteRunsAndFixesOfDeletedRecords1809182610000().up(
          queryRunner,
        );
        await queryRunner.commitTransaction();
      });
    }

    function filler(table: string, column: RequiredColumn): unknown {
      switch (column.type) {
        case "uuid":
          return newId();
        case "character varying":
        case "text": {
          const text: string = newId().replace(/-/g, "");
          return column.maxLength === null
            ? text
            : text.slice(0, column.maxLength);
        }
        case "integer":
        case "smallint":
        case "bigint":
        case "numeric":
        case "double precision":
        case "real":
          return 1;
        case "boolean":
          return false;
        case "timestamp with time zone":
        case "timestamp without time zone":
        case "date":
          return new Date();
        case "jsonb":
        case "json":
          return "{}";
        default:
          throw new Error(
            `${table}.${column.name} must be given a value: this suite has no filler for a ${column.type}.`,
          );
      }
    }

    async function insert(table: string, values: SqlRow): Promise<string> {
      const row: SqlRow = { _id: newId(), projectId: projectId };

      for (const column of required[table] || []) {
        if (!(column.name in values) && !(column.name in row)) {
          row[column.name] = filler(table, column);
        }
      }

      Object.assign(row, values);

      const columns: Array<string> = Object.keys(row);

      await database.query(
        `INSERT INTO "${table}" (${columns
          .map((column: string): string => {
            return `"${column}"`;
          })
          .join(", ")}) VALUES (${columns
          .map((_column: string, index: number): string => {
            return `$${index + 1}`;
          })
          .join(", ")})`,
        columns.map((column: string): unknown => {
          return row[column];
        }),
      );

      return row["_id"] as string;
    }

    async function idsIn(table: string): Promise<Array<string>> {
      const rows: Array<{ _id: string }> = await database.query(
        `SELECT "_id" FROM "${table}" ORDER BY "_id"`,
      );

      return rows.map((row: { _id: string }): string => {
        return row._id;
      });
    }

    // What each key does on delete now, and whether it is validated.
    async function keys(): Promise<Record<string, string>> {
      const states: Record<string, string> = {};

      for (const link of RECORD_LINKS) {
        const rows: Array<{ onDelete: string; validated: boolean }> =
          await database.query(
            `SELECT confdeltype AS "onDelete", convalidated AS "validated"
               FROM pg_constraint
              WHERE conname = $1 AND conrelid = to_regclass($2)`,
            [link.constraintName, `"${schema}"."${link.table}"`],
          );

        states[`${link.table}.${link.column}`] = rows[0]
          ? `${rows[0].onDelete}${rows[0].validated ? "" : " (not valid)"}`
          : "absent";
      }

      return states;
    }

    function setNull(link: RecordLink): string {
      return `ALTER TABLE "${link.table}" ADD CONSTRAINT "${link.constraintName}" FOREIGN KEY ("${link.column}") REFERENCES "${link.recordTable}"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`;
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["CASCADE_RUNS_AND_FIXES_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["CASCADE_RUNS_AND_FIXES_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["CASCADE_RUNS_AND_FIXES_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();

      const notNull: Array<{
        table: string;
        name: string;
        type: string;
        maxLength: number | null;
      }> = await database.query(
        `SELECT table_name AS "table", column_name AS "name", data_type AS "type",
                character_maximum_length AS "maxLength"
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = ANY($1)
            AND is_nullable = 'NO'
            AND column_default IS NULL`,
        [TABLES],
      );

      for (const column of notNull) {
        (required[column.table] = required[column.table] || []).push({
          name: column.name,
          type: column.type,
          maxLength:
            column.maxLength === null ? null : Number(column.maxLength),
        });
      }

      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      const current: Array<{ current_schema: string }> = await database.query(
        "SELECT current_schema()",
      );
      expect(current[0]?.current_schema).toBe(schema);

      // The keys as the migrations before these left them.
      for (const link of RECORD_LINKS) {
        await database.query(setNull(link));
      }

      // A run's Runner jobs went with it already, and still do.
      const runnerJobKey: Array<{ name: string; definition: string }> =
        await database.query(
          `SELECT conname AS "name", pg_get_constraintdef(oid) AS "definition"
             FROM pg_constraint
            WHERE conrelid = 'public."RunnerJob"'::regclass
              AND confrelid = 'public."RunbookExecution"'::regclass`,
        );
      expect(runnerJobKey).toHaveLength(1);
      expect(runnerJobKey[0]!.definition).toContain("ON DELETE CASCADE");

      await database.query(
        `ALTER TABLE "RunnerJob" ADD CONSTRAINT "${runnerJobKey[0]!.name}" ${runnerJobKey[0]!.definition.replace(
          /REFERENCES (public\.)?"?RunbookExecution"?/,
          'REFERENCES "RunbookExecution"',
        )}`,
      );
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    test("the keys cascade, what outlived its record goes, and everything else stays", async () => {
      expect(await keys()).toEqual({
        "RunbookExecution.incidentId": "n",
        "RunbookExecution.alertId": "n",
        "AutoRemediationSuggestion.incidentId": "n",
        "AutoRemediationSuggestion.alertId": "n",
      });

      const incident: string = await insert("Incident", {});
      const alert: string = await insert("Alert", {});

      const run: (values: SqlRow) => Promise<string> = async (
        values: SqlRow,
      ): Promise<string> => {
        return await insert("RunbookExecution", values);
      };

      // Runs that name their record, and runs that never named one.
      const kept: Record<string, string> = {
        "a run of the incident": await run({
          incidentId: incident,
          triggerType: RunbookTriggerType.Manual,
        }),
        "a rule's run for the alert": await run({
          alertId: alert,
          triggerType: RunbookTriggerType.Rule,
        }),
        "a rule's run for a maintenance event": await run({
          scheduledMaintenanceId: newId(),
          triggerType: RunbookTriggerType.Rule,
        }),
        "a person's run from the runbook's page": await run({
          triggerType: RunbookTriggerType.Manual,
        }),
        "OneUptime AI's run from a chat": await run({
          triggerType: RunbookTriggerType.AI,
        }),
        "a scheduled run": await run({
          triggerType: RunbookTriggerType.Schedule,
        }),
        "a webhook's run": await run({
          triggerType: RunbookTriggerType.Webhook,
        }),
        "a security playbook's run": await run({
          triggerType: RunbookTriggerType.SecurityPlaybook,
        }),
        "a run from before triggers were recorded": await run({
          triggerType: null,
        }),
      };

      // Runs and fixes that outlived the incident or alert they were about.
      const runOfLostFix: string = await run({
        triggerType: RunbookTriggerType.AutoRemediation,
      });
      const gone: Record<string, string> = {
        "a rule's run that lost its record": await run({
          triggerType: RunbookTriggerType.Rule,
        }),
        "an auto-remediation run that lost its record": runOfLostFix,
        "an auto-remediation run that lost its record, its fix deleted since":
          await run({
            triggerType: RunbookTriggerType.AutoRemediation,
          }),
        "a run a lost fix started, whatever started it": await run({
          triggerType: RunbookTriggerType.Manual,
        }),
      };

      const keptFixes: Record<string, string> = {
        "a fix for the incident": await insert("AutoRemediationSuggestion", {
          incidentId: incident,
          runbookExecutionId: kept["a run of the incident"],
        }),
        "a fix for the alert": await insert("AutoRemediationSuggestion", {
          alertId: alert,
        }),
      };

      const goneFixes: Record<string, string> = {
        "a fix that lost its incident or alert": await insert(
          "AutoRemediationSuggestion",
          { runbookExecutionId: runOfLostFix },
        ),
        "another, which started a person's run": await insert(
          "AutoRemediationSuggestion",
          {
            runbookExecutionId:
              gone["a run a lost fix started, whatever started it"],
          },
        ),
      };

      // A Runner job of a run that goes, and of one that stays.
      const jobOfGoneRun: string = await insert("RunnerJob", {
        runbookExecutionId: gone["a rule's run that lost its record"],
      });
      const jobOfKeptRun: string = await insert("RunnerJob", {
        runbookExecutionId: kept["a run of the incident"],
      });

      /*
       * A database that lost the alert key of the runs, and an alert
       * deleted since, leaving a run naming it.
       */
      await database.query(
        `ALTER TABLE "RunbookExecution" DROP CONSTRAINT "${RECORD_LINKS[1]!.constraintName}"`,
      );
      const runOfVanishedAlert: string = await run({
        alertId: newId(),
        triggerType: RunbookTriggerType.Manual,
      });

      /*
       * A stop part way: the fix's alert key swapped already, CASCADE, but
       * not validated yet.
       */
      await database.query(
        `ALTER TABLE "AutoRemediationSuggestion" DROP CONSTRAINT "${RECORD_LINKS[3]!.constraintName}", ADD CONSTRAINT "${RECORD_LINKS[3]!.constraintName}" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE NO ACTION NOT VALID`,
      );
      expect((await keys())["AutoRemediationSuggestion.alertId"]).toBe(
        "c (not valid)",
      );

      await runMigrations();

      expect(await keys()).toEqual({
        "RunbookExecution.incidentId": "c",
        "RunbookExecution.alertId": "c",
        "AutoRemediationSuggestion.incidentId": "c",
        "AutoRemediationSuggestion.alertId": "c",
      });

      const runsLeft: Array<string> = await idsIn("RunbookExecution");
      const fixesLeft: Array<string> = await idsIn("AutoRemediationSuggestion");

      expect(runsLeft).toEqual(Object.values(kept).sort());
      expect(fixesLeft).toEqual(Object.values(keptFixes).sort());
      expect(await idsIn("RunnerJob")).toEqual([jobOfKeptRun]);

      // Each that goes, by name: none of them is left.
      for (const [what, id] of Object.entries({
        ...gone,
        "a run of an alert deleted part way": runOfVanishedAlert,
      })) {
        expect({ what, isLeft: runsLeft.includes(id) }).toEqual({
          what,
          isLeft: false,
        });
      }

      for (const [what, id] of Object.entries(goneFixes)) {
        expect({ what, isLeft: fixesLeft.includes(id) }).toEqual({
          what,
          isLeft: false,
        });
      }

      expect(await idsIn("RunnerJob")).not.toContain(jobOfGoneRun);
    });

    test("from then on, deleting an incident or an alert deletes its runs, their Runner jobs and its fixes; a run naming no record stays", async () => {
      const incident: string = await insert("Incident", {});
      const alert: string = await insert("Alert", {});

      const runOfIncident: string = await insert("RunbookExecution", {
        incidentId: incident,
        triggerType: RunbookTriggerType.Manual,
      });
      const runOfAlert: string = await insert("RunbookExecution", {
        alertId: alert,
        triggerType: RunbookTriggerType.Rule,
      });
      const unlinkedRun: string = await insert("RunbookExecution", {
        triggerType: RunbookTriggerType.Manual,
      });
      const jobOfIncidentRun: string = await insert("RunnerJob", {
        runbookExecutionId: runOfIncident,
      });
      const fixOfIncident: string = await insert("AutoRemediationSuggestion", {
        incidentId: incident,
      });
      const fixOfAlert: string = await insert("AutoRemediationSuggestion", {
        alertId: alert,
      });

      await database.query(`DELETE FROM "Incident" WHERE "_id" = $1`, [
        incident,
      ]);

      let runs: Array<string> = await idsIn("RunbookExecution");
      expect(runs).not.toContain(runOfIncident);
      expect(runs).toContain(runOfAlert);
      expect(runs).toContain(unlinkedRun);
      expect(await idsIn("RunnerJob")).not.toContain(jobOfIncidentRun);
      expect(await idsIn("AutoRemediationSuggestion")).not.toContain(
        fixOfIncident,
      );

      await database.query(`DELETE FROM "Alert" WHERE "_id" = $1`, [alert]);

      runs = await idsIn("RunbookExecution");
      expect(runs).not.toContain(runOfAlert);
      expect(runs).toContain(unlinkedRun);
      expect(await idsIn("AutoRemediationSuggestion")).not.toContain(
        fixOfAlert,
      );
    });

    test("run again, the migrations change nothing", async () => {
      const before: Array<string> = await idsIn("RunbookExecution");

      await runMigrations();

      expect(await keys()).toEqual({
        "RunbookExecution.incidentId": "c",
        "RunbookExecution.alertId": "c",
        "AutoRemediationSuggestion.incidentId": "c",
        "AutoRemediationSuggestion.alertId": "c",
      });
      expect(await idsIn("RunbookExecution")).toEqual(before);
    });

    test("down puts SET NULL back, and a deleted incident's run stays naming none", async () => {
      await withRunner(async (queryRunner: QueryRunner) => {
        await queryRunner.startTransaction();
        await new DeleteRunsAndFixesOfDeletedRecords1809182610000().down(
          queryRunner,
        );
        await new CascadeRunsAndFixesWithTheirRecord1809182600000().down(
          queryRunner,
        );
        await queryRunner.commitTransaction();
      });

      expect(await keys()).toEqual({
        "RunbookExecution.incidentId": "n",
        "RunbookExecution.alertId": "n",
        "AutoRemediationSuggestion.incidentId": "n",
        "AutoRemediationSuggestion.alertId": "n",
      });

      const incident: string = await insert("Incident", {});
      const runOfIncident: string = await insert("RunbookExecution", {
        incidentId: incident,
        triggerType: RunbookTriggerType.Manual,
      });

      await database.query(`DELETE FROM "Incident" WHERE "_id" = $1`, [
        incident,
      ]);

      const rows: Array<{ incidentId: string | null }> = await database.query(
        `SELECT "incidentId" FROM "RunbookExecution" WHERE "_id" = $1`,
        [runOfIncident],
      );
      expect(rows).toEqual([{ incidentId: null }]);
    });
  },
);
