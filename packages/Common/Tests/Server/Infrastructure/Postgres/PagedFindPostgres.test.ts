import Entities from "../../../../Models/DatabaseModels/Index";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorProbe from "../../../../Models/DatabaseModels/MonitorProbe";
import PagedFind from "../../../../Server/Infrastructure/Postgres/PagedFind";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import ObjectID from "../../../../Types/ObjectID";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import {
  And,
  DataSource,
  Equal,
  FindManyOptions,
  In,
  ObjectLiteral,
  Raw,
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
 * A read whose to-many joins are only selected - an Incidents list's labels
 * and monitors - takes its page's ids from its table alone: those pages are
 * held to TypeORM's for every order (with ties, through a to-one relation),
 * page size, filter (through a to-one relation, a raw condition) and with
 * deleted rows and without, and the queries it sends are held to two: the
 * ids, with no DISTINCT and no to-many join, then the rows of those ids.
 * A read that filters or orders through a to-many relation keeps TypeORM's
 * two queries, and its pages are held to TypeORM's too. A read kept to some
 * labels by a condition on the record's own id instead - how a grant limited
 * to labels and a filter by labels are written (#8113) - takes its page's
 * ids from the table, gives TypeORM's pages and the records the relation's
 * filter kept, and read by its id is one query.
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
  const labelIds: Array<string> = [];

  // The SQL sent while recording (PagedFind's own reads, below).
  const recordedQueries: Array<string> = [];
  let isRecordingQueries: boolean = false;

  async function recordQueries(
    read: () => Promise<unknown>,
  ): Promise<Array<string>> {
    recordedQueries.length = 0;
    isRecordingQueries = true;

    try {
      await read();
    } finally {
      isRecordingQueries = false;
    }

    return [...recordedQueries];
  }

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
      logger: {
        logQuery: (query: string): void => {
          if (isRecordingQueries) {
            recordedQueries.push(query);
          }
        },
        logQueryError: (): void => {},
        logQuerySlow: (): void => {},
        logSchemaBuild: (): void => {},
        logMigration: (): void => {},
        log: (): void => {},
      },
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

    labelIds.push(...labels);

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

  /*
   * A filter through a to-many relation joins it, whatever the read
   * selects: a monitor with two of the labels asked for is two joined rows.
   * So these pages stay TypeORM's two queries, and are the same pages.
   */
  test("monitors filtered through their labels, with only their status selected", async () => {
    const compared: number = await expectSamePages({
      target: Monitor,
      options: {
        where: {
          projectId: projectId,
          labels: { _id: In(labelIds.slice(0, 3)) },
        } as never,
        select: {
          _id: true,
          createdAt: true,
          name: true,
          currentMonitorStatus: { _id: true, name: true },
        } as never,
        relations: { currentMonitorStatus: true } as never,
        order: { createdAt: "DESC", _id: "ASC" } as never,
      },
      pageSizes: [1, 2, 5, 100],
      total: 23,
    });

    expect(compared).toBeGreaterThan(20);
  });

  test("a monitor by its primary key, filtered through the labels it also reads, and its later pages", async () => {
    let found: number = 0;

    for (const monitorId of monitorIds) {
      found += await expectSamePages({
        target: Monitor,
        options: {
          where: {
            _id: monitorId,
            labels: { _id: In(labelIds.slice(1, 4)) },
          } as never,
          select: {
            _id: true,
            createdAt: true,
            name: true,
            labels: { _id: true, name: true },
            currentMonitorStatus: { _id: true },
          } as never,
          relations: { labels: true, currentMonitorStatus: true } as never,
          order: { createdAt: "DESC", _id: "ASC" } as never,
        },
        // The first page, and the second: empty on both sides.
        pageSizes: [1],
        total: 1,
      });
    }

    expect(found).toBeGreaterThan(5);
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

  // An Incidents list as the dashboard reads it: labels, monitors, a state.
  function incidentsList(
    overrides: Record<string, unknown>,
  ): FindManyOptions<Incident> {
    return {
      where: { projectId: projectId },
      select: {
        _id: true,
        createdAt: true,
        declaredAt: true,
        title: true,
        deletedAt: true,
        labels: { _id: true, name: true },
        monitors: { _id: true, name: true },
        currentIncidentState: { _id: true, name: true, order: true },
        incidentSeverity: { _id: true, name: true },
      },
      relations: {
        labels: true,
        monitors: true,
        currentIncidentState: true,
        incidentSeverity: true,
      },
      order: { createdAt: "DESC", _id: "ASC" },
      ...overrides,
    } as never;
  }

  async function expectSameIncidentsListPages(
    orders: Array<Record<string, unknown>>,
  ): Promise<number> {
    let compared: number = 0;

    for (const order of orders) {
      const select: Record<string, unknown> = {
        ...(incidentsList({}).select as Record<string, unknown>),
        incidentNumber: true,
      };

      compared += await expectSamePages({
        target: Incident,
        options: incidentsList({ order: order, select: select }),
        pageSizes: [1, 2, 3, 5, 100],
        total: 17,
      });
    }

    return compared;
  }

  // Each page twice, with a dozen joins: slower than the suite's default.
  const MANY_PAGES_TIMEOUT_MS: number = 300000;

  test(
    "an Incidents list with its labels and monitors: TypeORM's pages, for every order of its own columns",
    async () => {
      expect(
        await expectSameIncidentsListPages([
          { createdAt: "DESC", _id: "ASC" },
          { createdAt: "ASC", _id: "DESC" },
          { declaredAt: "DESC", _id: "ASC" },
          { title: "ASC", _id: "ASC" },
          { incidentNumber: "DESC", _id: "ASC" },
        ]),
      ).toBeGreaterThan(60);
    },
    MANY_PAGES_TIMEOUT_MS,
  );

  test(
    "an Incidents list with its labels and monitors: TypeORM's pages, ordered through to-one relations and with no primary key",
    async () => {
      expect(
        await expectSameIncidentsListPages([
          // Through a to-one relation, with ties.
          { currentIncidentState: { order: "DESC" }, _id: "ASC" },
          { incidentSeverity: { name: "ASC" }, createdAt: "DESC", _id: "ASC" },
          // No primary key: TypeORM breaks ties by it on its ids query, as the id page does.
          { createdAt: "DESC" },
        ]),
      ).toBeGreaterThan(30);
    },
    MANY_PAGES_TIMEOUT_MS,
  );

  /*
   * An Incidents list sorted from its Severity or State header (#8134): by
   * the related record's place in the project's list, worst first or the
   * other way with the incidents that have none last, that place selected
   * as the dashboard's table selects it (ModelTable's ColumnSort).
   */
  test(
    "an Incidents list sorted by its Severity and State headers: TypeORM's pages, both ways",
    async () => {
      let compared: number = 0;

      const select: Record<string, unknown> = {
        ...(incidentsList({}).select as Record<string, unknown>),
        currentIncidentState: { _id: true, name: true, order: true },
        incidentSeverity: { _id: true, name: true, order: true },
      };

      for (const order of [
        { incidentSeverity: { order: "ASC" }, _id: "ASC" },
        {
          incidentSeverity: { order: { direction: "DESC", nulls: "LAST" } },
          _id: "ASC",
        },
        { currentIncidentState: { order: "ASC" }, _id: "ASC" },
        {
          currentIncidentState: {
            order: { direction: "DESC", nulls: "LAST" },
          },
          _id: "ASC",
        },
      ]) {
        compared += await expectSamePages({
          target: Incident,
          options: incidentsList({ order: order, select: select }),
          pageSizes: [1, 3, 5, 100],
          total: 17,
        });
      }

      expect(compared).toBeGreaterThan(40);
    },
    MANY_PAGES_TIMEOUT_MS,
  );

  test(
    "an Incidents list with deleted incidents, filtered through its state, with a raw condition",
    async () => {
      let compared: number = 0;

      compared += await expectSamePages({
        target: Incident,
        options: incidentsList({ withDeleted: true }),
        pageSizes: [1, 4, 100],
        total: 17,
      });

      compared += await expectSamePages({
        target: Incident,
        options: incidentsList({
          where: {
            projectId: projectId,
            currentIncidentState: { name: In(["State 0", "State 2"]) },
          },
        }),
        pageSizes: [1, 3, 100],
        total: 17,
      });

      compared += await expectSamePages({
        target: Incident,
        options: incidentsList({
          where: {
            projectId: projectId,
            title: Raw((alias: string): string => {
              return `(${alias} IS NULL OR ${alias} <> 'Incident 1')`;
            }),
          },
        }),
        pageSizes: [2, 100],
        total: 17,
      });

      // Alternatives, each through the table and a to-one relation only.
      compared += await expectSamePages({
        target: Incident,
        options: incidentsList({
          where: [
            { projectId: projectId, title: "Incident 0" },
            { projectId: projectId, currentIncidentState: { name: "State 1" } },
          ],
        }),
        pageSizes: [1, 100],
        total: 17,
      });

      expect(compared).toBeGreaterThan(30);
    },
    MANY_PAGES_TIMEOUT_MS,
  );

  test(
    "monitors with their labels and the monitors they depend on: TypeORM's pages, deleted labels left out by both",
    async () => {
      let compared: number = 0;

      for (const order of [
        { name: "ASC", _id: "ASC" },
        { createdAt: "DESC", _id: "ASC" },
        { currentMonitorStatus: { name: "DESC" }, _id: "DESC" },
      ]) {
        compared += await expectSamePages({
          target: Monitor,
          options: {
            where: { projectId: projectId } as never,
            select: {
              _id: true,
              createdAt: true,
              name: true,
              labels: { _id: true, name: true },
              dependsOnMonitors: { _id: true, name: true },
              currentMonitorStatus: { _id: true, name: true },
            } as never,
            relations: {
              labels: true,
              dependsOnMonitors: true,
              currentMonitorStatus: true,
            } as never,
            order: order as never,
          },
          pageSizes: [1, 2, 5, 50],
          total: 23,
        });
      }

      expect(compared).toBeGreaterThan(40);
    },
    MANY_PAGES_TIMEOUT_MS,
  );

  test("a list filtered through the labels it shows: TypeORM's two queries, and its pages", async () => {
    const options: FindManyOptions<Incident> = incidentsList({
      where: {
        projectId: projectId,
        labels: { _id: In(labelIds.slice(0, 3)) },
      },
    });

    const compared: number = await expectSamePages({
      target: Incident,
      options: options,
      pageSizes: [1, 2, 100],
      total: 17,
    });

    expect(compared).toBeGreaterThan(5);
    expect(
      PagedFind.createIdPageQueryBuilder(database.getRepository(Incident), {
        ...options,
        skip: 0,
        take: 10,
      }),
    ).toBeNull();
  });

  /*
   * #8113: a grant limited to labels, and a filter by labels, keep the
   * records by a condition on their own id - the records the label join
   * table links to one of the labels, the label not deleted - in place of a
   * filter through the labels relation (the test above). With no to-many
   * join in its filter, such a list takes its page's ids from the table
   * itself, and gives TypeORM's own pages: the same records, each with every
   * label it carries.
   */
  function carriesOneOf(labels: Array<string>): unknown {
    return QueryHelper.anyOfEntitiesInManyToMany({
      values: labels,
      joinTableName: "MonitorLabel",
      ownerColumnName: "monitorId",
      relationColumnName: "labelId",
      relatedTable: {
        tableName: "Label",
        columnName: "_id",
        deleteDateColumnName: "deletedAt",
      },
    });
  }

  test("monitors kept to some labels by a condition on their id, with their labels shown: their ids from the table, and TypeORM's pages", async () => {
    const repository: Repository<Monitor> = database.getRepository(Monitor);
    let compared: number = 0;

    // The deleted label among them: it keeps no monitor, as through the relation.
    for (const labels of [
      labelIds.slice(0, 1),
      labelIds.slice(1, 3),
      [labelIds[4]!],
      labelIds,
    ]) {
      const options: FindManyOptions<Monitor> = {
        where: {
          projectId: projectId,
          _id: carriesOneOf(labels),
        } as never,
        select: {
          _id: true,
          createdAt: true,
          name: true,
          labels: { _id: true, name: true },
          currentMonitorStatus: { _id: true, name: true },
        } as never,
        relations: { labels: true, currentMonitorStatus: true } as never,
        order: { createdAt: "DESC", _id: "ASC" } as never,
      };

      compared += await expectSamePages({
        target: Monitor,
        options: options,
        pageSizes: [1, 2, 5, 100],
        total: 23,
      });

      expect(
        PagedFind.createIdPageQueryBuilder(repository, {
          ...options,
          skip: 0,
          take: 10,
        }),
      ).not.toBeNull();

      // The same records the filter through the relation keeps.
      const throughTheRelation: Array<string> = (
        await repository.find({
          where: {
            projectId: projectId,
            labels: { _id: In(labels) },
          } as never,
          select: { _id: true } as never,
        })
      )
        .map((monitor: Monitor): string => {
          return monitor.id!.toString();
        })
        .sort();
      const onTheId: Array<string> = (
        await repository.find({
          where: options.where,
          select: { _id: true } as never,
        })
      )
        .map((monitor: Monitor): string => {
          return monitor.id!.toString();
        })
        .sort();

      expect(onTheId).toEqual(throughTheRelation);
    }

    expect(compared).toBeGreaterThan(20);
  });

  test("the queries a list kept to labels by its id sends: its ids from the table with no join, then their rows", async () => {
    const repository: Repository<Monitor> = database.getRepository(Monitor);
    const options: FindManyOptions<Monitor> = {
      where: {
        projectId: projectId,
        _id: carriesOneOf(labelIds.slice(0, 3)),
      } as never,
      select: {
        _id: true,
        createdAt: true,
        name: true,
        labels: { _id: true, name: true },
      } as never,
      relations: { labels: true } as never,
      order: { createdAt: "DESC", _id: "ASC" } as never,
      skip: 1,
      take: 3,
    };

    let paged: Array<Monitor> = [];
    const queries: Array<string> = await recordQueries(async () => {
      paged = await PagedFind.find(repository, options);
    });

    expect(normalized(paged)).toBe(normalized(await repository.find(options)));
    expect(paged).toHaveLength(3);
    expect(queries).toHaveLength(2);
    expect(queries[0]).not.toContain("DISTINCT");
    expect(queries[0]).not.toContain("JOIN");
    expect(queries[0]).toContain('"MonitorLabel"."monitorId"');
    expect(queries[0]).toContain("LIMIT 3 OFFSET 1");
  });

  test("a monitor read by its id under a condition on its id: one query, TypeORM's page", async () => {
    const repository: Repository<Monitor> = database.getRepository(Monitor);
    let found: number = 0;

    for (const monitorId of monitorIds) {
      const options: FindManyOptions<Monitor> = {
        where: {
          _id: And(Equal(monitorId), carriesOneOf(labelIds) as never),
        } as never,
        select: {
          _id: true,
          createdAt: true,
          name: true,
          labels: { _id: true, name: true },
        } as never,
        relations: { labels: true } as never,
        order: { createdAt: "DESC", _id: "ASC" } as never,
        skip: 0,
        take: 1,
      };

      let paged: Array<Monitor> = [];
      const queries: Array<string> = await recordQueries(async () => {
        paged = await PagedFind.find(repository, options);
      });

      expect(normalized(paged)).toBe(
        normalized(await repository.find(options)),
      );
      expect(queries).toHaveLength(1);
      found += paged.length;
    }

    // The monitors that carry a label that is not deleted, and are not deleted.
    expect(found).toBeGreaterThan(5);
  });

  test("a list ordered through a to-many relation: TypeORM's two queries, and its pages", async () => {
    const options: FindManyOptions<Incident> = incidentsList({
      select: {
        ...(incidentsList({}).select as Record<string, unknown>),
        labels: { _id: true, name: true },
      },
      order: { labels: { name: "ASC" }, _id: "ASC" },
    });

    await expectSamePages({
      target: Incident,
      options: options,
      pageSizes: [2, 100],
      total: 17,
    });

    expect(
      PagedFind.createIdPageQueryBuilder(database.getRepository(Incident), {
        ...options,
        skip: 0,
        take: 10,
      }),
    ).toBeNull();
  });

  test("the queries a list of incidents with labels and monitors sends: its ids from the table, then their rows", async () => {
    const repository: Repository<Incident> = database.getRepository(Incident);
    const options: FindManyOptions<Incident> = {
      ...incidentsList({}),
      skip: 2,
      take: 3,
    };

    let paged: Array<Incident> = [];
    const pagedQueries: Array<string> = await recordQueries(async () => {
      paged = await PagedFind.find(repository, options);
    });

    let typeOrm: Array<Incident> = [];
    const typeOrmQueries: Array<string> = await recordQueries(async () => {
      typeOrm = await repository.find(options);
    });

    expect(normalized(paged)).toBe(normalized(typeOrm));
    expect(paged).toHaveLength(3);

    // TypeORM: the DISTINCT over every join, then the rows.
    expect(typeOrmQueries).toHaveLength(2);
    expect(typeOrmQueries[0]).toContain("SELECT DISTINCT");
    expect(typeOrmQueries[0]).toContain('"IncidentLabel"');

    // PagedFind: the ids from the table, then the very same rows query.
    expect(pagedQueries).toHaveLength(2);
    expect(pagedQueries[0]).not.toContain("DISTINCT");
    expect(pagedQueries[0]).not.toContain("JOIN");
    expect(pagedQueries[0]).toContain("LIMIT 3 OFFSET 2");
    expect(pagedQueries[1]).toBe(typeOrmQueries[1]);
  });

  test("a page past the last: one query, and nothing", async () => {
    const repository: Repository<Incident> = database.getRepository(Incident);
    const options: FindManyOptions<Incident> = {
      ...incidentsList({}),
      skip: 1000,
      take: 10,
    };

    let paged: Array<Incident> = [new Incident()];
    const queries: Array<string> = await recordQueries(async () => {
      paged = await PagedFind.find(repository, options);
    });

    expect(paged).toEqual([]);
    expect(await repository.find(options)).toEqual([]);
    expect(queries).toHaveLength(1);
  });
});
