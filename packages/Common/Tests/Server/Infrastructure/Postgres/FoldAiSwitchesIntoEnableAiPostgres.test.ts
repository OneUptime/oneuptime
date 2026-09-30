import {
  FoldAiSwitchesIntoEnableAi1796600000000,
  IS_KUBERNETES_AGENT_RUNNER_SQL,
  TABLES_WITH_AI_REMEDIATION_MODE,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1796600000000-FoldAiSwitchesIntoEnableAi";
import { Service as RunnerServiceClass } from "../../../../Server/Services/RunnerService";
import ObjectID from "../../../../Types/ObjectID";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { DataSource, QueryRunner } from "typeorm";

/*
 * The FoldAiSwitchesIntoEnableAi migration against a real Postgres, on real
 * rows: every rule, cluster and resource the two dropped switches were
 * holding back ends up asking first, and nothing else moves.
 *
 * Opt in with RUN_POSTGRES_ENABLE_AI_SWITCH_TESTS=true and the normal
 * database credentials; ENABLE_AI_SWITCH_TEST_DATABASE_HOST / _PORT / _NAME
 * point it at a database other than the local development one. The
 * database must already be migrated: the tables are cloned from public into
 * a uniquely named schema (so the source's rows are never read or
 * modified), the migration's own down() puts the two columns back there,
 * and up() then runs on seeded rows. The schema is dropped afterwards.
 */

const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_ENABLE_AI_SWITCH_TESTS"] === "true"
    ? describe
    : describe.skip;

const CLONED_TABLES: Array<string> = [
  "Project",
  "AutoRemediationRule",
  "Runner",
  ...TABLES_WITH_AI_REMEDIATION_MODE,
];

const RESOURCE_TABLES: Array<string> = TABLES_WITH_AI_REMEDIATION_MODE.filter(
  (table: string): boolean => {
    return table !== "KubernetesCluster";
  },
);

const REMEDIATION_MODES: Array<string> = [
  "Disabled",
  "RequireApproval",
  "Automatic",
  "BypassApproval",
];

interface ProjectSwitches {
  enableAi: boolean;
  enableAutoRemediation: boolean;
  enableAiCommandExecution: boolean;
}

interface RuleSeed {
  executionMode: "Suggest" | "FullAuto";
  aiComposesCommands: boolean;
  aiSelectsRunbook: boolean;
  isEnabled: boolean;
}

interface RuleRow {
  _id: string;
  executionMode: string;
  aiComposesCommands: boolean;
  aiSelectsRunbook: boolean;
  isEnabled: boolean;
}

interface RunnerSeed {
  label: string;
  name: string | null;
  hostInfo: unknown;
}

// Every kind of rule, in both modes.
const RULE_SEEDS: Array<RuleSeed> = [
  {
    executionMode: "FullAuto",
    aiComposesCommands: false,
    aiSelectsRunbook: false,
    isEnabled: true,
  },
  {
    executionMode: "Suggest",
    aiComposesCommands: false,
    aiSelectsRunbook: false,
    isEnabled: true,
  },
  {
    executionMode: "FullAuto",
    aiComposesCommands: true,
    aiSelectsRunbook: false,
    isEnabled: true,
  },
  {
    executionMode: "Suggest",
    aiComposesCommands: true,
    aiSelectsRunbook: false,
    isEnabled: true,
  },
  {
    executionMode: "FullAuto",
    aiComposesCommands: false,
    aiSelectsRunbook: true,
    isEnabled: true,
  },
  {
    executionMode: "FullAuto",
    aiComposesCommands: true,
    aiSelectsRunbook: false,
    isEnabled: false,
  },
];

/*
 * Runners a cluster can be bound to. `isAgent` is what the server's own rule
 * (RunnerService.isKubernetesAgentRunnerRow) says, checked below against the
 * migration's SQL on the same rows.
 */
const RUNNER_SEEDS: Array<RunnerSeed> = [
  { label: "advanced", name: "prod-bastion", hostInfo: null },
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
    label: "inCluster as a string",
    name: "string-in-cluster",
    hostInfo: { kubernetes: { inCluster: "true", clusterIdentifier: "prod" } },
  },
  {
    // No inCluster flag at all: a NULL comparison in SQL, "not in cluster" to the server.
    label: "posture without inCluster",
    name: "posture-without-flag",
    hostInfo: { kubernetes: { clusterIdentifier: "prod" } },
  },
  {
    label: "posture that is not an object",
    name: "odd-posture",
    hostInfo: { kubernetes: "in-cluster" },
  },
  {
    label: "hostInfo without kubernetes",
    name: "plain-host",
    hostInfo: { os: "linux" },
  },
  { label: "no name at all", name: null, hostInfo: null },
  {
    label: "the prefix without its slash",
    name: "kubernetes-agent-prod",
    hostInfo: null,
  },
];

