import Entities from "../../../Models/DatabaseModels/Index";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ObjectID from "../../../Types/ObjectID";
import { DataSource } from "typeorm";

jest.mock("../../../Server/Infrastructure/Postgres/DataSourceOptions", () => {
  return {};
});

describe("sort experiment", () => {
  const schema: string = `sort_experiment_${ObjectID.generate().toString().replace(/-/g, "")}`;
  const projectId: ObjectID = ObjectID.generate();
  const service: DatabaseService<Monitor> = new DatabaseService(Monitor);
  let database: DataSource;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: "localhost",
      port: 5482,
      username: "postgres",
      password: "postgres",
      database: "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    for (const table of ["Project", "MonitorStatus", "Monitor"]) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    await database.query(
      `INSERT INTO "${schema}"."Project" ("_id", "name", "slug", "version") VALUES ($1, 'P', $2, 1)`,
      [projectId.toString(), projectId.toString()],
    );
    const statuses: Array<[string, string, number]> = [
      [ObjectID.generate().toString(), "Operational", 1],
      [ObjectID.generate().toString(), "Degraded", 2],
      [ObjectID.generate().toString(), "Offline", 3],
    ];
    for (const [id, name, priority] of statuses) {
      await database.query(
        `INSERT INTO "${schema}"."MonitorStatus" ("_id", "projectId", "name", "slug", "color", "priority", "version") VALUES ($1, $2, $3, $4, '#000000', $5, 1)`,
        [id, projectId.toString(), name, name.toLowerCase(), priority],
      );
    }
    const monitors: Array<[string, number]> = [
      ["alpha", 0],
      ["bravo", 2],
      ["charlie", 1],
      ["delta", 2],
      ["echo", 0],
    ];
    for (const [name, statusIndex] of monitors) {
      await database.query(
        `INSERT INTO "${schema}"."Monitor" ("_id", "projectId", "name", "slug", "monitorType", "currentMonitorStatusId", "version") VALUES ($1, $2, $3, $4, 'Manual', $5, 1)`,
        [
          ObjectID.generate().toString(),
          projectId.toString(),
          name,
          name,
          statuses[statusIndex]![0],
        ],
      );
    }
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  const names: (rows: Array<Monitor>) => Array<string> = (
    rows: Array<Monitor>,
  ): Array<string> => {
    return rows.map((row: Monitor) => {
      return `${row.name}:${row.currentMonitorStatus?.name}:${(row.currentMonitorStatus as any)?.priority}`;
    });
  };

  test("relation sort with the ordinal NOT selected", async () => {
    let result: string = "";
    try {
      const rows: Array<Monitor> = await service.findBy({
        query: { projectId },
        select: { _id: true, name: true, currentMonitorStatus: { name: true, color: true } },
        sort: { currentMonitorStatus: { priority: "DESC" }, name: "ASC" } as any,
        limit: 3,
        skip: 0,
        props: { isRoot: true },
      });
      result = names(rows).join(",");
    } catch (err) {
      result = "ERROR " + (err as Error).message;
    }
    // eslint-disable-next-line no-console
    console.log("NOT SELECTED:", result);
  });

  test("relation sort with the ordinal selected", async () => {
    let result: string = "";
    try {
      const rows: Array<Monitor> = await service.findBy({
        query: { projectId },
        select: { _id: true, name: true, currentMonitorStatus: { name: true, color: true, priority: true } },
        sort: { currentMonitorStatus: { priority: "DESC" }, name: "ASC" } as any,
        limit: 3,
        skip: 0,
        props: { isRoot: true },
      });
      result = names(rows).join(",");
    } catch (err) {
      result = "ERROR " + (err as Error).message;
    }
    // eslint-disable-next-line no-console
    console.log("SELECTED:", result);
  });

  test("relation sort with nulls last object", async () => {
    let result: string = "";
    try {
      const rows: Array<Monitor> = await service.findBy({
        query: { projectId },
        select: { _id: true, name: true, currentMonitorStatus: { name: true, color: true, priority: true } },
        sort: { currentMonitorStatus: { priority: { direction: "DESC", nulls: "LAST" } }, name: { direction: "ASC", nulls: "LAST" } } as any,
        limit: 3,
        skip: 0,
        props: { isRoot: true },
      });
      result = names(rows).join(",");
    } catch (err) {
      result = "ERROR " + (err as Error).message;
    }
    // eslint-disable-next-line no-console
    console.log("NULLS OBJECT:", result);
  });

  test("relation sort with no relation selected", async () => {
    let result: string = "";
    try {
      const rows: Array<Monitor> = await service.findBy({
        query: { projectId },
        select: { _id: true, name: true },
        sort: { currentMonitorStatus: { priority: "DESC" }, name: "ASC" } as any,
        limit: 3,
        skip: 0,
        props: { isRoot: true },
      });
      result = names(rows).join(",");
    } catch (err) {
      result = "ERROR " + (err as Error).message;
    }
    // eslint-disable-next-line no-console
    console.log("NO RELATION:", result);
  });

  test("relation sort by name of relation", async () => {
    let result: string = "";
    try {
      const rows: Array<Monitor> = await service.findBy({
        query: { projectId },
        select: { _id: true, name: true, currentMonitorStatus: { name: true, color: true } },
        sort: { currentMonitorStatus: { name: "ASC" } } as any,
        limit: 5,
        skip: 0,
        props: { isRoot: true },
      });
      result = names(rows).join(",");
    } catch (err) {
      result = "ERROR " + (err as Error).message;
    }
    // eslint-disable-next-line no-console
    console.log("RELATION NAME:", result);
  });
});
