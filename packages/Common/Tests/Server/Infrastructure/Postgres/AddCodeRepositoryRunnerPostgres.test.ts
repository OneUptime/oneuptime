import {
  AddCodeRepositoryRunner1804300000000,
  CODE_REPOSITORY_RUNNER_RESTORE_SWITCH,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1804300000000-AddCodeRepositoryRunner";
import { AddCodeRepositoryRunnerIndexAndKey1804350000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1804350000000-AddCodeRepositoryRunnerIndexAndKey";
import { Service as RunnerServiceClass } from "../../../../Server/Services/RunnerService";
import ObjectID from "../../../../Types/ObjectID";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { DataSource, QueryRunner } from "typeorm";

/*
 * The AddCodeRepositoryRunner migration against a real Postgres, on real
 * rows: each project's choice of Runner for AI code fixes - the Runner it
 * had "Runs AI Code Fixes" on for - becomes the Runner of every repository
 * it has, and the switch goes; then AddCodeRepositoryRunnerIndexAndKey
 * builds the column's index and its key to "Runner" online.
 *
 * Opt in with RUN_POSTGRES_CODE_REPOSITORY_RUNNER_TESTS=true and the normal
 * database credentials; CODE_REPOSITORY_RUNNER_TEST_DATABASE_HOST / _PORT /
 * _NAME point it at a database other than the local development one. The
 * database must already be migrated: Runner and CodeRepository are cloned
 * from public into a uniquely named schema (so the source's rows are never
 * read or modified) and put back as they were before the migration - the
 * Runner with its switch, the repository without its Runner - and both
 * migrations' up() then run on seeded rows, the second outside a
 * transaction as it runs for real. The schema is dropped afterwards.
 *
 * What it pins:
 *   - a project's repositories that pick no Runner get the Runner it had the
 *     switch on for - the one alive most recently, then the oldest - and a
 *     repository that already picks one keeps it, as does a deleted one;
 *   - a Runner that never connected, a deleted one, one marked global, one
 *     with the switch off, and an in-cluster Runner the Kubernetes agent
 *     chart installed are never chosen - the last by the same rule the
 *     server reads (RunnerService.isKubernetesAgentRunnerRow), row by row;
 *   - no repository gets another project's Runner;
 *   - the switch is gone, the repository's Runner is indexed, its key to
 *     "Runner" is validated - running the online migration again changes
 *     nothing - and a deleted Runner leaves its repositories picking none;
 *   - down()'s data step gives the switch back to every Runner a repository
 *     picks, and to no other.
 */

// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_CODE_REPOSITORY_RUNNER_TESTS"] === "true"
    ? describe
    : describe.skip;

const NOW: number = Date.now();

function hoursAgo(hours: number): Date {
  return new Date(NOW - hours * 60 * 60 * 1000);
}

interface AgentSeed {
  label: string;
  name: string;
  hostInfo: unknown;
}

/*
 * Runners that could be agent rows, each alone in a project with the switch
 * on and alive. Whether the migration picks one must be what the server's
 * own rule says.
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
    label: "inCluster as a string",
    name: "string-in-cluster",
    hostInfo: { kubernetes: { inCluster: "true", clusterIdentifier: "prod" } },
  },
  {
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
  {
    label: "the prefix without its slash",
    name: "kubernetes-agent-prod",
    hostInfo: null,
  },
];

describePostgres("AddCodeRepositoryRunner against Postgres", () => {
  const schema: string = `code_repository_runner_test_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;

  const requiredColumnsByTable: Map<
    string,
    Array<{ column_name: string; udt_name: string }>
  > = new Map();

  // What the seeds are called by, mapped to the row ids they got.
  const ids: Map<string, string> = new Map();

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

  async function seedRunner(
    label: string,
    values: {
      projectId: string | null;
      canRunCodeFixTasks: boolean;
      lastAlive?: Date | null;
      createdAt?: Date;
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
        canRunCodeFixTasks: values.canRunCodeFixTasks,
        lastAlive:
          values.lastAlive === undefined ? new Date(NOW) : values.lastAlive,
        createdAt: values.createdAt || hoursAgo(24 * 30),
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

  async function seedRepository(
    label: string,
    values: {
      projectId: string;
      runnerId?: string | null;
      deletedAt?: Date;
    },
  ): Promise<void> {
    ids.set(
      label,
      await insertRow("CodeRepository", {
        projectId: values.projectId,
        ...(values.deletedAt ? { deletedAt: values.deletedAt } : {}),
      }),
    );

    // The column does not exist until up() adds it: set it afterwards.
    if (values.runnerId) {
      ids.set(`${label}:runner`, values.runnerId);
    }
  }

  async function runnerOf(label: string): Promise<string | null> {
    const rows: Array<{ runnerId: string | null }> = await database.query(
      `SELECT "runnerId" FROM "${schema}"."CodeRepository" WHERE "_id" = $1`,
      [id(label)],
    );
    expect(rows).toHaveLength(1);
    return rows[0]!.runnerId;
  }

  async function columnsOf(table: string): Promise<Array<string>> {
    const rows: Array<{ column_name: string }> = await database.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2`,
      [schema, table],
    );
    return rows.map((row: { column_name: string }): string => {
      return row.column_name;
    });
  }

  const projectA: string = ObjectID.generate().toString();
  const projectB: string = ObjectID.generate().toString();
  const projectTie: string = ObjectID.generate().toString();
  const projectDeleted: string = ObjectID.generate().toString();
  const projectGlobal: string = ObjectID.generate().toString();
  const projectOff: string = ObjectID.generate().toString();
  const projectWithout: string = ObjectID.generate().toString();
  const agentProjects: Map<string, string> = new Map();

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["CODE_REPOSITORY_RUNNER_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["CODE_REPOSITORY_RUNNER_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["CODE_REPOSITORY_RUNNER_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      schema: schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of ["Runner", "CodeRepository"]) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    /*
     * The tables as they were BEFORE the migration, whether or not the
     * source database has run it: the Runner with its switch (as down()
     * adds it back), the repository without its Runner.
     */
    await database.query(
      `ALTER TABLE "${schema}"."Runner" ADD COLUMN IF NOT EXISTS "canRunCodeFixTasks" boolean NOT NULL DEFAULT false`,
    );
    await database.query(
      `ALTER TABLE "${schema}"."CodeRepository" DROP COLUMN IF EXISTS "runnerId"`,
    );

    // Two Runners with the switch on: the one alive most recently wins.
    await seedRunner("a: alive two days ago", {
      projectId: projectA,
      canRunCodeFixTasks: true,
      lastAlive: hoursAgo(48),
      createdAt: hoursAgo(24 * 60),
    });
    await seedRunner("a: alive an hour ago", {
      projectId: projectA,
      canRunCodeFixTasks: true,
      lastAlive: hoursAgo(1),
    });
    await seedRunner("a: switch off, alive now", {
      projectId: projectA,
      canRunCodeFixTasks: false,
      lastAlive: new Date(NOW),
    });
    await seedRepository("a: picks none", { projectId: projectA });
    await seedRepository("a: picks none either", { projectId: projectA });
    await seedRepository("a: deleted", {
      projectId: projectA,
      deletedAt: hoursAgo(5),
    });
    await seedRepository("a: picks one already", {
      projectId: projectA,
      runnerId: id("a: switch off, alive now"),
    });

    // The switch on, but the Runner never connected: it took no work.
    await seedRunner("b: never connected", {
      projectId: projectB,
      canRunCodeFixTasks: true,
      lastAlive: null,
    });
    await seedRepository("b: picks none", { projectId: projectB });

    // Alive at the same moment: the oldest wins.
    await seedRunner("tie: newer", {
      projectId: projectTie,
      canRunCodeFixTasks: true,
      lastAlive: hoursAgo(2),
      createdAt: hoursAgo(24),
    });
    await seedRunner("tie: older", {
      projectId: projectTie,
      canRunCodeFixTasks: true,
      lastAlive: hoursAgo(2),
      createdAt: hoursAgo(24 * 7),
    });
    await seedRepository("tie: picks none", { projectId: projectTie });

    await seedRunner("deleted runner", {
      projectId: projectDeleted,
      canRunCodeFixTasks: true,
      deletedAt: hoursAgo(3),
    });
    await seedRepository("deleted runner: picks none", {
      projectId: projectDeleted,
    });

    await seedRunner("marked global", {
      projectId: projectGlobal,
      canRunCodeFixTasks: true,
      isGlobalRunner: true,
    });
    await seedRepository("marked global: picks none", {
      projectId: projectGlobal,
    });

    await seedRunner("switch off", {
      projectId: projectOff,
      canRunCodeFixTasks: false,
    });
    await seedRepository("switch off: picks none", { projectId: projectOff });

    // A global Runner of no project, with the switch somehow on.
    await seedRunner("no project", {
      projectId: null,
      canRunCodeFixTasks: true,
      isGlobalRunner: true,
    });

    // A project with repositories and no Runner of its own.
    await seedRepository("without: picks none", { projectId: projectWithout });

    for (const seed of AGENT_SEEDS) {
      const projectId: string = ObjectID.generate().toString();
      agentProjects.set(seed.label, projectId);

      await seedRunner(`agent: ${seed.label}`, {
        projectId,
        canRunCodeFixTasks: true,
        name: seed.name,
        hostInfo: seed.hostInfo,
      });
      await seedRepository(`agent repository: ${seed.label}`, { projectId });
    }

    // The column the picks already made are written to, as up() adds it.
    await runInSchema(async (queryRunner: QueryRunner) => {
      await new AddCodeRepositoryRunner1804300000000().up({
        ...queryRunner,
        query: async (sql: string, parameters?: Array<unknown>) => {
          const result: unknown = await queryRunner.query(sql, parameters);

          /*
           * A repository that picked a Runner before the backfill runs:
           * written right after the column exists, before the backfill.
           */
          if (sql.startsWith(`ALTER TABLE "CodeRepository" ADD "runnerId"`)) {
            await queryRunner.query(
              `UPDATE "CodeRepository" SET "runnerId" = $1 WHERE "_id" = $2`,
              [id("a: picks one already:runner"), id("a: picks one already")],
            );
          }

          return result;
        },
      } as QueryRunner);
    });

    // The index and the key, online, outside a transaction.
    await runInSchema(async (queryRunner: QueryRunner) => {
      await new AddCodeRepositoryRunnerIndexAndKey1804350000000().up(
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

  test("a project's repositories that picked none get the Runner alive most recently", async () => {
    expect(await runnerOf("a: picks none")).toBe(id("a: alive an hour ago"));
    expect(await runnerOf("a: picks none either")).toBe(
      id("a: alive an hour ago"),
    );
  });

  test("a repository that picks a Runner keeps it, and a deleted one is left alone", async () => {
    expect(await runnerOf("a: picks one already")).toBe(
      id("a: switch off, alive now"),
    );
    expect(await runnerOf("a: deleted")).toBeNull();
  });

  test("Runners alive at the same moment: the oldest", async () => {
    expect(await runnerOf("tie: picks none")).toBe(id("tie: older"));
  });

  test("a Runner that never connected, a deleted one, one marked global or one with the switch off is never chosen", async () => {
    expect(await runnerOf("b: picks none")).toBeNull();
    expect(await runnerOf("deleted runner: picks none")).toBeNull();
    expect(await runnerOf("marked global: picks none")).toBeNull();
    expect(await runnerOf("switch off: picks none")).toBeNull();
  });

  test("no repository gets another project's Runner", async () => {
    expect(await runnerOf("without: picks none")).toBeNull();
  });

  test.each(
    AGENT_SEEDS.map((seed: AgentSeed): string => {
      return seed.label;
    }),
  )(
    "%s: chosen exactly when the server would not call it an agent row",
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

      expect(await runnerOf(`agent repository: ${label}`)).toBe(
        isAgent ? null : id(`agent: ${label}`),
      );
    },
  );

  test("the agent rows include the ones the server's rule names", () => {
    // The table above is only worth something if both answers occur.
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

  test("the switch is gone, and the repository's Runner is indexed", async () => {
    expect(await columnsOf("Runner")).not.toContain("canRunCodeFixTasks");
    expect(await columnsOf("CodeRepository")).toContain("runnerId");

    const indexes: Array<{ indexdef: string }> = await database.query(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = 'CodeRepository'`,
      [schema],
    );

    expect(
      indexes.some((index: { indexdef: string }): boolean => {
        return index.indexdef.includes(`("runnerId")`);
      }),
    ).toBe(true);
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
          [`"${schema}"."CodeRepository"`, "FK_119124a9f13918c61c08e91ec96"],
        ),
        indexes: await database.query(
          `SELECT x.indisvalid FROM pg_index x
             JOIN pg_class c ON c.oid = x.indexrelid
            WHERE x.indrelid = to_regclass($1) AND c.relname = $2`,
          [`"${schema}"."CodeRepository"`, "IDX_119124a9f13918c61c08e91ec9"],
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
      await new AddCodeRepositoryRunnerIndexAndKey1804350000000().up(
        queryRunner,
      );
    });

    expect(await read()).toEqual(built);
  });

  test("down()'s data step gives the switch back to every Runner a repository picks, and no other", async () => {
    await runInSchema(async (queryRunner: QueryRunner) => {
      await queryRunner.query(
        `ALTER TABLE "Runner" ADD "canRunCodeFixTasks" boolean NOT NULL DEFAULT false`,
      );
      await queryRunner.query(CODE_REPOSITORY_RUNNER_RESTORE_SWITCH);
    });

    const rows: Array<{ _id: string; canRunCodeFixTasks: boolean }> =
      await database.query(
        `SELECT "_id", "canRunCodeFixTasks" FROM "${schema}"."Runner" WHERE "canRunCodeFixTasks" = true`,
      );

    expect(
      rows
        .map((row: { _id: string }): string => {
          return row._id;
        })
        .sort(),
    ).toEqual(
      [
        id("a: alive an hour ago"),
        id("a: switch off, alive now"),
        id("tie: older"),
        ...AGENT_SEEDS.filter((seed: AgentSeed): boolean => {
          return !RunnerServiceClass.isKubernetesAgentRunnerRow({
            name: seed.name,
            hostInfo: seed.hostInfo as never,
          });
        }).map((seed: AgentSeed): string => {
          return id(`agent: ${seed.label}`);
        }),
      ].sort(),
    );

    await database.query(
      `ALTER TABLE "${schema}"."Runner" DROP COLUMN "canRunCodeFixTasks"`,
    );
  });

  test("a deleted Runner leaves its repositories picking none", async () => {
    await database.query(`DELETE FROM "${schema}"."Runner" WHERE "_id" = $1`, [
      id("a: alive an hour ago"),
    ]);

    expect(await runnerOf("a: picks none")).toBeNull();
    expect(await runnerOf("a: picks none either")).toBeNull();
    expect(await runnerOf("a: picks one already")).toBe(
      id("a: switch off, alive now"),
    );
  });
});
