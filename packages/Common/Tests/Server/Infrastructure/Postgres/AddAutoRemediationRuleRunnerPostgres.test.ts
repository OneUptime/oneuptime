import {
  AddAutoRemediationRuleRunner1804500000000,
  RESTORE_COMMAND_RUNNER_ROWS,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1804500000000-AddAutoRemediationRuleRunner";
import { AddAutoRemediationRuleRunnerIndexAndKey1804550000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1804550000000-AddAutoRemediationRuleRunnerIndexAndKey";
import { Service as RunnerServiceClass } from "../../../../Server/Services/RunnerService";
import ObjectID from "../../../../Types/ObjectID";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { DataSource, QueryRunner } from "typeorm";

/*
 * The AddAutoRemediationRuleRunner migration against a real Postgres, on
 * real rows: every auto remediation rule keeps doing what it did once a
 * rule picks its Runner and a Runner has no "Runs AI Remediation Commands"
 * switch; then AddAutoRemediationRuleRunnerIndexAndKey builds the column's
 * index and its key to "Runner" online.
 *
 * Opt in with RUN_POSTGRES_AUTO_REMEDIATION_RULE_RUNNER_TESTS=true and the
 * normal database credentials; AUTO_REMEDIATION_RULE_RUNNER_TEST_DATABASE_
 * HOST / _PORT / _NAME point it at a database other than the local
 * development one. The database must already be migrated: Runner,
 * AutoRemediationRule, AutoRemediationRuleRunner and
 * AutoRemediationRuleRunbook are cloned from public
 * into a uniquely named schema (so the source's rows are never read or
 * modified) and put back as they were before the migration - the rule
 * without its Runner - and both migrations' up() then run on seeded rows,
 * the second outside a transaction as it runs for real. The schema is
 * dropped afterwards.
 *
 * What it pins:
 *   - a rule saved before rules were simplified that composes commands and
 *     names no Command Runners ran on every Runner of its project with the
 *     switch on: those Runners are written out as its Command Runners - never
 *     a Runner with the switch off, a deleted one, one marked global,
 *     another project's, or an in-cluster Runner the Kubernetes agent chart
 *     installed (by the server's own rule, row by row);
 *   - such a rule that then names exactly one Runner it could run on picks
 *     it as its Runner, and the row moves; one naming several keeps them;
 *     one naming a Runner with the switch off, or another project's, keeps
 *     what it names;
 *   - a rule that runs its runbooks every time, a OneUptime AI rule, and a
 *     deleted rule are not given a Runner;
 *   - a OneUptime AI rule drops the runbooks its form held out of sight -
 *     they would now say which runbooks OneUptime AI may start without
 *     asking - while a rule that runs its runbooks every time, one where
 *     AI picks a runbook and one where AI composes commands keep theirs;
 *   - no Runner's switch changes;
 *   - the rule's Runner is indexed, its key to "Runner" is validated -
 *     running the online migration again changes nothing - and a deleted
 *     Runner leaves its rules picking none;
 *   - down()'s data step hands every rule's Runner back to its Command
 *     Runners.
 */

// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_AUTO_REMEDIATION_RULE_RUNNER_TESTS"] === "true"
    ? describe
    : describe.skip;

interface AgentSeed {
  label: string;
  name: string;
  hostInfo: unknown;
}

/*
 * Runners that could be agent rows, each alone in a project with the switch
 * on, under a command rule that names none. Whether the migration writes
 * one out must be what the server's own rule says.
 */
const AGENT_SEEDS: Array<AgentSeed> = [
  {
    label: "a Runner of the project's own",
    name: "prod-bastion",
    hostInfo: null,
  },
  { label: "agent by name", name: "kubernetes-agent/prod-us", hostInfo: null },
  {
    label: "agent by name, any case, leading space",
    name: "  Kubernetes-Agent/prod-eu",
    hostInfo: null,
  },
  {
    label: "agent by posture",
    name: "renamed-in-cluster-runner",
    hostInfo: { kubernetes: { inCluster: true, clusterIdentifier: "prod-ap" } },
  },
  {
    label: "in-cluster posture without a cluster",
    name: "posture-without-cluster",
    hostInfo: { kubernetes: { inCluster: true, clusterIdentifier: "   " } },
  },
  {
    label: "out-of-cluster posture",
    name: "out-of-cluster",
    hostInfo: { kubernetes: { inCluster: false, clusterIdentifier: "prod" } },
  },
  {
    label: "the prefix without its slash",
    name: "kubernetes-agent-prod",
    hostInfo: null,
  },
];

// The rule's join tables: rows of two ids, without an _id of their own.
const JOIN_TABLES: Array<string> = [
  "AutoRemediationRuleRunner",
  "AutoRemediationRuleRunbook",
];

describePostgres("AddAutoRemediationRuleRunner against Postgres", () => {
  const schema: string = `auto_remediation_rule_runner_test_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;

  const requiredColumnsByTable: Map<
    string,
    Array<{ column_name: string; udt_name: string }>
  > = new Map();

  // What the seeds are called by, mapped to the row ids they got.
  const ids: Map<string, string> = new Map();

  // Every Runner's switch before the migration ran.
  let switchesBefore: Array<{ _id: string; canRunAiCommands: boolean }> = [];

  function id(label: string): string {
    const found: string | undefined = ids.get(label);
    expect(found).toBeDefined();
    return found!;
  }

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
      ...(JOIN_TABLES.includes(table)
        ? {}
        : { _id: ObjectID.generate().toString() }),
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

    return (row["_id"] as string) || "";
  }

  async function seedRunner(
    label: string,
    values: {
      projectId: string | null;
      canRunAiCommands: boolean;
      name?: string;
      hostInfo?: unknown;
      isGlobalRunner?: boolean;
      deletedAt?: Date;
    },
  ): Promise<void> {
    ids.set(
      label,
      await insertRow("Runner", {
        projectId: values.projectId,
        canRunAiCommands: values.canRunAiCommands,
        name: values.name || `runner-${label}`,
        hostInfo:
          values.hostInfo === undefined || values.hostInfo === null
            ? null
            : JSON.stringify(values.hostInfo),
        isGlobalRunner: values.isGlobalRunner === true,
        ...(values.deletedAt ? { deletedAt: values.deletedAt } : {}),
      }),
    );
  }

  async function seedRule(
    label: string,
    values: {
      projectId: string;
      aiComposesCommands?: boolean;
      aiSelectsRunbook?: boolean;
      executionMode?: string;
      remediationAction?: string;
      // Labels of the Runners the rule names as its Command Runners.
      commandRunners?: Array<string>;
      // Labels of the runbooks the rule holds.
      runbooks?: Array<string>;
      deletedAt?: Date;
    },
  ): Promise<void> {
    ids.set(
      label,
      await insertRow("AutoRemediationRule", {
        projectId: values.projectId,
        name: label,
        aiComposesCommands: values.aiComposesCommands === true,
        aiSelectsRunbook: values.aiSelectsRunbook === true,
        remediationAction: values.remediationAction || "OneUptimeAI",
        ...(values.executionMode
          ? { executionMode: values.executionMode }
          : {}),
        ...(values.deletedAt ? { deletedAt: values.deletedAt } : {}),
      }),
    );

    for (const runner of values.commandRunners || []) {
      await insertRow("AutoRemediationRuleRunner", {
        autoRemediationRuleId: id(label),
        runnerId: id(runner),
      });
    }

    for (const runbook of values.runbooks || []) {
      if (!ids.has(runbook)) {
        // The table is cloned without its keys: a runbook is an id here.
        ids.set(runbook, ObjectID.generate().toString());
      }

      await insertRow("AutoRemediationRuleRunbook", {
        autoRemediationRuleId: id(label),
        runbookId: id(runbook),
      });
    }
  }

  async function runnerOf(rule: string): Promise<string | null> {
    const rows: Array<{ runnerId: string | null }> = await database.query(
      `SELECT "runnerId" FROM "${schema}"."AutoRemediationRule" WHERE "_id" = $1`,
      [id(rule)],
    );
    expect(rows).toHaveLength(1);
    return rows[0]!.runnerId;
  }

  async function runbooksOf(rule: string): Promise<Array<string>> {
    const rows: Array<{ runbookId: string }> = await database.query(
      `SELECT "runbookId" FROM "${schema}"."AutoRemediationRuleRunbook" WHERE "autoRemediationRuleId" = $1`,
      [id(rule)],
    );
    return rows
      .map((row: { runbookId: string }): string => {
        return row.runbookId;
      })
      .sort();
  }

  async function commandRunnersOf(rule: string): Promise<Array<string>> {
    const rows: Array<{ runnerId: string }> = await database.query(
      `SELECT "runnerId" FROM "${schema}"."AutoRemediationRuleRunner" WHERE "autoRemediationRuleId" = $1`,
      [id(rule)],
    );
    return rows
      .map((row: { runnerId: string }): string => {
        return row.runnerId;
      })
      .sort();
  }

  function sorted(...labels: Array<string>): Array<string> {
    return labels.map(id).sort();
  }

  const projectAny: string = ObjectID.generate().toString();
  const projectOne: string = ObjectID.generate().toString();
  const projectNamed: string = ObjectID.generate().toString();
  const projectOther: string = ObjectID.generate().toString();
  const projectElsewhere: string = ObjectID.generate().toString();
  const projectUntouched: string = ObjectID.generate().toString();
  const projectRunbooks: string = ObjectID.generate().toString();

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["AUTO_REMEDIATION_RULE_RUNNER_TEST_DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["AUTO_REMEDIATION_RULE_RUNNER_TEST_DATABASE_PORT"] ||
          "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["AUTO_REMEDIATION_RULE_RUNNER_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      schema: schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of [
      "Runner",
      "AutoRemediationRule",
      "AutoRemediationRuleRunner",
      "AutoRemediationRuleRunbook",
    ]) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    /*
     * The rule as it was BEFORE the migration, whether or not the source
     * database has run it: without its Runner.
     */
    await database.query(
      `ALTER TABLE "${schema}"."AutoRemediationRule" DROP COLUMN IF EXISTS "runnerId"`,
    );

    // A command rule naming no Runner, in a project with every kind of one.
    await seedRunner("any: on", {
      projectId: projectAny,
      canRunAiCommands: true,
    });
    await seedRunner("any: on too", {
      projectId: projectAny,
      canRunAiCommands: true,
    });
    await seedRunner("any: off", {
      projectId: projectAny,
      canRunAiCommands: false,
    });
    await seedRunner("any: deleted", {
      projectId: projectAny,
      canRunAiCommands: true,
      deletedAt: new Date(),
    });
    await seedRunner("any: marked global", {
      projectId: projectAny,
      canRunAiCommands: true,
      isGlobalRunner: true,
    });
    await seedRunner("any: agent", {
      projectId: projectAny,
      canRunAiCommands: true,
      name: "kubernetes-agent/prod-east",
    });
    await seedRule("any: names none", {
      projectId: projectAny,
      aiComposesCommands: true,
    });

    // A command rule naming none, in a project with one Runner it could use.
    await seedRunner("one: on", {
      projectId: projectOne,
      canRunAiCommands: true,
    });
    await seedRunner("one: off", {
      projectId: projectOne,
      canRunAiCommands: false,
    });
    await seedRule("one: names none", {
      projectId: projectOne,
      aiComposesCommands: true,
    });

    // Command rules that name their Runners.
    await seedRunner("named: first", {
      projectId: projectNamed,
      canRunAiCommands: true,
    });
    await seedRunner("named: second", {
      projectId: projectNamed,
      canRunAiCommands: true,
    });
    await seedRunner("named: off", {
      projectId: projectNamed,
      canRunAiCommands: false,
    });
    await seedRule("named: one", {
      projectId: projectNamed,
      aiComposesCommands: true,
      commandRunners: ["named: first"],
    });
    await seedRule("named: two", {
      projectId: projectNamed,
      aiComposesCommands: true,
      commandRunners: ["named: first", "named: second"],
    });
    await seedRule("named: one with the switch off", {
      projectId: projectNamed,
      aiComposesCommands: true,
      commandRunners: ["named: off"],
    });

    // A rule naming another project's Runner (it never ran there).
    await seedRunner("elsewhere: on", {
      projectId: projectElsewhere,
      canRunAiCommands: true,
    });
    await seedRule("other: names another project's", {
      projectId: projectOther,
      aiComposesCommands: true,
      commandRunners: ["elsewhere: on"],
    });

    // Rules the carry-over leaves alone.
    await seedRunner("untouched: on", {
      projectId: projectUntouched,
      canRunAiCommands: true,
    });
    await seedRule("untouched: runs its runbooks every time", {
      projectId: projectUntouched,
      aiComposesCommands: true,
      remediationAction: "Runbooks",
    });
    await seedRule("untouched: OneUptime AI", {
      projectId: projectUntouched,
    });
    await seedRule("untouched: picks a runbook", {
      projectId: projectUntouched,
    });
    await database.query(
      `UPDATE "${schema}"."AutoRemediationRule" SET "aiSelectsRunbook" = true WHERE "_id" = $1`,
      [id("untouched: picks a runbook")],
    );
    await seedRule("untouched: deleted", {
      projectId: projectUntouched,
      aiComposesCommands: true,
      deletedAt: new Date(),
    });

    /*
     * Rules holding runbooks. The form hid a OneUptime AI rule's runbooks,
     * so those it holds were never chosen for it - fixing without asking,
     * or asking first.
     */
    await seedRule("runbooks: OneUptime AI, without asking", {
      projectId: projectRunbooks,
      executionMode: "FullAuto",
      runbooks: ["runbook: restart", "runbook: failover"],
    });
    await seedRule("runbooks: OneUptime AI, asking first", {
      projectId: projectRunbooks,
      executionMode: "Suggest",
      runbooks: ["runbook: restart"],
    });
    await seedRule("runbooks: OneUptime AI, deleted", {
      projectId: projectRunbooks,
      runbooks: ["runbook: restart"],
      deletedAt: new Date(),
    });
    await seedRule("runbooks: every time", {
      projectId: projectRunbooks,
      executionMode: "FullAuto",
      remediationAction: "Runbooks",
      runbooks: ["runbook: restart", "runbook: failover"],
    });
    await seedRule("runbooks: AI picks one", {
      projectId: projectRunbooks,
      aiSelectsRunbook: true,
      runbooks: ["runbook: restart"],
    });
    await seedRule("runbooks: AI composes commands", {
      projectId: projectRunbooks,
      aiComposesCommands: true,
      runbooks: ["runbook: failover"],
    });
    await seedRule("runbooks: OneUptime AI naming none", {
      projectId: projectRunbooks,
    });

    for (const seed of AGENT_SEEDS) {
      const projectId: string = ObjectID.generate().toString();

      await seedRunner(`agent: ${seed.label}`, {
        projectId,
        canRunAiCommands: true,
        name: seed.name,
        hostInfo: seed.hostInfo,
      });
      await seedRule(`agent rule: ${seed.label}`, {
        projectId,
        aiComposesCommands: true,
      });
    }

    switchesBefore = await database.query(
      `SELECT "_id", "canRunAiCommands" FROM "${schema}"."Runner" ORDER BY "_id"`,
    );

    await runInSchema(async (queryRunner: QueryRunner) => {
      await new AddAutoRemediationRuleRunner1804500000000().up(queryRunner);
    });

    // The index and the key, online, outside a transaction.
    await runInSchema(async (queryRunner: QueryRunner) => {
      await new AddAutoRemediationRuleRunnerIndexAndKey1804550000000().up(
        queryRunner,
      );
    });
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  test("a command rule that named no Runner names every one of its project's it could run on", async () => {
    expect(await commandRunnersOf("any: names none")).toEqual(
      sorted("any: on", "any: on too"),
    );
    // Two of them: none is picked as its Runner.
    expect(await runnerOf("any: names none")).toBeNull();
  });

  test("one Runner it could run on is picked as its Runner, and its row moves", async () => {
    expect(await runnerOf("one: names none")).toBe(id("one: on"));
    expect(await commandRunnersOf("one: names none")).toEqual([]);
  });

  test("a command rule naming one Runner picks it; naming two keeps both", async () => {
    expect(await runnerOf("named: one")).toBe(id("named: first"));
    expect(await commandRunnersOf("named: one")).toEqual([]);

    expect(await runnerOf("named: two")).toBeNull();
    expect(await commandRunnersOf("named: two")).toEqual(
      sorted("named: first", "named: second"),
    );
  });

  test("a Runner with the switch off, or another project's, is never picked: the rule keeps what it names", async () => {
    expect(await runnerOf("named: one with the switch off")).toBeNull();
    expect(await commandRunnersOf("named: one with the switch off")).toEqual(
      sorted("named: off"),
    );

    expect(await runnerOf("other: names another project's")).toBeNull();
    expect(await commandRunnersOf("other: names another project's")).toEqual(
      sorted("elsewhere: on"),
    );
  });

  test("rules that run their runbooks, OneUptime AI rules and deleted rules get no Runner and no Command Runners", async () => {
    for (const rule of [
      "untouched: runs its runbooks every time",
      "untouched: OneUptime AI",
      "untouched: picks a runbook",
      "untouched: deleted",
    ]) {
      expect({ rule, runner: await runnerOf(rule) }).toEqual({
        rule,
        runner: null,
      });
      expect({ rule, named: await commandRunnersOf(rule) }).toEqual({
        rule,
        named: [],
      });
    }
  });

  test("a OneUptime AI rule drops the runbooks its form held out of sight, asking first or not, deleted or not", async () => {
    for (const rule of [
      "runbooks: OneUptime AI, without asking",
      "runbooks: OneUptime AI, asking first",
      "runbooks: OneUptime AI, deleted",
      "runbooks: OneUptime AI naming none",
    ]) {
      expect({ rule, runbooks: await runbooksOf(rule) }).toEqual({
        rule,
        runbooks: [],
      });
    }
  });

  test("a rule that runs its runbooks every time keeps every one of them", async () => {
    expect(await runbooksOf("runbooks: every time")).toEqual(
      sorted("runbook: restart", "runbook: failover"),
    );
  });

  test("rules saved before rules were simplified keep their runbooks: AI picking one, and AI composing commands", async () => {
    expect(await runbooksOf("runbooks: AI picks one")).toEqual(
      sorted("runbook: restart"),
    );
    expect(await runbooksOf("runbooks: AI composes commands")).toEqual(
      sorted("runbook: failover"),
    );
  });

  test("dropping a rule's hidden runbooks leaves the rule itself, and its Runner, as they were", async () => {
    const rows: Array<{ name: string; runnerId: string | null }> =
      await database.query(
        `SELECT "name", "runnerId" FROM "${schema}"."AutoRemediationRule" WHERE "projectId" = $1`,
        [projectRunbooks],
      );

    // Sorted here: the database's collation orders names its own way.
    expect(
      rows
        .map((row: { name: string; runnerId: string | null }): string => {
          return row.name;
        })
        .sort(),
    ).toEqual(
      [
        "runbooks: AI composes commands",
        "runbooks: AI picks one",
        "runbooks: OneUptime AI naming none",
        "runbooks: OneUptime AI, asking first",
        "runbooks: OneUptime AI, deleted",
        "runbooks: OneUptime AI, without asking",
        "runbooks: every time",
      ].sort(),
    );

    for (const row of rows) {
      expect(row.runnerId).toBeNull();
    }
  });

  test.each(
    AGENT_SEEDS.map((seed: AgentSeed): string => {
      return seed.label;
    }),
  )(
    "%s: written out exactly when the server would not call it an agent row",
    async (label: string) => {
      const seed: AgentSeed = AGENT_SEEDS.find(
        (candidate: AgentSeed): boolean => {
          return candidate.label === label;
        },
      )!;
      const isAgent: boolean = RunnerServiceClass.isKubernetesAgentRunnerRow({
        name: seed.name,
        hostInfo: seed.hostInfo as never,
      });

      // Alone in its project: written out, then picked as the rule's Runner.
      expect(await runnerOf(`agent rule: ${label}`)).toBe(
        isAgent ? null : id(`agent: ${label}`),
      );
      expect(await commandRunnersOf(`agent rule: ${label}`)).toEqual([]);
    },
  );

  test("the agent rows include the ones the server's rule names", () => {
    const answers: Array<boolean> = AGENT_SEEDS.map(
      (seed: AgentSeed): boolean => {
        return RunnerServiceClass.isKubernetesAgentRunnerRow({
          name: seed.name,
          hostInfo: seed.hostInfo as never,
        });
      },
    );

    expect(answers).toContain(true);
    expect(answers).toContain(false);
  });

  test("no Runner's switch changed", async () => {
    expect(
      await database.query(
        `SELECT "_id", "canRunAiCommands" FROM "${schema}"."Runner" ORDER BY "_id"`,
      ),
    ).toEqual(switchesBefore);
  });

  test("the key to the Runner is validated and the index is valid, and building them again changes nothing", async () => {
    async function read(): Promise<{
      keys: Array<{ convalidated: boolean; definition: string }>;
      indexes: Array<{ indisvalid: boolean }>;
    }> {
      return {
        keys: await database.query(
          `SELECT con.convalidated, pg_get_constraintdef(con.oid) AS definition
             FROM pg_constraint con
            WHERE con.conrelid = to_regclass($1) AND con.conname = $2`,
          [
            `"${schema}"."AutoRemediationRule"`,
            "FK_338f34b0d3cbf32aa45e778ade1",
          ],
        ),
        indexes: await database.query(
          `SELECT x.indisvalid FROM pg_index x
             JOIN pg_class c ON c.oid = x.indexrelid
            WHERE x.indrelid = to_regclass($1) AND c.relname = $2`,
          [
            `"${schema}"."AutoRemediationRule"`,
            "IDX_338f34b0d3cbf32aa45e778ade",
          ],
        ),
      };
    }

    const built: Awaited<ReturnType<typeof read>> = await read();

    expect(built.keys).toHaveLength(1);
    expect(built.keys[0]!.convalidated).toBe(true);
    expect(built.keys[0]!.definition).toContain(
      `FOREIGN KEY ("runnerId") REFERENCES`,
    );
    expect(built.keys[0]!.definition).toContain("ON DELETE SET NULL");
    expect(built.indexes).toEqual([{ indisvalid: true }]);

    // A migrate pod stopped after the build runs the migration again.
    await runInSchema(async (queryRunner: QueryRunner) => {
      await new AddAutoRemediationRuleRunnerIndexAndKey1804550000000().up(
        queryRunner,
      );
    });

    expect(await read()).toEqual(built);
  });

  test("down()'s data step hands every rule's Runner back to its Command Runners", async () => {
    // A rule made after the upgrade, that picks a Runner as every new rule can.
    await database.query(
      `UPDATE "${schema}"."AutoRemediationRule" SET "runnerId" = $1 WHERE "_id" = $2`,
      [id("untouched: on"), id("untouched: OneUptime AI")],
    );

    await runInSchema(async (queryRunner: QueryRunner) => {
      await queryRunner.query(RESTORE_COMMAND_RUNNER_ROWS);
    });

    expect(await commandRunnersOf("one: names none")).toEqual(
      sorted("one: on"),
    );
    expect(await commandRunnersOf("named: one")).toEqual(
      sorted("named: first"),
    );
    expect(await commandRunnersOf("untouched: OneUptime AI")).toEqual(
      sorted("untouched: on"),
    );
    // A rule that kept its rows keeps them, once each.
    expect(await commandRunnersOf("named: two")).toEqual(
      sorted("named: first", "named: second"),
    );
  });

  test("a deleted Runner leaves its rules picking none", async () => {
    await database.query(`DELETE FROM "${schema}"."Runner" WHERE "_id" = $1`, [
      id("one: on"),
    ]);

    expect(await runnerOf("one: names none")).toBeNull();
    expect(await runnerOf("named: one")).toBe(id("named: first"));
  });
});