describePostgres("FoldAiSwitchesIntoEnableAi against Postgres", () => {
  const schema: string = `enable_ai_switch_test_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
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
   * was not given (a name, a slug, a version, ...) with a unique value of its
   * type, so the seeds below only say what the test is about.
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

  async function seedProject(switches: ProjectSwitches): Promise<string> {
    return insertRow("Project", { ...switches });
  }

  async function seedRules(projectId: string): Promise<Array<string>> {
    const ids: Array<string> = [];

    for (const seed of RULE_SEEDS) {
      ids.push(
        await insertRow("AutoRemediationRule", {
          projectId,
          triggerEntityType: "Incident",
          ...seed,
        }),
      );
    }

    return ids;
  }

  async function seedRunner(
    projectId: string,
    seed: RunnerSeed,
  ): Promise<string> {
    return insertRow("Runner", {
      projectId,
      name: seed.name === null ? `unnamed-${ObjectID.generate()}` : seed.name,
      hostInfo: seed.hostInfo === null ? null : JSON.stringify(seed.hostInfo),
    });
  }

  async function seedCluster(
    projectId: string,
    aiRemediationMode: string,
    aiAccessRunnerId: string | null,
  ): Promise<string> {
    return insertRow("KubernetesCluster", {
      projectId,
      aiRemediationMode,
      aiAccessRunnerId,
    });
  }

  async function seedResource(
    table: string,
    projectId: string,
    aiRemediationMode: string,
  ): Promise<string> {
    return insertRow(table, { projectId, aiRemediationMode });
  }

  async function modeOf(table: string, id: string): Promise<string> {
    const rows: Array<{ aiRemediationMode: string }> = await database.query(
      `SELECT "aiRemediationMode" FROM "${schema}"."${table}" WHERE "_id" = $1`,
      [id],
    );
    expect(rows).toHaveLength(1);
    return rows[0]!.aiRemediationMode;
  }

  async function ruleOf(id: string): Promise<RuleRow> {
    const rows: Array<RuleRow> = await database.query(
      `SELECT "_id", "executionMode", "aiComposesCommands", "aiSelectsRunbook", "isEnabled"
       FROM "${schema}"."AutoRemediationRule" WHERE "_id" = $1`,
      [id],
    );
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  async function projectColumns(): Promise<
    Array<{ column_name: string; data_type: string; column_default: string }>
  > {
    return database.query(
      `SELECT column_name, data_type, column_default FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'Project'
         AND column_name IN ('enableAi', 'enableAutoRemediation', 'enableAiCommandExecution')
       ORDER BY column_name`,
      [schema],
    );
  }

  // Seeded before up(), read after it.
  interface ProjectFixture {
    projectId: string;
    ruleIds: Array<string>;
    // Cluster id per runner label (plus "unbound" and "dangling"), per mode.
    clusterIds: Map<string, Map<string, string>>;
    // Resource id per table, per mode.
    resourceIds: Map<string, Map<string, string>>;
  }

  const fixtures: Map<string, ProjectFixture> = new Map();
  let columnsAfterDown: Array<{
    column_name: string;
    data_type: string;
    column_default: string;
  }> = [];
  let columnsAfterUp: Array<{
    column_name: string;
    data_type: string;
    column_default: string;
  }> = [];

  async function seedProjectFixture(
    label: string,
    switches: ProjectSwitches,
  ): Promise<void> {
    const projectId: string = await seedProject(switches);
    const ruleIds: Array<string> = await seedRules(projectId);

    const clusterIds: Map<string, Map<string, string>> = new Map();

    for (const runnerSeed of RUNNER_SEEDS) {
      const runnerId: string = await seedRunner(projectId, runnerSeed);
      const byMode: Map<string, string> = new Map();

      for (const mode of REMEDIATION_MODES) {
        byMode.set(mode, await seedCluster(projectId, mode, runnerId));
      }

      clusterIds.set(runnerSeed.label, byMode);
    }

    for (const [clusterLabel, runnerId] of [
      ["unbound", null],
      // Bound to a Runner row that no longer exists.
      ["dangling", ObjectID.generate().toString()],
    ] as Array<[string, string | null]>) {
      const byMode: Map<string, string> = new Map();

      for (const mode of REMEDIATION_MODES) {
        byMode.set(mode, await seedCluster(projectId, mode, runnerId));
      }

      clusterIds.set(clusterLabel, byMode);
    }

    const resourceIds: Map<string, Map<string, string>> = new Map();

    for (const table of RESOURCE_TABLES) {
      const byMode: Map<string, string> = new Map();

      for (const mode of REMEDIATION_MODES) {
        byMode.set(mode, await seedResource(table, projectId, mode));
      }

      resourceIds.set(table, byMode);
    }

    fixtures.set(label, { projectId, ruleIds, clusterIds, resourceIds });
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["ENABLE_AI_SWITCH_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["ENABLE_AI_SWITCH_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["ENABLE_AI_SWITCH_TEST_DATABASE_NAME"] ||
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
     * Start from the table as it was BEFORE the migration, whether or not
     * the source database has run it: without the two columns, which the
     * migration's own down() then adds back.
     */
    await database.query(
      `ALTER TABLE "${schema}"."Project" DROP COLUMN IF EXISTS "enableAutoRemediation"`,
    );
    await database.query(
      `ALTER TABLE "${schema}"."Project" DROP COLUMN IF EXISTS "enableAiCommandExecution"`,
    );

    await runInSchema(async (queryRunner: QueryRunner) => {
      await new FoldAiSwitchesIntoEnableAi1796600000000().down(queryRunner);
    });

    columnsAfterDown = await projectColumns();

    // Fully opted in: none of the data steps may touch it.
    await seedProjectFixture("opted in", {
      enableAi: true,
      enableAutoRemediation: true,
      enableAiCommandExecution: true,
    });

    // Auto-remediation off (it had opted into commands): step 1.
    await seedProjectFixture("auto-remediation off", {
      enableAi: true,
      enableAutoRemediation: false,
      enableAiCommandExecution: true,
    });

    // The default: never opted into AI command execution. Step 2.
    await seedProjectFixture("never opted in", {
      enableAi: true,
      enableAutoRemediation: true,
      enableAiCommandExecution: false,
    });

    // Both, and AI itself off: steps 1 and 2 (enableAi is never read).
    await seedProjectFixture("everything off", {
      enableAi: false,
      enableAutoRemediation: false,
      enableAiCommandExecution: false,
    });

    await runInSchema(async (queryRunner: QueryRunner) => {
      await new FoldAiSwitchesIntoEnableAi1796600000000().up(queryRunner);
    });

    columnsAfterUp = await projectColumns();
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  function fixture(label: string): ProjectFixture {
    const found: ProjectFixture | undefined = fixtures.get(label);
    expect(found).toBeDefined();
    return found!;
  }

  function clusterId(
    projectLabel: string,
    clusterLabel: string,
    mode: string,
  ): string {
    return fixture(projectLabel).clusterIds.get(clusterLabel)!.get(mode)!;
  }

  function isAgentRunner(label: string): boolean {
    const seed: RunnerSeed | undefined = RUNNER_SEEDS.find(
      (candidate: RunnerSeed): boolean => {
        return candidate.label === label;
      },
    );

    return RunnerServiceClass.isKubernetesAgentRunnerRow({
      name: seed!.name,
      hostInfo: seed!.hostInfo,
    });
  }

  describe("the schema", () => {
    test("down() put both columns back with their old types and defaults", () => {
      expect(columnsAfterDown).toEqual([
        {
          column_name: "enableAi",
          data_type: "boolean",
          column_default: "true",
        },
        {
          column_name: "enableAiCommandExecution",
          data_type: "boolean",
          column_default: "false",
        },
        {
          column_name: "enableAutoRemediation",
          data_type: "boolean",
          column_default: "true",
        },
      ]);
    });

    test("up() dropped both, and kept Enable AI", () => {
      expect(columnsAfterUp).toEqual([
        {
          column_name: "enableAi",
          data_type: "boolean",
          column_default: "true",
        },
      ]);
    });

    test("every project's Enable AI is what it was", async () => {
      const rows: Array<{ _id: string; enableAi: boolean }> =
        await database.query(
          `SELECT "_id", "enableAi" FROM "${schema}"."Project"`,
        );

      const byId: Map<string, boolean> = new Map(
        rows.map((row: { _id: string; enableAi: boolean }) => {
          return [row._id, row.enableAi];
        }),
      );

      expect(byId.get(fixture("opted in").projectId)).toBe(true);
      expect(byId.get(fixture("auto-remediation off").projectId)).toBe(true);
      expect(byId.get(fixture("never opted in").projectId)).toBe(true);
      expect(byId.get(fixture("everything off").projectId)).toBe(false);
    });
  });

  describe("rules", () => {
    async function modesAfter(label: string): Promise<Array<string>> {
      const modes: Array<string> = [];

      for (const id of fixture(label).ruleIds) {
        modes.push((await ruleOf(id)).executionMode);
      }

      return modes;
    }

    test("a project that had opted into everything keeps every rule as it was", async () => {
      expect(await modesAfter("opted in")).toEqual(
        RULE_SEEDS.map((seed: RuleSeed): string => {
          return seed.executionMode;
        }),
      );
    });

    test("auto-remediation off: every Full Auto rule, of every kind, asks first", async () => {
      expect(await modesAfter("auto-remediation off")).toEqual(
        RULE_SEEDS.map((): string => {
          return "Suggest";
        }),
      );
    });

    test("never opted in: only the Full Auto rules that compose commands ask first", async () => {
      expect(await modesAfter("never opted in")).toEqual(
        RULE_SEEDS.map((seed: RuleSeed): string => {
          return seed.aiComposesCommands ? "Suggest" : seed.executionMode;
        }),
      );
    });

    test("both off, AI off too: every Full Auto rule asks first", async () => {
      expect(await modesAfter("everything off")).toEqual(
        RULE_SEEDS.map((): string => {
          return "Suggest";
        }),
      );
    });

    test("nothing but the mode changes: no rule is disabled or loses its kind", async () => {
      for (const label of fixtures.keys()) {
        const rows: Array<RuleRow> = [];

        for (const id of fixture(label).ruleIds) {
          rows.push(await ruleOf(id));
        }

        expect(
          rows.map((row: RuleRow) => {
            return {
              aiComposesCommands: row.aiComposesCommands,
              aiSelectsRunbook: row.aiSelectsRunbook,
              isEnabled: row.isEnabled,
            };
          }),
        ).toEqual(
          RULE_SEEDS.map((seed: RuleSeed) => {
            return {
              aiComposesCommands: seed.aiComposesCommands,
              aiSelectsRunbook: seed.aiSelectsRunbook,
              isEnabled: seed.isEnabled,
            };
          }),
        );
      }
    });
  });

  describe("Kubernetes clusters", () => {
    function expectedMode(
      projectLabel: string,
      clusterLabel: string,
      mode: string,
    ): string {
      const unattended: boolean =
        mode === "Automatic" || mode === "BypassApproval";

      if (!unattended) {
        return mode;
      }

      if (
        projectLabel === "auto-remediation off" ||
        projectLabel === "everything off"
      ) {
        return "RequireApproval";
      }

      const reachedThroughBoundRunner: boolean =
        clusterLabel !== "unbound" &&
        clusterLabel !== "dangling" &&
        !isAgentRunner(clusterLabel);

      if (projectLabel === "never opted in" && reachedThroughBoundRunner) {
        return "RequireApproval";
      }

      return mode;
    }

    test.each([
      "opted in",
      "auto-remediation off",
      "never opted in",
      "everything off",
    ])(
      "%s: each cluster ends in the mode the rules above give it",
      async (projectLabel: string) => {
        const actual: Array<string> = [];
        const expected: Array<string> = [];

        for (const [clusterLabel, byMode] of fixture(
          projectLabel,
        ).clusterIds.entries()) {
          for (const [mode, id] of byMode.entries()) {
            actual.push(
              `${clusterLabel} / ${mode} -> ${await modeOf("KubernetesCluster", id)}`,
            );
            expected.push(
              `${clusterLabel} / ${mode} -> ${expectedMode(projectLabel, clusterLabel, mode)}`,
            );
          }
        }

        expect(actual).toEqual(expected);
      },
    );

    test("never opted in: an advanced Runner's unattended cluster asks first, an agent's keeps its mode", async () => {
      expect(
        await modeOf(
          "KubernetesCluster",
          clusterId("never opted in", "advanced", "Automatic"),
        ),
      ).toBe("RequireApproval");
      expect(
        await modeOf(
          "KubernetesCluster",
          clusterId("never opted in", "advanced", "BypassApproval"),
        ),
      ).toBe("RequireApproval");
      expect(
        await modeOf(
          "KubernetesCluster",
          clusterId("never opted in", "agent by name", "BypassApproval"),
        ),
      ).toBe("BypassApproval");
      expect(
        await modeOf(
          "KubernetesCluster",
          clusterId("never opted in", "agent by posture", "Automatic"),
        ),
      ).toBe("Automatic");
      expect(
        await modeOf(
          "KubernetesCluster",
          clusterId("never opted in", "unbound", "Automatic"),
        ),
      ).toBe("Automatic");
    });

    test("no cluster is ever switched off, and Ask for approval / Off are never touched", async () => {
      for (const label of fixtures.keys()) {
        for (const byMode of fixture(label).clusterIds.values()) {
          expect(
            await modeOf("KubernetesCluster", byMode.get("Disabled")!),
          ).toBe("Disabled");
          expect(
            await modeOf("KubernetesCluster", byMode.get("RequireApproval")!),
          ).toBe("RequireApproval");
        }
      }
    });
  });

  describe("resources", () => {
    test.each(RESOURCE_TABLES)(
      "%s: only auto-remediation being off made an unattended resource ask first",
      async (table: string) => {
        for (const label of fixtures.keys()) {
          const autoRemediationWasOff: boolean =
            label === "auto-remediation off" || label === "everything off";

          for (const [mode, id] of fixture(label)
            .resourceIds.get(table)!
            .entries()) {
            const unattended: boolean =
              mode === "Automatic" || mode === "BypassApproval";

            expect({ label, mode, after: await modeOf(table, id) }).toEqual({
              label,
              mode,
              after:
                unattended && autoRemediationWasOff ? "RequireApproval" : mode,
            });
          }
        }
      },
    );
  });

  describe("the kubernetes-agent Runner predicate", () => {
    test("matches RunnerService.isKubernetesAgentRunnerRow on every seeded Runner", async () => {
      const results: Array<{ label: string; sql: boolean; server: boolean }> =
        [];

      for (const seed of RUNNER_SEEDS) {
        const rows: Array<{ is_agent: boolean }> = await database.query(
          `SELECT ${IS_KUBERNETES_AGENT_RUNNER_SQL} AS is_agent
           FROM (SELECT $1::varchar AS "name", $2::jsonb AS "hostInfo") runner`,
          [
            seed.name,
            seed.hostInfo === null ? null : JSON.stringify(seed.hostInfo),
          ],
        );

        results.push({
          label: seed.label,
          sql: rows[0]!.is_agent,
          server: isAgentRunner(seed.label),
        });
      }

      expect(
        results.map(
          (result: { label: string; sql: boolean; server: boolean }) => {
            return { label: result.label, sql: result.sql };
          },
        ),
      ).toEqual(
        results.map(
          (result: { label: string; sql: boolean; server: boolean }) => {
            return { label: result.label, sql: result.server };
          },
        ),
      );
    });

    test("is never NULL, so NOT never skips a row", async () => {
      const rows: Array<{ is_agent: boolean | null }> = await database.query(
        `SELECT ${IS_KUBERNETES_AGENT_RUNNER_SQL} AS is_agent
         FROM (VALUES (NULL::varchar, NULL::jsonb), ('x', 'null'::jsonb), ('y', '{"kubernetes": null}'::jsonb), ('z', '{"kubernetes": {"inCluster": true}}'::jsonb), ('w', '{"kubernetes": {"clusterIdentifier": "prod"}}'::jsonb), ('v', '{"kubernetes": {"inCluster": null, "clusterIdentifier": "prod"}}'::jsonb)) AS runner("name", "hostInfo")`,
      );

      expect(
        rows.map((row: { is_agent: boolean | null }): boolean | null => {
          return row.is_agent;
        }),
      ).toEqual([false, false, false, false, false, false]);
    });

    test("both kinds of seed are really present: the parity above is not vacuous", () => {
      const verdicts: Array<boolean> = RUNNER_SEEDS.map(
        (seed: RunnerSeed): boolean => {
          return isAgentRunner(seed.label);
        },
      );

      expect(verdicts).toContain(true);
      expect(verdicts).toContain(false);
    });
  });

  describe("other projects", () => {
    test("every update joins on the row's own project: another project's switches never reach it", async () => {
      /*
       * Every UPDATE joins on the row's own project: the opted-in project's
       * Full Auto rules stayed Full Auto although three other projects in
       * the same table had both switches off.
       */
      const optedIn: ProjectFixture = fixture("opted in");
      const firstFullAuto: RuleRow = await ruleOf(optedIn.ruleIds[0]!);

      expect(firstFullAuto.executionMode).toBe("FullAuto");
      expect(
        await modeOf(
          "KubernetesCluster",
          clusterId("opted in", "advanced", "BypassApproval"),
        ),
      ).toBe("BypassApproval");
    });
  });
});
