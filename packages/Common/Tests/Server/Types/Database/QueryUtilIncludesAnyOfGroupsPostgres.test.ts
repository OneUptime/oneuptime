import Entities from "../../../../Models/DatabaseModels/Index";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import Query from "../../../../Server/Types/Database/Query";
import QueryUtil from "../../../../Server/Types/Database/QueryUtil";
import Includes from "../../../../Types/BaseDatabase/Includes";
import IncludesAnyOfGroups from "../../../../Types/BaseDatabase/IncludesAnyOfGroups";
import { JSONObject } from "../../../../Types/JSON";
import JSONFunctions from "../../../../Types/JSONFunctions";
import ObjectID from "../../../../Types/ObjectID";
import { DataSource, FindOptionsWhere } from "typeorm";

/*
 * Run with RUN_POSTGRES_DASHBOARD_LABEL_TESTS=true and config.env loaded.
 * All rows and cloned production tables live in a unique temporary schema.
 * Uses the local development database on port 5400 unless overridden below.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_DASHBOARD_LABEL_TESTS"] === "true"
    ? describe
    : describe.skip;

describePostgres("dashboard label groups against Postgres", () => {
  const schema: string = `dashboard_labels_${ObjectID.generate().toString().replace(/-/g, "")}`;
  const projectId: string = ObjectID.generate().toString();
  const otherProjectId: string = ObjectID.generate().toString();
  const statusId: string = ObjectID.generate().toString();
  const network: string = ObjectID.generate().toString();
  const router: string = ObjectID.generate().toString();
  const unit0660: string = ObjectID.generate().toString();
  const unit0661: string = ObjectID.generate().toString();
  const monitorIds: Record<string, string> = {};
  let database: DataSource;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["DASHBOARD_LABEL_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["DASHBOARD_LABEL_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database: process.env["DATABASE_NAME"] || "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    for (const table of ["Monitor", "Label", "MonitorLabel"]) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }
    /*
     * LIKE does not copy foreign keys. Retain the production relation's
     * cascade behavior so deleting a label exercises the real join lifecycle.
     */
    await database.query(
      `ALTER TABLE "${schema}"."MonitorLabel" ADD FOREIGN KEY ("labelId") REFERENCES "${schema}"."Label" ("_id") ON UPDATE CASCADE ON DELETE CASCADE`,
    );
    await database.query(
      `ALTER TABLE "${schema}"."MonitorLabel" ADD FOREIGN KEY ("monitorId") REFERENCES "${schema}"."Monitor" ("_id") ON UPDATE CASCADE ON DELETE CASCADE`,
    );
    expect(
      (await database.query("SELECT current_schema()"))[0].current_schema,
    ).toBe(schema);
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    for (const [id, name] of [
      [network, "network"],
      [router, "router"],
      [unit0660, "0660"],
      [unit0661, "0661"],
    ]) {
      await database.query(
        `INSERT INTO "Label" ("_id", "version", "projectId", "name", "slug", "color") VALUES ($1, 1, $2, $3, $3, '#000000')`,
        [id, projectId, name],
      );
    }
    await seedMonitor("network-0660", [network, unit0660]);
    await seedMonitor("network-0661", [network, unit0661]);
    await seedMonitor("router-0661", [router, unit0661]);
    await seedMonitor("both-units", [network, router, unit0660, unit0661]);
    await seedMonitor("network-no-unit", [network]);
    await seedMonitor("unit-only", [unit0660]);
    await seedMonitor("no-labels", []);
    await seedMonitor("other-project", [network, unit0660], otherProjectId);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  async function seedMonitor(
    name: string,
    labels: Array<string>,
    monitorProjectId: string = projectId,
  ): Promise<void> {
    const id: string = ObjectID.generate().toString();
    monitorIds[name] = id;
    await database.query(
      `INSERT INTO "Monitor" ("_id", "version", "projectId", "name", "slug", "monitorType", "currentMonitorStatusId") VALUES ($1, 1, $2, $3, $3, 'Manual', $4)`,
      [id, monitorProjectId, name, statusId],
    );
    for (const labelId of labels) {
      await database.query(
        `INSERT INTO "MonitorLabel" ("monitorId", "labelId") VALUES ($1, $2)`,
        [id, labelId],
      );
    }
  }

  async function findNames(query: Query<Monitor>): Promise<Array<string>> {
    const serialized: Query<Monitor> = QueryUtil.serializeQuery(Monitor, {
      projectId: new ObjectID(projectId),
      ...query,
    });
    const monitors: Array<Monitor> = await database
      .getRepository(Monitor)
      .find({
        select: { _id: true, name: true },
        where: serialized as unknown as FindOptionsWhere<Monitor>,
        order: { name: "ASC" },
      });
    return monitors.map((monitor: Monitor) => {
      return monitor.name!;
    });
  }

  test("requires a category label and the selected unit on the same monitor", async () => {
    expect(
      await findNames({
        labels: new IncludesAnyOfGroups([[network, router], [unit0660]]),
      }),
    ).toEqual(["both-units", "network-0660"]);
  });

  test("switching the selected unit changes the actual matching rows", async () => {
    expect(
      await findNames({
        labels: new IncludesAnyOfGroups([[network, router], [unit0661]]),
      }),
    ).toEqual(["both-units", "network-0661", "router-0661"]);
  });

  test("matches any selected unit without duplicating monitors carrying both", async () => {
    expect(
      await findNames({
        labels: new IncludesAnyOfGroups([[network], [unit0660, unit0661]]),
      }),
    ).toEqual(["both-units", "network-0660", "network-0661"]);
  });

  test("three independent conditions remain conjunctive", async () => {
    expect(
      await findNames({
        labels: new IncludesAnyOfGroups([
          [network],
          [router],
          [unit0660, unit0661],
        ]),
      }),
    ).toEqual(["both-units"]);
  });

  test("All can omit just the unit condition while retaining the fixed labels", async () => {
    expect(
      await findNames({ labels: new Includes([network, router]) }),
    ).toEqual([
      "both-units",
      "network-0660",
      "network-0661",
      "network-no-unit",
      "router-0661",
    ]);
  });

  test("empty and missing-label groups return no monitors", async () => {
    expect(
      await findNames({ labels: new IncludesAnyOfGroups([[network], []]) }),
    ).toEqual([]);
    expect(
      await findNames({
        labels: new IncludesAnyOfGroups([
          [network],
          [ObjectID.generate().toString()],
        ]),
      }),
    ).toEqual([]);
  });

  test.each(["before", "after"])(
    "retains the explicit monitor id %s labels",
    async (position: string) => {
      const id: ObjectID = new ObjectID(monitorIds["network-0660"]!);
      const labels: IncludesAnyOfGroups = new IncludesAnyOfGroups([
        [network],
        [unit0660],
      ]);
      expect(
        await findNames(
          position === "before" ? { _id: id, labels } : { labels, _id: id },
        ),
      ).toEqual(["network-0660"]);
      expect(
        await findNames({
          labels: new IncludesAnyOfGroups([[network], [unit0661]]),
          _id: id,
        }),
      ).toEqual([]);
    },
  );

  test("retains other widget filters", async () => {
    expect(
      await findNames({
        currentMonitorStatusId: new ObjectID(ObjectID.generate().toString()),
        labels: new IncludesAnyOfGroups([[network], [unit0660]]),
      }),
    ).toEqual([]);
  });

  test("API serialization keeps the same database behavior", async () => {
    const payload: JSONObject = JSON.parse(
      JSON.stringify(
        JSONFunctions.serialize({
          labels: new IncludesAnyOfGroups([[network, router], [unit0661]]),
        }),
      ),
    );
    expect(
      await findNames(JSONFunctions.deserialize(payload) as Query<Monitor>),
    ).toEqual(["both-units", "network-0661", "router-0661"]);
  });

  test("count and pagination operate on unique monitors", async () => {
    const where: FindOptionsWhere<Monitor> = QueryUtil.serializeQuery(Monitor, {
      projectId: new ObjectID(projectId),
      labels: new IncludesAnyOfGroups([
        [network, router],
        [unit0660, unit0661],
      ]),
    }) as unknown as FindOptionsWhere<Monitor>;
    const [rows, count]: [Array<Monitor>, number] = await database
      .getRepository(Monitor)
      .findAndCount({
        where,
        select: { _id: true, name: true },
        order: { name: "ASC" },
        skip: 1,
        take: 2,
      });
    expect(count).toBe(4);
    expect(
      rows.map((monitor: Monitor) => {
        return monitor.name;
      }),
    ).toEqual(["network-0660", "network-0661"]);
  });

  test("a deleted selected label produces no results while retaining the fixed condition", async () => {
    const deletedLabel: string = ObjectID.generate().toString();
    await database.query(
      `INSERT INTO "Label" ("_id", "version", "projectId", "name", "slug", "color") VALUES ($1, 1, $2, 'removed-unit', 'removed-unit', '#000000')`,
      [deletedLabel, projectId],
    );
    await seedMonitor("deleted-label-monitor", [network, deletedLabel]);
    try {
      expect(
        await findNames({
          labels: new IncludesAnyOfGroups([[network], [deletedLabel]]),
        }),
      ).toEqual(["deleted-label-monitor"]);
      await database.query(`DELETE FROM "Label" WHERE "_id" = $1`, [
        deletedLabel,
      ]);
      expect(
        await findNames({
          labels: new IncludesAnyOfGroups([[network], [deletedLabel]]),
        }),
      ).toEqual([]);
    } finally {
      await database.query(`DELETE FROM "Monitor" WHERE "_id" = $1`, [
        monitorIds["deleted-label-monitor"],
      ]);
      await database.query(`DELETE FROM "Label" WHERE "_id" = $1`, [
        deletedLabel,
      ]);
    }
  });
});
