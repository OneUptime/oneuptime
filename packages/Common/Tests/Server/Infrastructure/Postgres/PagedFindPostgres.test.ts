import Entities from "../../../../Models/DatabaseModels/Index";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorProbe from "../../../../Models/DatabaseModels/MonitorProbe";
import PagedFind from "../../../../Server/Infrastructure/Postgres/PagedFind";
import ObjectID from "../../../../Types/ObjectID";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import {
  DataSource,
  FindManyOptions,
  ObjectLiteral,
  Repository,
} from "typeorm";

/*
 * PagedFind's pages against TypeORM's own, on Postgres.
 *
 * PagedFind takes a page of a joined read in one query where one query gives
 * the same page (every join to-one, or a record named by its primary key);
 * TypeORM takes it in two (the page's ids, then their rows). Here both read
 * the same synthetic rows - monitors with their statuses, labels and
 * dependencies, monitor probes with their probes (some deleted), incidents
 * with their states, severities, labels and monitors - for every page of
 * many reads: by key, by project, through a relation's field, ordered by a
 * column with ties, by a related column, with deleted rows and without. Each
 * page is the same records in the same order with the same fields, the same
 * related records joined to them. (The order of a record's to-many list - a
 * monitor's labels - is the order Postgres returns the joined rows in, which
 * neither read asks for; it is compared as a set.)
 *
 * Every read selects the columns it is ordered by, as DatabaseService's do
 * (addSortColumnsToSelect): TypeORM's two queries cannot order by any other.
 *
 * Opt in with RUN_POSTGRES_PAGED_FIND_TESTS=true against a database the
 * registered migrations have run on: the table definitions are copied from
 * public into a schema of the test's own, every row is synthetic, and the
 * schema is dropped afterwards.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_PAGED_FIND_TESTS"] === "true"
    ? describe
    : describe.skip;

type Row = Record<string, unknown>;

const NOW: number = Date.UTC(2026, 9, 27, 12, 0, 0);

describePostgres("PagedFind against TypeORM's own pages, on Postgres", () => {
  const schema: string = `paged_find_${ObjectID.generate().toString().split("-").join("")}`;
  let database: DataSource;
  let sequence: number = 0;

  const projectId: string = ObjectID.generate().toString();
  const otherProjectId: string = ObjectID.generate().toString();
  const monitorIds: Array<string> = [];
  const incidentIds: Array<string> = [];

  // An id that sorts after every id made before it, for stable ties.
  function nextId(): string {
    sequence++;
    return `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;
  }

  function at(minutes: number): Date {
    return new Date(NOW + minutes * 60 * 1000);
  }

  /*
   * The columns a table needs filled that the row does not give: NOT NULL,
   * with no default, filled with a value of their type.
   */
  async function requiredFillers(table: string): Promise<Row> {
    const columns: Array<{
      column_name: string;
      data_type: string;
      udt_name: string;
      character_maximum_length: number | null;
    }> = await database.query(
      `SELECT column_name, data_type, udt_name, character_maximum_length
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       AND is_nullable = 'NO' AND column_default IS NULL`,
      [schema, table],
    );
    const fillers: Row = {};

    for (const column of columns) {
      if (column.data_type === "uuid") {
        fillers[column.column_name] = ObjectID.generate().toString();
      } else if (
        column.data_type === "character varying" ||
        column.data_type === "text"
      ) {
        sequence++;
        fillers[column.column_name] = `v${sequence}`.slice(
          0,
          column.character_maximum_length || 100,
        );
      } else if (
        column.data_type === "integer" ||
        column.data_type === "bigint" ||
        column.data_type === "numeric" ||
        column.data_type === "smallint" ||
        column.data_type === "double precision"
      ) {
        fillers[column.column_name] = 0;
      } else if (column.data_type === "boolean") {
        fillers[column.column_name] = false;
      } else if (column.data_type.startsWith("timestamp")) {
        fillers[column.column_name] = at(0);
      } else if (column.data_type === "jsonb" || column.data_type === "json") {
        fillers[column.column_name] = {};
      } else if (column.data_type === "USER-DEFINED") {
        const values: Array<{ value: string }> = await database.query(
          `SELECT unnest(enum_range(NULL::"${schema}"."${column.udt_name}"))::text AS value`,
        );
        fillers[column.column_name] = values[0]?.value;
      }
    }

    return fillers;
  }

  const fillersByTable: Map<string, Row> = new Map();

  async function insert(table: string, row: Row): Promise<string> {
    if (!fillersByTable.has(table)) {
      fillersByTable.set(table, await requiredFillers(table));
    }

    const id: string = (row["_id"] as string) || nextId();
    const values: Row = {
      ...fillersByTable.get(table),
      _id: id,
      version: 1,
      ...row,
    };
    const columns: Array<string> = Object.keys(values);

    await database.query(
      `INSERT INTO "${schema}"."${table}" (${columns
        .map((column: string) => {
          return `"${column}"`;
        })
        .join(", ")}) VALUES (${columns
        .map((_column: string, index: number) => {
          return `$${index + 1}`;
        })
        .join(", ")})`,
      columns.map((column: string) => {
        const value: unknown = values[column];
        return value && typeof value === "object" && !(value instanceof Date)
          ? JSON.stringify(value)
          : value;
      }),
    );

    return id;
  }

  async function link(
    table: string,
    left: [string, string],
    right: [string, string],
  ): Promise<void> {
    await database.query(
      `INSERT INTO "${schema}"."${table}" ("${left[0]}", "${right[0]}") VALUES ($1, $2)`,
      [left[1], right[1]],
    );
  }

  // A page, as JSON, with each to-many list in one order.
  function normalized(rows: Array<ObjectLiteral>): string {
    return JSON.stringify(rows, (_key: string, value: unknown) => {
      if (
        Array.isArray(value) &&
        value.every((item: unknown) => {
          return item !== null && typeof item === "object" && "_id" in item;
        })
      ) {
        return [...value].sort((a: Row, b: Row) => {
          return String(a["_id"]).localeCompare(String(b["_id"]));
        });
      }

      return value;
    });
  }

  async function expectSamePages<T extends ObjectLiteral>(data: {
    target: { new (): T };
    options: FindManyOptions<T>;
    pageSizes: Array<number>;
    total: number;
  }): Promise<number> {
    const repository: Repository<T> = database.getRepository(data.target);
    let compared: number = 0;

    for (const pageSize of data.pageSizes) {
      for (let skip: number = 0; skip <= data.total; skip += pageSize) {
        const options: FindManyOptions<T> = {
          ...data.options,
          skip: skip,
          take: pageSize,
        };
        const typeOrm: Array<T> = await repository.find(options);
        const paged: Array<T> = await PagedFind.find(repository, options);

        expect(normalized(paged)).toBe(normalized(typeOrm));
        compared += typeOrm.length;
      }
    }

    return compared;
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["PAGED_FIND_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["PAGED_FIND_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["PAGED_FIND_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of [
      "Project",
      "Probe",
      "MonitorStatus",
      "Monitor",
      "MonitorProbe",
      "Label",
      "MonitorLabel",
      "MonitorDependency",
      "IncidentState",
      "IncidentSeverity",
      "Incident",
      "IncidentLabel",
      "IncidentMonitor",
    ]) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    for (const id of [projectId, otherProjectId]) {
      await insert("Project", {
        _id: id,
        name: `Project ${id.slice(0, 4)}`,
        slug: id,
        isBlocked: id === otherProjectId,
      });
    }

    const probes: Array<string> = [];

    for (let index: number = 0; index < 4; index++) {
      probes.push(
        await insert("Probe", {
          name: `Probe ${index % 2}`,
          key: `key-${index}`,
          projectId: projectId,
          ...(index === 3 ? { deletedAt: at(-1) } : {}),
        }),
      );
    }

    const statuses: Array<string> = [];

    for (let index: number = 0; index < 3; index++) {
      statuses.push(
        await insert("MonitorStatus", {
          projectId: projectId,
          name: `Status ${index}`,
          slug: `status-${index}`,
          color: "#000000",
          priority: index,
          ...(index === 2 ? { deletedAt: at(-1) } : {}),
        }),
      );
    }

    const labels: Array<string> = [];

    for (let index: number = 0; index < 5; index++) {
      labels.push(
        await insert("Label", {
          projectId: projectId,
          name: `Label ${index}`,
          slug: `label-${index}`,
          color: "#000000",
          ...(index === 4 ? { deletedAt: at(-1) } : {}),
        }),
      );
    }

    // Monitors: ties in createdAt and name, some deleted, some in the other project.
    for (let index: number = 0; index < 23; index++) {
      const id: string = await insert("Monitor", {
        projectId: index % 7 === 6 ? otherProjectId : projectId,
        name: `Monitor ${index % 5}`,
        slug: `monitor-${index}`,
        monitorType: "Manual",
        createdAt: at(Math.floor(index / 3)),
        currentMonitorStatusId: statuses[index % 3],
        ...(index % 9 === 8 ? { deletedAt: at(-1) } : {}),
      });
      monitorIds.push(id);

      for (let label: number = 0; label < index % 4; label++) {
        await link(
          "MonitorLabel",
          ["monitorId", id],
          ["labelId", labels[(index + label) % labels.length]!],
        );
      }

      if (index > 0 && index % 3 === 0) {
        await link(
          "MonitorDependency",
          ["monitorId", id],
          ["dependsOnMonitorId", monitorIds[index - 1]!],
        );
      }

      for (let probe: number = 0; probe < index % 4; probe++) {
        await insert("MonitorProbe", {
          projectId: projectId,
          monitorId: id,
          probeId: probes[(index + probe) % probes.length],
          isEnabled: probe % 2 === 0,
          createdAt: at(index % 5),
          ...(index % 11 === 10 && probe === 0 ? { deletedAt: at(-1) } : {}),
        });
      }
    }

    const states: Array<string> = [];

    for (let index: number = 0; index < 3; index++) {
      states.push(
        await insert("IncidentState", {
          projectId: projectId,
          name: `State ${index}`,
          slug: `state-${index}`,
          color: "#000000",
          order: index + 1,
        }),
      );
    }

    const severities: Array<string> = [];

    for (let index: number = 0; index < 2; index++) {
      severities.push(
        await insert("IncidentSeverity", {
          projectId: projectId,
          name: `Severity ${index}`,
          slug: `severity-${index}`,
          color: "#000000",
          order: index + 1,
        }),
      );
    }

    for (let index: number = 0; index < 17; index++) {
      const id: string = await insert("Incident", {
        projectId: projectId,
        title: `Incident ${index % 4}`,
        slug: `incident-${index}`,
        createdAt: at(Math.floor(index / 2)),
        declaredAt: at(index % 6),
        currentIncidentStateId: states[index % 3],
        incidentSeverityId: severities[index % 2],
        incidentNumber: index + 1,
        ...(index % 8 === 7 ? { deletedAt: at(-1) } : {}),
      });
      incidentIds.push(id);

      for (let label: number = 0; label < index % 3; label++) {
        await link(
          "IncidentLabel",
          ["incidentId", id],
          ["labelId", labels[(index + label) % labels.length]!],
        );
      }

      for (let monitor: number = 0; monitor < index % 3; monitor++) {
        await link(
          "IncidentMonitor",
          ["incidentId", id],
          ["monitorId", monitorIds[(index + monitor) % monitorIds.length]!],
        );
      }
    }
  }, 120000);

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  test("a monitor probe's page with its probe, by monitor and for all", async () => {
    let compared: number = 0;

    for (const monitorId of monitorIds.slice(0, 12)) {
      compared += await expectSamePages({
        target: MonitorProbe,
        options: {
          where: { monitorId: monitorId } as never,
          select: {
            _id: true,
            createdAt: true,
            probeId: true,
            isEnabled: true,
            probe: { _id: true, name: true },
          } as never,
          relations: { probe: true } as never,
          order: { createdAt: "DESC", _id: "ASC" } as never,
        },
        pageSizes: [1, 2, 100],
        total: 4,
      });
    }

    compared += await expectSamePages({
      target: MonitorProbe,
      options: {
        select: {
          _id: true,
          probe: { _id: true, name: true },
          monitor: { _id: true, name: true },
        } as never,
        relations: { probe: true, monitor: true } as never,
        order: { probe: { name: "ASC" }, _id: "ASC" } as never,
      },
      pageSizes: [3, 7, 1000],
      total: 40,
    });

    expect(compared).toBeGreaterThan(60);
  });

  test("a monitor by its primary key, with everything it joins", async () => {
    let found: number = 0;

    for (const monitorId of [...monitorIds, ObjectID.generate().toString()]) {
      found += await expectSamePages({
        target: Monitor,
        options: {
          where: { _id: monitorId } as never,
          select: {
            _id: true,
            createdAt: true,
            name: true,
            projectId: true,
            labels: { _id: true, name: true },
            dependsOnMonitors: { _id: true },
            currentMonitorStatus: { _id: true, name: true },
          } as never,
          relations: {
            labels: true,
            dependsOnMonitors: true,
            currentMonitorStatus: true,
          } as never,
          order: { createdAt: "DESC", _id: "ASC" } as never,
        },
        pageSizes: [1],
        total: 0,
      });
    }

    // Every monitor not deleted, and none for an id that is no monitor's.
    expect(found).toBe(
      monitorIds.filter((_id: string, index: number) => {
        return index % 9 !== 8;
      }).length,
    );
  });

  test("monitors by project, with their status and project, ordered with ties", async () => {
    for (const order of [
      { createdAt: "DESC", _id: "ASC" },
      { name: "ASC", _id: "ASC" },
      { currentMonitorStatus: { name: "DESC" }, _id: "DESC" },
    ]) {
      await expectSamePages({
        target: Monitor,
        options: {
          where: { projectId: projectId } as never,
          select: {
            _id: true,
            createdAt: true,
            name: true,
            currentMonitorStatus: { _id: true, name: true },
            project: { _id: true, name: true },
          } as never,
          relations: { currentMonitorStatus: true, project: true } as never,
          order: order as never,
        },
        pageSizes: [1, 3, 5, 50],
        total: 23,
      });
    }
  });

  test("monitors through their project's field, and with deleted ones", async () => {
    await expectSamePages({
      target: Monitor,
      options: {
        where: { project: { isBlocked: false } } as never,
        select: { _id: true, createdAt: true, name: true } as never,
        order: { createdAt: "ASC", _id: "ASC" } as never,
      },
      pageSizes: [2, 4, 100],
      total: 23,
    });

    await expectSamePages({
      target: Monitor,
      options: {
        select: {
          _id: true,
          createdAt: true,
          name: true,
          deletedAt: true,
          currentMonitorStatus: { _id: true },
        } as never,
        relations: { currentMonitorStatus: true } as never,
        order: { createdAt: "DESC", _id: "ASC" } as never,
        withDeleted: true,
      },
      pageSizes: [3, 100],
      total: 23,
    });
  });

  test("incidents with their state and severity, and with their labels and monitors", async () => {
    await expectSamePages({
      target: Incident,
      options: {
        where: { projectId: projectId } as never,
        select: {
          _id: true,
          declaredAt: true,
          title: true,
          currentIncidentState: { _id: true, name: true, order: true },
          incidentSeverity: { _id: true, name: true },
        } as never,
        relations: {
          currentIncidentState: true,
          incidentSeverity: true,
        } as never,
        order: { declaredAt: "DESC", _id: "ASC" } as never,
      },
      pageSizes: [1, 4, 100],
      total: 17,
    });

    // To-many: TypeORM's two queries on both sides.
    await expectSamePages({
      target: Incident,
      options: {
        where: { projectId: projectId } as never,
        select: {
          _id: true,
          createdAt: true,
          title: true,
          labels: { _id: true },
          monitors: { _id: true },
        } as never,
        relations: { labels: true, monitors: true } as never,
        order: { createdAt: "DESC", _id: "ASC" } as never,
      },
      pageSizes: [2, 100],
      total: 17,
    });

    for (const incidentId of incidentIds) {
      await expectSamePages({
        target: Incident,
        options: {
          where: { _id: incidentId } as never,
          select: {
            _id: true,
            createdAt: true,
            title: true,
            labels: { _id: true, name: true },
            monitors: { _id: true },
            currentIncidentState: { _id: true },
          } as never,
          relations: {
            labels: true,
            monitors: true,
            currentIncidentState: true,
          } as never,
          order: { createdAt: "DESC", _id: "ASC" } as never,
        },
        pageSizes: [1],
        total: 0,
      });
    }
  });
});
