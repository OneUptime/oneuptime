import { MoveFixPullRequestSwitchesIntoRules1805800000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1805800000000-MoveFixPullRequestSwitchesIntoRules";
import {
  AutomaticFixPullRequest,
  AutomaticFixPullRequestBlocker,
  decideAutomaticFixPullRequest,
} from "../../../../Types/AI/AutomaticFixPullRequests";
import AutoRemediationTriggerEntity from "../../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import ObjectID from "../../../../Types/ObjectID";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { DataSource, QueryRunner } from "typeorm";

/*
 * The MoveFixPullRequestSwitchesIntoRules migration against a real
 * Postgres, on real rows: every project keeps its pull request choice as
 * the four project switches move into the auto remediation rules.
 *
 *   - a project with fixing off, or both switches on, keeps its rules as
 *     they are (their switches start on) and gets no new rule;
 *   - a project with fixing on and a switch off: its rules of that kind -
 *     enabled or not - take the switch off, and with no enabled rule of
 *     that kind it gets one rule, "All incidents" (or "All alerts"), that
 *     fixes as no rule did and holds both switches as the project had them;
 *   - down() gives each project its switches back from its rules.
 *
 * Opt in with RUN_POSTGRES_FIX_PULL_REQUEST_SWITCH_TESTS=true and the
 * normal database credentials; FIX_PULL_REQUEST_SWITCH_TEST_DATABASE_HOST /
 * _PORT / _NAME point it at a database other than the local development
 * one. The database must already be migrated: the tables are cloned from
 * public into a uniquely named schema (so the source's rows are never read
 * or modified) and put back as they were before the migration, which then
 * runs up() - and down() - on seeded rows. The schema is dropped
 * afterwards.
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml ("Test moving
 * the fix pull request switches into the rules on migrated Postgres"),
 * right after that job has applied every registered migration. The Common
 * test job's Postgres is not migrated, so the suite is skipped there.
 */

// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_FIX_PULL_REQUEST_SWITCH_TESTS"] === "true"
    ? describe
    : describe.skip;

const CLONED_TABLES: Array<string> = [
  "Project",
  "AutoRemediationRule",
  "AIInvestigationRule",
  "CodeRepository",
];

const PROJECT_SWITCHES: Array<string> = [
  "enableAutomaticIncidentCodeFixes",
  "enableIncidentInstrumentationFixTasks",
  "enableAutomaticAlertCodeFixes",
  "enableAlertInstrumentationFixTasks",
];

// A dash in a uuid is not a character a schema name may hold unquoted.
const DASH: RegExp = /-/g;

interface ProjectSeed {
  enableAutomaticIncidentRemediation: boolean;
  enableAutomaticIncidentCodeFixes: boolean;
  enableIncidentInstrumentationFixTasks: boolean;
  enableAutomaticAlertRemediation?: boolean;
  enableAutomaticAlertCodeFixes?: boolean;
  enableAlertInstrumentationFixTasks?: boolean;
  deletedAt?: Date | undefined;
}

interface RuleSeed {
  triggerEntityType: "Incident" | "Alert";
  isEnabled: boolean;
  deletedAt?: Date | undefined;
}

interface RuleRow {
  _id: string;
  projectId: string;
  name: string;
  description: string | null;
  version: number;
  isEnabled: boolean;
  triggerEntityType: string;
  executionMode: string;
  remediationAction: string;
  aiSelectsRunbook: boolean;
  aiComposesCommands: boolean;
  runnerId: string | null;
  openCodeFixPullRequests: boolean;
  openTelemetryPullRequests: boolean;
}

describePostgres("MoveFixPullRequestSwitchesIntoRules against Postgres", () => {
  const schema: string = `fix_pull_request_switch_test_${ObjectID.generate()
    .toString()
    .replace(DASH, "")}`;
  let database: DataSource;

  const requiredColumnsByTable: Map<
    string,
    Array<{ column_name: string; udt_name: string }>
  > = new Map();

  async function runInSchema(
    step: (queryRunner: QueryRunner) => Promise<void>,
  ): Promise<void> {
    const queryRunner: QueryRunner = database.createQueryRunner();
    try {
      await queryRunner.query(`SET search_path TO "${schema}"`);
      await step(queryRunner);
    } finally {
      await queryRunner.release();
    }
  }

  /*
   * Inserts a row, filling every NOT NULL column that has no default and
   * was not given with a unique value of its type, so the seeds below only
   * say what the test is about.
   */
  async function insertRow(
    table: string,
    values: Record<string, unknown>,
  ): Promise<string> {
    let required: Array<{ column_name: string; udt_name: string }> | undefined =
      requiredColumnsByTable.get(table);

    if (!required) {
      required = await database.query(
        `SELECT column_name, udt_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
           AND is_nullable = 'NO' AND column_default IS NULL`,
        [schema, table],
      );
      requiredColumnsByTable.set(table, required!);
    }

    const row: Record<string, unknown> = {
      _id: ObjectID.generate().toString(),
      ...values,
    };

    for (const column of required!) {
      if (column.column_name in row) {
        continue;
      }

      if (column.udt_name === "uuid") {
        row[column.column_name] = ObjectID.generate().toString();
      } else if (column.udt_name === "int4") {
        row[column.column_name] = 1;
      } else if (column.udt_name === "bool") {
        row[column.column_name] = false;
      } else {
        row[column.column_name] =
          `${column.column_name}-${ObjectID.generate().toString()}`;
      }
    }

    const columns: Array<string> = Object.keys(row);

    await database.query(
      `INSERT INTO "${schema}"."${table}" (${columns
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

  async function seedProject(seed: ProjectSeed): Promise<string> {
    return insertRow("Project", {
      enableAutomaticAlertRemediation: false,
      enableAutomaticAlertCodeFixes: false,
      enableAlertInstrumentationFixTasks: false,
      ...seed,
    });
  }

  async function seedRule(projectId: string, seed: RuleSeed): Promise<string> {
    return insertRow("AutoRemediationRule", {
      projectId,
      name: `rule-${ObjectID.generate().toString()}`,
      executionMode: "Suggest",
      ...seed,
    });
  }

  async function rulesOf(
    projectId: string,
    triggerEntityType?: "Incident" | "Alert",
  ): Promise<Array<RuleRow>> {
    return database.query(
      `SELECT "_id", "projectId", "name", "description", "version", "isEnabled", "triggerEntityType",
              "executionMode", "remediationAction", "aiSelectsRunbook", "aiComposesCommands", "runnerId",
              "openCodeFixPullRequests", "openTelemetryPullRequests"
       FROM "${schema}"."AutoRemediationRule"
       WHERE "projectId" = $1 AND ($2::text IS NULL OR "triggerEntityType" = $2)
       ORDER BY "createdAt", "name"`,
      [projectId, triggerEntityType || null],
    );
  }

  async function ruleOf(id: string): Promise<RuleRow> {
    const rows: Array<RuleRow> = await database.query(
      `SELECT "_id", "openCodeFixPullRequests", "openTelemetryPullRequests", "isEnabled"
       FROM "${schema}"."AutoRemediationRule" WHERE "_id" = $1`,
      [id],
    );
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  async function columnsOf(
    table: string,
    names: Array<string>,
  ): Promise<
    Array<{
      column_name: string;
      data_type: string;
      column_default: string | null;
      is_nullable: string;
    }>
  > {
    return database.query(
      `SELECT column_name, data_type, column_default, is_nullable FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2 AND column_name = ANY($3)
       ORDER BY column_name`,
      [schema, table, names],
    );
  }

  // Seeded before up(), read after it.
  const projects: Map<string, string> = new Map();
  const rules: Map<string, string> = new Map();
  let projectSwitchesAfterUp: Array<unknown> = [];
  let ruleColumnsAfterUp: Array<unknown> = [];
  let joinTablesAfterUp: Array<{ table_name: string }> = [];
  let foreignKeysAfterUp: Array<{ table_name: string; references: string }> =
    [];
  let switchesAfterDown: Map<string, Record<string, boolean>> = new Map();

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["FIX_PULL_REQUEST_SWITCH_TEST_DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["FIX_PULL_REQUEST_SWITCH_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["FIX_PULL_REQUEST_SWITCH_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      schema: schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of CLONED_TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    /*
     * Start from the tables as they were BEFORE the migration, whether or
     * not the source database has run it: the project's four switches as
     * they were added (boolean, NOT NULL, off), and no rule columns.
     */
    for (const column of PROJECT_SWITCHES) {
      await database.query(
        `ALTER TABLE "${schema}"."Project" DROP COLUMN IF EXISTS "${column}"`,
      );
      await database.query(
        `ALTER TABLE "${schema}"."Project" ADD "${column}" boolean NOT NULL DEFAULT false`,
      );
    }

    for (const column of [
      "openCodeFixPullRequests",
      "openTelemetryPullRequests",
    ]) {
      await database.query(
        `ALTER TABLE "${schema}"."AutoRemediationRule" DROP COLUMN IF EXISTS "${column}"`,
      );
    }

    // Fixing off: the switches decided nothing, so nothing carries over.
    projects.set(
      "fixing off",
      await seedProject({
        enableAutomaticIncidentRemediation: false,
        enableAutomaticIncidentCodeFixes: false,
        enableIncidentInstrumentationFixTasks: false,
      }),
    );
    rules.set(
      "fixing off: rule",
      await seedRule(projects.get("fixing off")!, {
        triggerEntityType: "Incident",
        isEnabled: true,
      }),
    );

    // Fixing on and both switches on - what turning fixing on gave.
    projects.set(
      "both on",
      await seedProject({
        enableAutomaticIncidentRemediation: true,
        enableAutomaticIncidentCodeFixes: true,
        enableIncidentInstrumentationFixTasks: true,
      }),
    );

    // Fixing on, fix pull requests off, no rule at all.
    projects.set(
      "fix pull requests off, no rule",
      await seedProject({
        enableAutomaticIncidentRemediation: true,
        enableAutomaticIncidentCodeFixes: false,
        enableIncidentInstrumentationFixTasks: true,
      }),
    );

    // Fixing on, both off, with rules of both kinds, one of them off.
    projects.set(
      "both off, with rules",
      await seedProject({
        enableAutomaticIncidentRemediation: true,
        enableAutomaticIncidentCodeFixes: false,
        enableIncidentInstrumentationFixTasks: false,
        enableAutomaticAlertRemediation: true,
        enableAutomaticAlertCodeFixes: true,
        enableAlertInstrumentationFixTasks: true,
      }),
    );
    rules.set(
      "both off: enabled incident rule",
      await seedRule(projects.get("both off, with rules")!, {
        triggerEntityType: "Incident",
        isEnabled: true,
      }),
    );
    rules.set(
      "both off: disabled incident rule",
      await seedRule(projects.get("both off, with rules")!, {
        triggerEntityType: "Incident",
        isEnabled: false,
      }),
    );
    rules.set(
      "both off: alert rule",
      await seedRule(projects.get("both off, with rules")!, {
        triggerEntityType: "Alert",
        isEnabled: true,
      }),
    );

    // Fixing on, telemetry off, and only a rule that is turned off.
    projects.set(
      "telemetry off, only a disabled rule",
      await seedProject({
        enableAutomaticIncidentRemediation: true,
        enableAutomaticIncidentCodeFixes: true,
        enableIncidentInstrumentationFixTasks: false,
      }),
    );
    rules.set(
      "telemetry off: disabled rule",
      await seedRule(projects.get("telemetry off, only a disabled rule")!, {
        triggerEntityType: "Incident",
        isEnabled: false,
      }),
    );

    // Fixing on, fix pull requests off, and only a deleted rule.
    projects.set(
      "fix pull requests off, only a deleted rule",
      await seedProject({
        enableAutomaticIncidentRemediation: true,
        enableAutomaticIncidentCodeFixes: false,
        enableIncidentInstrumentationFixTasks: true,
      }),
    );
    rules.set(
      "deleted rule",
      await seedRule(projects.get("fix pull requests off, only a deleted rule")!, {
        triggerEntityType: "Incident",
        isEnabled: true,
        deletedAt: new Date(),
      }),
    );

    // Alerts on their own: alert telemetry off, no alert rule.
    projects.set(
      "alert telemetry off",
      await seedProject({
        enableAutomaticIncidentRemediation: false,
        enableAutomaticIncidentCodeFixes: false,
        enableIncidentInstrumentationFixTasks: false,
        enableAutomaticAlertRemediation: true,
        enableAutomaticAlertCodeFixes: true,
        enableAlertInstrumentationFixTasks: false,
      }),
    );

    // A deleted project gets no new rule.
    projects.set(
      "deleted project",
      await seedProject({
        enableAutomaticIncidentRemediation: true,
        enableAutomaticIncidentCodeFixes: false,
        enableIncidentInstrumentationFixTasks: false,
        deletedAt: new Date(),
      }),
    );

    await runInSchema(async (queryRunner: QueryRunner) => {
      await new MoveFixPullRequestSwitchesIntoRules1805800000000().up(
        queryRunner,
      );
    });

    projectSwitchesAfterUp = await columnsOf("Project", PROJECT_SWITCHES);
    ruleColumnsAfterUp = await columnsOf("AutoRemediationRule", [
      "openCodeFixPullRequests",
      "openTelemetryPullRequests",
    ]);
    joinTablesAfterUp = await database.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = $1 AND table_name IN ('AutoRemediationRuleCodeRepository', 'AIInvestigationRuleCodeRepository')
       ORDER BY table_name`,
      [schema],
    );
    foreignKeysAfterUp = await database.query(
      `SELECT source.relname AS table_name, target.relname AS references
       FROM pg_constraint
       JOIN pg_class source ON source.oid = pg_constraint.conrelid
       JOIN pg_class target ON target.oid = pg_constraint.confrelid
       JOIN pg_namespace ON pg_namespace.oid = source.relnamespace
       WHERE pg_constraint.contype = 'f' AND pg_namespace.nspname = $1
         AND source.relname IN ('AutoRemediationRuleCodeRepository', 'AIInvestigationRuleCodeRepository')
       ORDER BY source.relname, target.relname`,
      [schema],
    );
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  function project(label: string): string {
    const id: string | undefined = projects.get(label);
    expect(id).toBeDefined();
    return id!;
  }

  function rule(label: string): string {
    const id: string | undefined = rules.get(label);
    expect(id).toBeDefined();
    return id!;
  }

  describe("the schema", () => {
    test("the project's four switches are gone", () => {
      expect(projectSwitchesAfterUp).toEqual([]);
    });

    test("each rule has the two pull request switches, on by default", () => {
      expect(ruleColumnsAfterUp).toEqual([
        {
          column_name: "openCodeFixPullRequests",
          data_type: "boolean",
          column_default: "true",
          is_nullable: "NO",
        },
        {
          column_name: "openTelemetryPullRequests",
          data_type: "boolean",
          column_default: "true",
          is_nullable: "NO",
        },
      ]);
    });

    test("both kinds of rule name their code repositories in a join table of their own", () => {
      expect(joinTablesAfterUp).toEqual([
        { table_name: "AIInvestigationRuleCodeRepository" },
        { table_name: "AutoRemediationRuleCodeRepository" },
      ]);
      expect(foreignKeysAfterUp).toEqual([
        {
          table_name: "AIInvestigationRuleCodeRepository",
          references: "AIInvestigationRule",
        },
        {
          table_name: "AIInvestigationRuleCodeRepository",
          references: "CodeRepository",
        },
        {
          table_name: "AutoRemediationRuleCodeRepository",
          references: "AutoRemediationRule",
        },
        {
          table_name: "AutoRemediationRuleCodeRepository",
          references: "CodeRepository",
        },
      ]);
    });

    test("a repository a rule names goes with the rule, and with the repository", async () => {
      const projectId: string = project("both on");
      const ruleId: string = await seedRule(projectId, {
        triggerEntityType: "Incident",
        isEnabled: true,
      });
      const repositoryId: string = await insertRow("CodeRepository", {
        projectId,
      });

      await database.query(
        `INSERT INTO "${schema}"."AutoRemediationRuleCodeRepository" ("autoRemediationRuleId", "codeRepositoryId") VALUES ($1, $2)`,
        [ruleId, repositoryId],
      );
      await database.query(
        `DELETE FROM "${schema}"."CodeRepository" WHERE "_id" = $1`,
        [repositoryId],
      );

      const left: Array<unknown> = await database.query(
        `SELECT 1 FROM "${schema}"."AutoRemediationRuleCodeRepository" WHERE "autoRemediationRuleId" = $1`,
        [ruleId],
      );

      expect(left).toEqual([]);
    });
  });

  describe("every project keeps its choice", () => {
    test("fixing off: its rules start on, and no rule is added", async () => {
      expect(await ruleOf(rule("fixing off: rule"))).toMatchObject({
        openCodeFixPullRequests: true,
        openTelemetryPullRequests: true,
      });
      expect(await rulesOf(project("fixing off"))).toHaveLength(1);
    });

    test("both on: no rule is added - with no rule both are on", async () => {
      expect(await rulesOf(project("both on"), "Alert")).toEqual([]);
      expect(
        (await rulesOf(project("both on"), "Incident")).filter(
          (row: RuleRow): boolean => {
            return row.name === "All incidents";
          },
        ),
      ).toEqual([]);
    });

    test("a switch off with no rule: one rule that matches every incident and keeps it off", async () => {
      const added: Array<RuleRow> = await rulesOf(
        project("fix pull requests off, no rule"),
      );

      expect(added).toHaveLength(1);
      expect(added[0]).toMatchObject({
        name: "All incidents",
        version: 1,
        isEnabled: true,
        triggerEntityType: "Incident",
        executionMode: "FullAuto",
        remediationAction: "OneUptimeAI",
        aiSelectsRunbook: false,
        aiComposesCommands: false,
        runnerId: null,
        openCodeFixPullRequests: false,
        openTelemetryPullRequests: true,
      });
      expect(added[0]!.description).toContain(
        "to keep this project's choice",
      );

      // The rule it added opens telemetry pull requests, never fix ones.
      const fixingOn: { enableAutomaticIncidentRemediation: boolean } = {
        enableAutomaticIncidentRemediation: true,
      };
      const facts: { rulesSetUp: boolean; matchingRules: Array<RuleRow> } = {
        rulesSetUp: true,
        matchingRules: added,
      };

      expect(
        decideAutomaticFixPullRequest({
          project: fixingOn,
          signal: AutoRemediationTriggerEntity.Incident,
          pullRequest: AutomaticFixPullRequest.CodeFix,
          rules: facts,
        }).blocker,
      ).toBe(AutomaticFixPullRequestBlocker.PullRequestOff);
      expect(
        decideAutomaticFixPullRequest({
          project: fixingOn,
          signal: AutoRemediationTriggerEntity.Incident,
          pullRequest: AutomaticFixPullRequest.MissingTelemetry,
          rules: facts,
        }).blocker,
      ).toBeNull();
    });

    test("both off with rules: every rule of that kind takes them off, enabled or not; no rule is added; the alert rules keep theirs", async () => {
      expect(
        await ruleOf(rule("both off: enabled incident rule")),
      ).toMatchObject({
        openCodeFixPullRequests: false,
        openTelemetryPullRequests: false,
      });
      expect(
        await ruleOf(rule("both off: disabled incident rule")),
      ).toMatchObject({
        openCodeFixPullRequests: false,
        openTelemetryPullRequests: false,
      });
      expect(await ruleOf(rule("both off: alert rule"))).toMatchObject({
        openCodeFixPullRequests: true,
        openTelemetryPullRequests: true,
      });
      expect(await rulesOf(project("both off, with rules"))).toHaveLength(3);
    });

    test("only a disabled rule holds nothing: that rule takes the switch off, and a rule is added to keep it", async () => {
      expect(await ruleOf(rule("telemetry off: disabled rule"))).toMatchObject({
        isEnabled: false,
        openCodeFixPullRequests: true,
        openTelemetryPullRequests: false,
      });

      const added: Array<RuleRow> = (
        await rulesOf(project("telemetry off, only a disabled rule"))
      ).filter((row: RuleRow): boolean => {
        return row.isEnabled;
      });

      expect(added).toHaveLength(1);
      expect(added[0]).toMatchObject({
        name: "All incidents",
        openCodeFixPullRequests: true,
        openTelemetryPullRequests: false,
      });
    });

    test("a deleted rule holds nothing either: a rule is added", async () => {
      const enabled: Array<RuleRow> = (
        await rulesOf(project("fix pull requests off, only a deleted rule"))
      ).filter((row: RuleRow): boolean => {
        return row._id !== rule("deleted rule");
      });

      expect(enabled).toHaveLength(1);
      expect(enabled[0]).toMatchObject({
        name: "All incidents",
        openCodeFixPullRequests: false,
        openTelemetryPullRequests: true,
      });
    });

    test("alerts on their own: one rule for every alert, holding the alert switches", async () => {
      const added: Array<RuleRow> = await rulesOf(
        project("alert telemetry off"),
      );

      expect(added).toHaveLength(1);
      expect(added[0]).toMatchObject({
        name: "All alerts",
        triggerEntityType: "Alert",
        executionMode: "FullAuto",
        remediationAction: "OneUptimeAI",
        openCodeFixPullRequests: true,
        openTelemetryPullRequests: false,
      });
      expect(added[0]!.description).toContain("every alert");
    });

    test("a deleted project gets no rule", async () => {
      expect(await rulesOf(project("deleted project"))).toEqual([]);
    });
  });

  describe("down()", () => {
    beforeAll(async () => {
      await runInSchema(async (queryRunner: QueryRunner) => {
        await new MoveFixPullRequestSwitchesIntoRules1805800000000().down(
          queryRunner,
        );
      });

      const rows: Array<Record<string, unknown>> = await database.query(
        `SELECT "_id", ${PROJECT_SWITCHES.map((column: string): string => {
          return `"${column}"`;
        }).join(", ")} FROM "${schema}"."Project"`,
      );

      switchesAfterDown = new Map(
        rows.map((row: Record<string, unknown>) => {
          return [row["_id"] as string, row as Record<string, boolean>];
        }),
      );
    });

    function switchesOf(label: string): Record<string, boolean> {
      const row: Record<string, boolean> | undefined = switchesAfterDown.get(
        project(label),
      );
      expect(row).toBeDefined();
      return row!;
    }

    test("gives each project its switches back from its rules", () => {
      expect(switchesOf("both on")).toMatchObject({
        enableAutomaticIncidentCodeFixes: true,
        enableIncidentInstrumentationFixTasks: true,
      });
      expect(switchesOf("fix pull requests off, no rule")).toMatchObject({
        enableAutomaticIncidentCodeFixes: false,
        enableIncidentInstrumentationFixTasks: true,
      });
      expect(switchesOf("both off, with rules")).toMatchObject({
        enableAutomaticIncidentCodeFixes: false,
        enableIncidentInstrumentationFixTasks: false,
        enableAutomaticAlertCodeFixes: true,
        enableAlertInstrumentationFixTasks: true,
      });
      expect(switchesOf("alert telemetry off")).toMatchObject({
        enableAutomaticAlertCodeFixes: true,
        enableAlertInstrumentationFixTasks: false,
      });
    });

    test("fixing off: off, as the dashboard kept them", () => {
      expect(switchesOf("fixing off")).toMatchObject({
        enableAutomaticIncidentCodeFixes: false,
        enableIncidentInstrumentationFixTasks: false,
      });
    });

    test("the rules' columns and the join tables are gone again", async () => {
      expect(
        await columnsOf("AutoRemediationRule", [
          "openCodeFixPullRequests",
          "openTelemetryPullRequests",
        ]),
      ).toEqual([]);

      const tables: Array<unknown> = await database.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = $1 AND table_name IN ('AutoRemediationRuleCodeRepository', 'AIInvestigationRuleCodeRepository')`,
        [schema],
      );

      expect(tables).toEqual([]);
    });
  });
});
