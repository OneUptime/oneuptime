import Entities from "../../../Models/DatabaseModels/Index";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorSecret from "../../../Models/DatabaseModels/MonitorSecret";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import MonitorSecretService from "../../../Server/Services/MonitorSecretService";
import MonitorSecretAccess from "../../../Types/Monitor/MonitorSecretAccess";
import ObjectID from "../../../Types/ObjectID";
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
import { DataSource, Logger } from "typeorm";

/*
 * Opt in with RUN_POSTGRES_MONITOR_SECRET_ACCESS_TESTS=true against a database
 * the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_MONITOR_SECRET_ACCESS_TESTS=true \
 *   MONITOR_SECRET_ACCESS_TEST_DATABASE_HOST=127.0.0.1 \
 *   MONITOR_SECRET_ACCESS_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/MonitorSecretAccessPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml ("Test monitor
 * secret access on migrated Postgres"), right after that job has applied every
 * registered migration to an empty database. The Common test job's Postgres is
 * not migrated, so the suite is skipped there.
 *
 * Why a real Postgres (#1467): which monitors may use a secret is decided by
 * three queries whose filters are only judged by Postgres - the access mode
 * column, and the `monitors` and `labels` many-to-many lists filtered through
 * their junction tables - plus the monitor read that brings each monitor's
 * labels. A mock answers whatever it is told; these run the production
 * MonitorSecretService against the migrated tables, write path included: a
 * mode switch has to delete junction rows, which only TypeORM's save() of a
 * relation list does.
 *
 * Everything runs in a uniquely named schema holding structure-only clones
 * (LIKE ... INCLUDING ALL: columns, defaults, indexes) of the migrated tables
 * the service reads and writes, listed in TABLES. The clones carry no foreign
 * keys, which is what lets a test plant rows the service itself would refuse
 * (another project's monitor on a secret's list, a list the mode does not
 * read) to prove they grant nothing. The DataSource's search path is that
 * schema, then public; no row is ever written outside the schema, and the
 * schema is dropped afterwards. Workflow triggers and realtime events, the
 * service's only side effects outside Postgres, are stubbed. Every statement
 * Postgres rejects fails the test, even if a caller swallowed it.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_MONITOR_SECRET_ACCESS_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "Label",
  "Monitor",
  "MonitorLabel",
  "MonitorSecret",
  "MonitorSecretMonitor",
  "MonitorSecretLabel",
];

class QueryRecorder implements Logger {
  public failures: Array<string> = [];
  public queries: Array<string> = [];

  public logQuery(query: string): void {
    this.queries.push(query);
  }

  public logQueryError(error: string | Error, query: string): void {
    this.failures.push(
      `${error instanceof Error ? error.message : error} in: ${query}`,
    );
  }

  public logQuerySlow(): void {
    return;
  }

  public logSchemaBuild(): void {
    return;
  }

  public logMigration(): void {
    return;
  }

  public log(): void {
    return;
  }
}

describePostgres("monitor secret access against a migrated Postgres", () => {
  const schema: string = `monitor_secret_access_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;

  const projectA: ObjectID = ObjectID.generate();
  const projectB: ObjectID = ObjectID.generate();

  const recorder: QueryRecorder = new QueryRecorder();
  let database: DataSource;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["MONITOR_SECRET_ACCESS_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["MONITOR_SECRET_ACCESS_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["MONITOR_SECRET_ACCESS_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      logger: recorder,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();

    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    const currentSchema: Array<{ current_schema: string }> =
      await database.query("SELECT current_schema()");
    expect(currentSchema[0]?.current_schema).toBe(schema);

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    jest
      .spyOn(MonitorSecretService, "onTriggerWorkflow")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(MonitorSecretService, "onTriggerRealtime")
      .mockResolvedValue(undefined as never);
  });

  beforeEach(async () => {
    recorder.failures = [];
    recorder.queries = [];

    await database.query(
      TABLES.map((table: string): string => {
        return `DELETE FROM "${schema}"."${table}"`;
      }).join("; "),
    );
  });

  afterEach(() => {
    // A failed statement fails the test, even if a caller swallowed it.
    expect(recorder.failures).toEqual([]);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  async function insert(
    table: string,
    row: Record<string, unknown>,
  ): Promise<void> {
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
  }

  async function seedLabel(project: ObjectID, name: string): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    await insert("Label", {
      _id: id.toString(),
      projectId: project.toString(),
      name: name,
      slug: `${name}-${id.toString()}`,
      color: "#000000",
      version: 1,
    });
    return id;
  }

  async function seedMonitor(
    project: ObjectID,
    labelIds: Array<ObjectID> = [],
  ): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    await insert("Monitor", {
      _id: id.toString(),
      projectId: project.toString(),
      name: `Monitor ${id.toString()}`,
      slug: `monitor-${id.toString()}`,
      monitorType: "API",
      currentMonitorStatusId: ObjectID.generate().toString(),
      version: 1,
    });

    for (const labelId of labelIds) {
      await labelMonitor(id, labelId);
    }

    return id;
  }

  async function labelMonitor(
    monitorId: ObjectID,
    labelId: ObjectID,
  ): Promise<void> {
    await insert("MonitorLabel", {
      monitorId: monitorId.toString(),
      labelId: labelId.toString(),
    });
  }

  // Through the production service, so the value is encrypted as in production.
  async function createSecret(data: {
    project: ObjectID;
    name: string;
    value?: string | undefined;
    monitorAccess?: MonitorSecretAccess | undefined;
    monitors?: Array<ObjectID> | undefined;
    labels?: Array<ObjectID> | undefined;
  }): Promise<ObjectID> {
    const secret: MonitorSecret = new MonitorSecret();
    secret.projectId = data.project;
    secret.name = data.name;
    secret.secretValue = data.value || `value-of-${data.name}`;

    if (data.monitorAccess) {
      secret.monitorAccess = data.monitorAccess;
    }

    if (data.monitors) {
      secret.monitors = data.monitors.map((id: ObjectID): Monitor => {
        return new Monitor(id);
      });
    }

    if (data.labels) {
      secret.labels = data.labels.map((id: ObjectID): Label => {
        return new Label(id);
      });
    }

    const created: MonitorSecret = await MonitorSecretService.create({
      data: secret,
      props: { isRoot: true },
    });

    return created.id!;
  }

  /*
   * Straight into the tables, for the rows the service would refuse or
   * normalise: another project's ids on a list, a list the mode does not
   * read, a row written before the monitorAccess column existed.
   */
  async function plantSecret(data: {
    project: ObjectID;
    name: string;
    monitorAccess?: MonitorSecretAccess | undefined;
    monitors?: Array<ObjectID> | undefined;
    labels?: Array<ObjectID> | undefined;
  }): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    const row: Record<string, unknown> = {
      _id: id.toString(),
      projectId: data.project.toString(),
      name: data.name,
      version: 1,
    };

    if (data.monitorAccess) {
      row["monitorAccess"] = data.monitorAccess;
    }

    await insert("MonitorSecret", row);

    for (const monitorId of data.monitors || []) {
      await insert("MonitorSecretMonitor", {
        monitorSecretId: id.toString(),
        monitorId: monitorId.toString(),
      });
    }

    for (const labelId of data.labels || []) {
      await insert("MonitorSecretLabel", {
        monitorSecretId: id.toString(),
        labelId: labelId.toString(),
      });
    }

    return id;
  }

  async function resolve(
    monitorIds: Array<ObjectID>,
    projectId?: ObjectID,
  ): Promise<Map<string, Array<string>>> {
    const secretsByMonitorId: Map<string, Array<MonitorSecret>> =
      await MonitorSecretService.getSecretsForMonitors({
        monitorIds: monitorIds,
        projectId: projectId,
      });

    const names: Map<string, Array<string>> = new Map();

    for (const [monitorId, secrets] of secretsByMonitorId) {
      names.set(
        monitorId,
        secrets.map((secret: MonitorSecret): string => {
          return secret.name!;
        }),
      );
    }

    return names;
  }

  async function storedLists(secretId: ObjectID): Promise<{
    monitorAccess: string;
    monitorIds: Array<string>;
    labelIds: Array<string>;
  }> {
    const secret: Array<{ monitorAccess: string }> = await database.query(
      `SELECT "monitorAccess" FROM "${schema}"."MonitorSecret" WHERE "_id" = $1`,
      [secretId.toString()],
    );
    const monitors: Array<{ monitorId: string }> = await database.query(
      `SELECT "monitorId" FROM "${schema}"."MonitorSecretMonitor" WHERE "monitorSecretId" = $1 ORDER BY "monitorId"`,
      [secretId.toString()],
    );
    const labels: Array<{ labelId: string }> = await database.query(
      `SELECT "labelId" FROM "${schema}"."MonitorSecretLabel" WHERE "monitorSecretId" = $1 ORDER BY "labelId"`,
      [secretId.toString()],
    );

    return {
      monitorAccess: secret[0]!.monitorAccess,
      monitorIds: monitors.map((row: { monitorId: string }): string => {
        return row.monitorId;
      }),
      labelIds: labels.map((row: { labelId: string }): string => {
        return row.labelId;
      }),
    };
  }

  function sorted(ids: Array<ObjectID>): Array<string> {
    return ids
      .map((id: ObjectID): string => {
        return id.toString();
      })
      .sort();
  }

  describe("reading", () => {
    test("a secret written before the column existed is Specific Monitors, and reaches only its monitors", async () => {
      const listed: ObjectID = await seedMonitor(projectA);
      const other: ObjectID = await seedMonitor(projectA);
      const legacy: ObjectID = await plantSecret({
        project: projectA,
        name: "legacy",
        monitors: [listed],
      });

      expect((await storedLists(legacy)).monitorAccess).toBe(
        MonitorSecretAccess.SpecificMonitors,
      );

      const result: Map<string, Array<string>> = await resolve([
        listed,
        other,
      ]);

      expect(result.get(listed.toString())).toEqual(["legacy"]);
      expect(result.has(other.toString())).toBe(false);
    });

    test("resolves every mode for a batch spanning two projects, and hands back the decrypted value", async () => {
      const prod: ObjectID = await seedLabel(projectA, "prod");
      const edge: ObjectID = await seedLabel(projectA, "edge");
      const prodB: ObjectID = await seedLabel(projectB, "prod");

      const a1: ObjectID = await seedMonitor(projectA, [prod]);
      const a2: ObjectID = await seedMonitor(projectA);
      const a3: ObjectID = await seedMonitor(projectA, [edge]);
      const b1: ObjectID = await seedMonitor(projectB, [prodB]);

      await createSecret({
        project: projectA,
        name: "allA",
        value: "every-monitor-in-a",
        monitorAccess: MonitorSecretAccess.AllMonitors,
      });
      await createSecret({
        project: projectA,
        name: "listedA2",
        monitorAccess: MonitorSecretAccess.SpecificMonitors,
        monitors: [a2],
      });
      await createSecret({
        project: projectA,
        name: "prodOrEdgeA",
        monitorAccess: MonitorSecretAccess.MonitorsWithLabels,
        labels: [prod, edge],
      });
      await createSecret({
        project: projectB,
        name: "prodB",
        monitorAccess: MonitorSecretAccess.MonitorsWithLabels,
        labels: [prodB],
      });

      expect(await resolve([a1, a2, a3, b1])).toEqual(
        new Map([
          [a1.toString(), ["allA", "prodOrEdgeA"]],
          [a2.toString(), ["allA", "listedA2"]],
          [a3.toString(), ["allA", "prodOrEdgeA"]],
          [b1.toString(), ["prodB"]],
        ]),
      );

      const secrets: Map<string, Array<MonitorSecret>> =
        await MonitorSecretService.getSecretsForMonitors({
          monitorIds: [a2],
        });
      const allA: MonitorSecret | undefined = secrets
        .get(a2.toString())!
        .find((secret: MonitorSecret): boolean => {
          return secret.name === "allA";
        });

      expect(allA?.secretValue).toBe("every-monitor-in-a");

      // Stored encrypted, not as the value itself.
      const stored: Array<{ secretValue: string }> = await database.query(
        `SELECT "secretValue" FROM "${schema}"."MonitorSecret" WHERE "name" = 'allA'`,
      );
      expect(stored[0]!.secretValue).not.toBe("every-monitor-in-a");
    });

    test("a secret listing many monitors is found for each one in the batch, and only those", async () => {
      const monitors: Array<ObjectID> = [];

      for (let i: number = 0; i < 12; i++) {
        monitors.push(await seedMonitor(projectA));
      }

      const unlisted: ObjectID = await seedMonitor(projectA);

      await createSecret({
        project: projectA,
        name: "wide",
        monitorAccess: MonitorSecretAccess.SpecificMonitors,
        monitors: monitors,
      });

      const batch: Array<ObjectID> = [monitors[3]!, monitors[9]!, unlisted];
      const result: Map<string, Array<string>> = await resolve(batch);

      expect(result.get(monitors[3]!.toString())).toEqual(["wide"]);
      expect(result.get(monitors[9]!.toString())).toEqual(["wide"]);
      expect(result.has(unlisted.toString())).toBe(false);
    });

    test("a secret never reaches another project's monitor, whatever its junction rows say", async () => {
      const prod: ObjectID = await seedLabel(projectA, "prod");
      const a1: ObjectID = await seedMonitor(projectA, [prod]);

      await plantSecret({
        project: projectB,
        name: "listsAForeignMonitor",
        monitorAccess: MonitorSecretAccess.SpecificMonitors,
        monitors: [a1],
      });
      await plantSecret({
        project: projectB,
        name: "namesAForeignLabel",
        monitorAccess: MonitorSecretAccess.MonitorsWithLabels,
        labels: [prod],
      });
      await plantSecret({
        project: projectB,
        name: "allB",
        monitorAccess: MonitorSecretAccess.AllMonitors,
      });

      expect((await resolve([a1])).size).toBe(0);
    });

    test("a list the mode does not read grants nothing", async () => {
      const prod: ObjectID = await seedLabel(projectA, "prod");
      const labelled: ObjectID = await seedMonitor(projectA, [prod]);
      const listed: ObjectID = await seedMonitor(projectA);

      await plantSecret({
        project: projectA,
        name: "labelModeWithAMonitorList",
        monitorAccess: MonitorSecretAccess.MonitorsWithLabels,
        labels: [await seedLabel(projectA, "nobody-has-this")],
        monitors: [listed],
      });
      await plantSecret({
        project: projectA,
        name: "listModeWithALabelList",
        monitorAccess: MonitorSecretAccess.SpecificMonitors,
        labels: [prod],
      });

      expect((await resolve([labelled, listed])).size).toBe(0);
    });

    test("a label added to a monitor gives it the secret on the next read, and taking it away takes the secret", async () => {
      const prod: ObjectID = await seedLabel(projectA, "prod");
      const monitor: ObjectID = await seedMonitor(projectA);

      await createSecret({
        project: projectA,
        name: "prodOnly",
        monitorAccess: MonitorSecretAccess.MonitorsWithLabels,
        labels: [prod],
      });

      expect((await resolve([monitor])).size).toBe(0);

      await labelMonitor(monitor, prod);
      expect((await resolve([monitor])).get(monitor.toString())).toEqual([
        "prodOnly",
      ]);

      await database.query(
        `DELETE FROM "${schema}"."MonitorLabel" WHERE "monitorId" = $1`,
        [monitor.toString()],
      );
      expect((await resolve([monitor])).size).toBe(0);
    });

    test("a monitor created after an All Monitors secret gets it too", async () => {
      await createSecret({
        project: projectA,
        name: "shared",
        monitorAccess: MonitorSecretAccess.AllMonitors,
      });

      const later: ObjectID = await seedMonitor(projectA);

      expect((await resolve([later])).get(later.toString())).toEqual([
        "shared",
      ]);
    });

    test("with a project, a monitor of another project is not resolved at all (monitor tests)", async () => {
      const b1: ObjectID = await seedMonitor(projectB);

      await createSecret({
        project: projectB,
        name: "allB",
        monitorAccess: MonitorSecretAccess.AllMonitors,
      });

      expect((await resolve([b1], projectA)).size).toBe(0);
      expect((await resolve([b1], projectB)).get(b1.toString())).toEqual([
        "allB",
      ]);
    });

    test("a monitor that is not saved yet gets its project's All Monitors secrets and nothing else", async () => {
      const prod: ObjectID = await seedLabel(projectA, "prod");
      const listed: ObjectID = await seedMonitor(projectA, [prod]);

      await createSecret({
        project: projectA,
        name: "allA",
        monitorAccess: MonitorSecretAccess.AllMonitors,
      });
      await createSecret({
        project: projectA,
        name: "listed",
        monitors: [listed],
      });
      await createSecret({
        project: projectA,
        name: "labelled",
        monitorAccess: MonitorSecretAccess.MonitorsWithLabels,
        labels: [prod],
      });
      await createSecret({
        project: projectB,
        name: "allB",
        monitorAccess: MonitorSecretAccess.AllMonitors,
      });

      const secrets: Array<MonitorSecret> =
        await MonitorSecretService.getSecretsForUnsavedMonitor({
          projectId: projectA,
        });

      expect(
        secrets.map((secret: MonitorSecret): string => {
          return secret.name!;
        }),
      ).toEqual(["allA"]);
    });

    test("the number of statements does not grow with the batch", async () => {
      const prod: ObjectID = await seedLabel(projectA, "prod");
      const prodB: ObjectID = await seedLabel(projectB, "prod");

      await createSecret({
        project: projectA,
        name: "allA",
        monitorAccess: MonitorSecretAccess.AllMonitors,
      });

      const one: Array<ObjectID> = [await seedMonitor(projectA, [prod])];
      const many: Array<ObjectID> = [];

      for (let i: number = 0; i < 40; i++) {
        many.push(
          await seedMonitor(
            i % 2 === 0 ? projectA : projectB,
            [i % 2 === 0 ? prod : prodB],
          ),
        );
      }

      recorder.queries = [];
      await resolve(one);
      const statementsForOne: number = recorder.queries.length;

      recorder.queries = [];
      await resolve(many);
      const statementsForMany: number = recorder.queries.length;

      expect(statementsForOne).toBeGreaterThan(0);
      expect(statementsForMany).toBe(statementsForOne);
    });
  });

  describe("writing", () => {
    test("a new label-scoped secret stores its labels and no monitors, whatever was sent", async () => {
      const prod: ObjectID = await seedLabel(projectA, "prod");
      const monitor: ObjectID = await seedMonitor(projectA);

      const id: ObjectID = await createSecret({
        project: projectA,
        name: "labelled",
        monitorAccess: MonitorSecretAccess.MonitorsWithLabels,
        labels: [prod],
        monitors: [monitor],
      });

      expect(await storedLists(id)).toEqual({
        monitorAccess: MonitorSecretAccess.MonitorsWithLabels,
        monitorIds: [],
        labelIds: [prod.toString()],
      });
    });

    test("a new secret without a mode is Specific Monitors and stores no labels", async () => {
      const prod: ObjectID = await seedLabel(projectA, "prod");
      const monitor: ObjectID = await seedMonitor(projectA);

      const id: ObjectID = await createSecret({
        project: projectA,
        name: "noMode",
        monitors: [monitor],
        labels: [prod],
      });

      expect(await storedLists(id)).toEqual({
        monitorAccess: MonitorSecretAccess.SpecificMonitors,
        monitorIds: [monitor.toString()],
        labelIds: [],
      });
    });

    test("switching to All Monitors deletes both lists' rows", async () => {
      const m1: ObjectID = await seedMonitor(projectA);
      const m2: ObjectID = await seedMonitor(projectA);
      const prod: ObjectID = await seedLabel(projectA, "prod");

      const id: ObjectID = await plantSecret({
        project: projectA,
        name: "toAll",
        monitorAccess: MonitorSecretAccess.SpecificMonitors,
        monitors: [m1, m2],
        labels: [prod],
      });

      await MonitorSecretService.updateOneById({
        id: id,
        data: {
          monitorAccess: MonitorSecretAccess.AllMonitors,
        },
        props: { isRoot: true },
      });

      expect(await storedLists(id)).toEqual({
        monitorAccess: MonitorSecretAccess.AllMonitors,
        monitorIds: [],
        labelIds: [],
      });
    });

    test("switching to Monitors With Labels replaces the list and deletes the monitors", async () => {
      const m1: ObjectID = await seedMonitor(projectA);
      const prod: ObjectID = await seedLabel(projectA, "prod");
      const edge: ObjectID = await seedLabel(projectA, "edge");

      const id: ObjectID = await createSecret({
        project: projectA,
        name: "toLabels",
        monitors: [m1],
      });

      await MonitorSecretService.updateOneById({
        id: id,
        data: {
          monitorAccess: MonitorSecretAccess.MonitorsWithLabels,
          labels: [prod, edge].map((labelId: ObjectID): Label => {
            return new Label(labelId);
          }),
          monitors: [new Monitor(m1)],
        },
        props: { isRoot: true },
      });

      expect(await storedLists(id)).toEqual({
        monitorAccess: MonitorSecretAccess.MonitorsWithLabels,
        monitorIds: [],
        labelIds: sorted([prod, edge]),
      });
    });

    test("switching back to Specific Monitors starts from the monitors sent, not from an old list", async () => {
      const m1: ObjectID = await seedMonitor(projectA);
      const m2: ObjectID = await seedMonitor(projectA);
      const prod: ObjectID = await seedLabel(projectA, "prod");

      const id: ObjectID = await createSecret({
        project: projectA,
        name: "roundTrip",
        monitors: [m1],
      });

      await MonitorSecretService.updateOneById({
        id: id,
        data: {
          monitorAccess: MonitorSecretAccess.MonitorsWithLabels,
          labels: [new Label(prod)],
        },
        props: { isRoot: true },
      });

      await MonitorSecretService.updateOneById({
        id: id,
        data: {
          monitorAccess: MonitorSecretAccess.SpecificMonitors,
          monitors: [new Monitor(m2)],
        },
        props: { isRoot: true },
      });

      expect(await storedLists(id)).toEqual({
        monitorAccess: MonitorSecretAccess.SpecificMonitors,
        monitorIds: [m2.toString()],
        labelIds: [],
      });
      expect((await resolve([m1, m2])).has(m1.toString())).toBe(false);
    });

    test("an update that does not set the mode leaves the lists alone", async () => {
      const m1: ObjectID = await seedMonitor(projectA);

      const id: ObjectID = await createSecret({
        project: projectA,
        name: "rename",
        monitors: [m1],
      });

      await MonitorSecretService.updateOneById({
        id: id,
        data: {
          name: "renamed",
          secretValue: "rotated",
        },
        props: { isRoot: true },
      });

      expect(await storedLists(id)).toEqual({
        monitorAccess: MonitorSecretAccess.SpecificMonitors,
        monitorIds: [m1.toString()],
        labelIds: [],
      });

      const secrets: Map<string, Array<MonitorSecret>> =
        await MonitorSecretService.getSecretsForMonitors({
          monitorIds: [m1],
        });
      expect(secrets.get(m1.toString())![0]!.secretValue).toBe("rotated");
    });

    test("refuses another project's label and writes nothing", async () => {
      const prodB: ObjectID = await seedLabel(projectB, "prod");

      await expect(
        createSecret({
          project: projectA,
          name: "foreign",
          monitorAccess: MonitorSecretAccess.MonitorsWithLabels,
          labels: [prodB],
        }),
      ).rejects.toThrow(/belong to a different project/);

      const rows: Array<{ count: string }> = await database.query(
        `SELECT count(*)::text AS "count" FROM "${schema}"."MonitorSecret"`,
      );
      expect(rows[0]!.count).toBe("0");
    });

    test("refuses another project's monitor on an update and keeps what was there", async () => {
      const a1: ObjectID = await seedMonitor(projectA);
      const b1: ObjectID = await seedMonitor(projectB);

      const id: ObjectID = await createSecret({
        project: projectA,
        name: "keep",
        monitors: [a1],
      });

      await expect(
        MonitorSecretService.updateOneById({
          id: id,
          data: {
            monitors: [new Monitor(a1), new Monitor(b1)],
          },
          props: { isRoot: true },
        }),
      ).rejects.toThrow(/belong to a different project/);

      expect((await storedLists(id)).monitorIds).toEqual([a1.toString()]);
    });

    test("refuses a mode that is not one of the three", async () => {
      await expect(
        createSecret({
          project: projectA,
          name: "bogus",
          monitorAccess: "Everyone" as MonitorSecretAccess,
        }),
      ).rejects.toThrow(/Monitor access must be one of/);
    });
  });
});
