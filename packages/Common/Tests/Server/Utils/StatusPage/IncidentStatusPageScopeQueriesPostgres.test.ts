import Entities from "../../../../Models/DatabaseModels/Index";
import Incident from "../../../../Models/DatabaseModels/Incident";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import IncidentStatusPageScope, {
  ResolvedIncidentStatusPages,
  StatusPageExclusionReason,
} from "../../../../Server/Utils/StatusPage/IncidentStatusPageScope";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../../Types/ObjectID";
import { DataSource } from "typeorm";

/*
 * IncidentStatusPageScope's queries against a migrated Postgres: the SQL the
 * unit tests can only assume.
 *
 * Opt in with RUN_POSTGRES_INCIDENT_STATUS_PAGE_SCOPE_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_INCIDENT_STATUS_PAGE_SCOPE_TESTS=true \
 *   INCIDENT_STATUS_PAGE_SCOPE_TEST_DATABASE_HOST=127.0.0.1 \
 *   INCIDENT_STATUS_PAGE_SCOPE_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Utils/StatusPage/IncidentStatusPageScopeQueriesPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml, next to the
 * incident status page scope service test, once every registered migration
 * has been applied to an empty database.
 *
 * What it pins down:
 *
 *   - a display query keeps the caller's monitors filter (a join on
 *     IncidentMonitor) and adds the scope as a second join-table filter on
 *     IncidentStatusPage - both in one statement, in SQL;
 *   - the two halves (unscoped, scoped to this page) come back disjoint, and
 *     merge, sort and cut the way one query would have;
 *   - the counts include only the project's incidents visible on status
 *     pages;
 *   - resolvePagesForIncidents reads the scope an incident has in the
 *     database, and the status pages' onlyShowScopedIncidents.
 *
 * The tables involved are cloned, structure only (LIKE ... INCLUDING ALL),
 * into a uniquely named schema that search_path puts first; no row is written
 * outside it, and it is dropped afterwards.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_INCIDENT_STATUS_PAGE_SCOPE_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "Project",
  "ProjectSMTPConfig",
  "ProjectCallSMSConfig",
  // A page's logo file is read to decide whether its emails show the logo.
  "File",
  "StatusPage",
  "StatusPageGroup",
  "Monitor",
  "MonitorGroupResource",
  "StatusPageResource",
  "Incident",
  "IncidentMonitor",
  "IncidentStatusPage",
];

describePostgres("IncidentStatusPageScope against a migrated Postgres", () => {
  const schema: string = `incident_scope_q_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;

  const projectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();

  let database: DataSource;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["INCIDENT_STATUS_PAGE_SCOPE_TEST_DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["INCIDENT_STATUS_PAGE_SCOPE_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["INCIDENT_STATUS_PAGE_SCOPE_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
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
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  let pageA: ObjectID;
  let pageB: ObjectID;
  // Only shows incidents limited to it.
  let pageScopedOnly: ObjectID;
  let sharedMonitor: ObjectID;
  let otherMonitor: ObjectID;

  // The incidents, by what they are.
  let unscopedShared: ObjectID;
  let scopedToA: ObjectID;
  let scopedToB: ObjectID;
  let unscopedOther: ObjectID;
  let scopedToDeletedPage: ObjectID;
  let hiddenUnscoped: ObjectID;
  let otherProjectIncident: ObjectID;
  let scopedToScopedOnly: ObjectID;

  async function seedProject(id: ObjectID): Promise<void> {
    await database.query(
      `INSERT INTO "${schema}"."Project" ("_id", "name", "slug", "version")
         VALUES ($1, 'Scope query test', $2, 1)`,
      [id.toString(), `scope-q-${id.toString()}`],
    );
  }

  async function seedStatusPage(
    name: string,
    onlyShowScopedIncidents: boolean,
  ): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    await database.query(
      `INSERT INTO "${schema}"."StatusPage"
         ("_id", "projectId", "name", "slug", "version", "onlyShowScopedIncidents")
         VALUES ($1, $2, $3, $4, 1, $5)`,
      [
        id.toString(),
        projectId.toString(),
        name,
        `page-${id.toString()}`,
        onlyShowScopedIncidents,
      ],
    );
    return id;
  }

  async function seedMonitor(name: string): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    await database.query(
      `INSERT INTO "${schema}"."Monitor"
         ("_id", "projectId", "name", "slug", "monitorType", "currentMonitorStatusId", "version")
         VALUES ($1, $2, $3, $4, 'Manual', $5, 1)`,
      [
        id.toString(),
        projectId.toString(),
        name,
        `monitor-${id.toString()}`,
        ObjectID.generate().toString(),
      ],
    );
    return id;
  }

  async function listMonitorOnPage(
    monitorId: ObjectID,
    statusPageId: ObjectID,
  ): Promise<void> {
    await database.query(
      `INSERT INTO "${schema}"."StatusPageResource"
         ("_id", "projectId", "statusPageId", "monitorId", "displayName", "order", "version")
         VALUES ($1, $2, $3, $4, 'Checkout', 1, 1)`,
      [
        ObjectID.generate().toString(),
        projectId.toString(),
        statusPageId.toString(),
        monitorId.toString(),
      ],
    );
  }

  async function seedIncident(data: {
    monitorId: ObjectID;
    declaredAt: string;
    scopedTo?: Array<ObjectID>;
    isVisibleOnStatusPage?: boolean;
    project?: ObjectID;
  }): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    await database.query(
      `INSERT INTO "${schema}"."Incident"
         ("_id", "projectId", "title", "slug", "currentIncidentStateId", "incidentSeverityId",
          "version", "declaredAt", "isVisibleOnStatusPage", "isScopedToStatusPages")
         VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, $9)`,
      [
        id.toString(),
        (data.project || projectId).toString(),
        `Incident declared ${data.declaredAt}`,
        `incident-${id.toString()}`,
        ObjectID.generate().toString(),
        ObjectID.generate().toString(),
        data.declaredAt,
        data.isVisibleOnStatusPage !== false,
        data.scopedTo !== undefined,
      ],
    );
    await database.query(
      `INSERT INTO "${schema}"."IncidentMonitor" ("incidentId", "monitorId") VALUES ($1, $2)`,
      [id.toString(), data.monitorId.toString()],
    );
    for (const statusPageId of data.scopedTo || []) {
      await database.query(
        `INSERT INTO "${schema}"."IncidentStatusPage" ("incidentId", "statusPageId") VALUES ($1, $2)`,
        [id.toString(), statusPageId.toString()],
      );
    }
    return id;
  }

  function statusPage(
    id: ObjectID,
    onlyShowScopedIncidents: boolean,
  ): StatusPage {
    const page: StatusPage = new StatusPage();
    page._id = id.toString();
    page.onlyShowScopedIncidents = onlyShowScopedIncidents;
    return page;
  }

  function ids(incidents: Array<Incident>): Array<string> {
    return incidents.map((incident: Incident): string => {
      return incident._id!;
    });
  }

  beforeEach(async () => {
    await database.query(
      TABLES.map((table: string): string => {
        return `DELETE FROM "${schema}"."${table}"`;
      })
        .reverse()
        .join("; "),
    );

    await seedProject(projectId);
    await seedProject(otherProjectId);

    pageA = await seedStatusPage("Site A", false);
    pageB = await seedStatusPage("Site B", false);
    pageScopedOnly = await seedStatusPage("Site C", true);

    sharedMonitor = await seedMonitor("Shared uplink");
    otherMonitor = await seedMonitor("Site A router");

    await listMonitorOnPage(sharedMonitor, pageA);
    await listMonitorOnPage(sharedMonitor, pageB);
    await listMonitorOnPage(sharedMonitor, pageScopedOnly);
    await listMonitorOnPage(otherMonitor, pageA);

    unscopedShared = await seedIncident({
      monitorId: sharedMonitor,
      declaredAt: "2026-05-01T00:00:00Z",
    });
    scopedToA = await seedIncident({
      monitorId: sharedMonitor,
      declaredAt: "2026-05-02T00:00:00Z",
      scopedTo: [pageA],
    });
    scopedToB = await seedIncident({
      monitorId: sharedMonitor,
      declaredAt: "2026-05-03T00:00:00Z",
      scopedTo: [pageB],
    });
    unscopedOther = await seedIncident({
      monitorId: otherMonitor,
      declaredAt: "2026-05-04T00:00:00Z",
    });
    // Scoped to a page that has since been deleted: no join row left.
    scopedToDeletedPage = await seedIncident({
      monitorId: sharedMonitor,
      declaredAt: "2026-05-05T00:00:00Z",
      scopedTo: [],
    });
    hiddenUnscoped = await seedIncident({
      monitorId: sharedMonitor,
      declaredAt: "2026-05-06T00:00:00Z",
      isVisibleOnStatusPage: false,
    });
    otherProjectIncident = await seedIncident({
      monitorId: sharedMonitor,
      declaredAt: "2026-05-07T00:00:00Z",
      project: otherProjectId,
    });
    scopedToScopedOnly = await seedIncident({
      monitorId: sharedMonitor,
      declaredAt: "2026-05-08T00:00:00Z",
      scopedTo: [pageScopedOnly, pageB],
    });
  });

  // The monitors each page lists, as the status page API reads them.
  function monitorsOn(page: StatusPage): Array<ObjectID> {
    return page._id === pageA.toString()
      ? [sharedMonitor, otherMonitor]
      : [sharedMonitor];
  }

  async function shownOn(
    page: StatusPage,
    options?: { limit?: number; skip?: number },
  ): Promise<Array<string>> {
    return ids(
      await IncidentStatusPageScope.findIncidentsForStatusPage({
        statusPage: page,
        query: {
          monitors: monitorsOn(page) as never,
          projectId: projectId,
          isVisibleOnStatusPage: true,
        },
        select: { _id: true, title: true },
        sort: { declaredAt: SortOrder.Descending },
        limit: options?.limit || 50,
        skip: options?.skip || 0,
        props: { isRoot: true },
      }),
    );
  }

  test("a page shows its unscoped incidents and the ones scoped to it, newest first", async () => {
    expect(await shownOn(statusPage(pageA, false))).toEqual([
      unscopedOther.toString(),
      scopedToA.toString(),
      unscopedShared.toString(),
    ]);
    expect(await shownOn(statusPage(pageB, false))).toEqual([
      scopedToScopedOnly.toString(),
      scopedToB.toString(),
      unscopedShared.toString(),
    ]);
  });

  test("a page that only shows scoped incidents shows only the ones scoped to it", async () => {
    expect(await shownOn(statusPage(pageScopedOnly, true))).toEqual([
      scopedToScopedOnly.toString(),
    ]);
  });

  test("an incident scoped to a deleted page, a hidden one and another project's are shown nowhere", async () => {
    for (const page of [
      statusPage(pageA, false),
      statusPage(pageB, false),
      statusPage(pageScopedOnly, true),
    ]) {
      const shown: Array<string> = await shownOn(page);

      expect(shown).not.toContain(scopedToDeletedPage.toString());
      expect(shown).not.toContain(hiddenUnscoped.toString());
      expect(shown).not.toContain(otherProjectIncident.toString());
    }
  });

  test("the limit and skip cut the merged list, not each half", async () => {
    expect(await shownOn(statusPage(pageA, false), { limit: 2 })).toEqual([
      unscopedOther.toString(),
      scopedToA.toString(),
    ]);
    expect(
      await shownOn(statusPage(pageA, false), { limit: 2, skip: 1 }),
    ).toEqual([scopedToA.toString(), unscopedShared.toString()]);
  });

  test("never returns the scope columns", async () => {
    const incidents: Array<Incident> =
      await IncidentStatusPageScope.findIncidentsForStatusPage({
        statusPage: statusPage(pageA, false),
        query: {
          monitors: [sharedMonitor] as never,
          projectId: projectId,
        },
        select: { _id: true, title: true },
        limit: 10,
        props: { isRoot: true },
      });

    expect(incidents.length).toBeGreaterThan(0);
    const json: string = JSON.stringify(incidents);
    expect(json).not.toContain("isScopedToStatusPages");
    expect(json).not.toContain("statusPagesNotifiedOnCreation");
    expect(json).not.toContain(pageB.toString());
  });

  test("finds one incident only on a page it is shown on", async () => {
    const find: (
      page: StatusPage,
      incidentId: ObjectID,
    ) => Promise<Incident | null> = (
      page: StatusPage,
      incidentId: ObjectID,
    ): Promise<Incident | null> => {
      return IncidentStatusPageScope.findOneIncidentForStatusPage({
        statusPage: page,
        query: {
          _id: incidentId.toString(),
          monitors: [sharedMonitor] as never,
          projectId: projectId,
          isVisibleOnStatusPage: true,
        },
        select: { _id: true },
        props: { isRoot: true },
      });
    };

    expect((await find(statusPage(pageA, false), scopedToA))?._id).toBe(
      scopedToA.toString(),
    );
    expect(await find(statusPage(pageA, false), scopedToB)).toBeNull();
    expect(
      await find(statusPage(pageScopedOnly, true), unscopedShared),
    ).toBeNull();
  });

  test("counts only the project's visible incidents a page shows", async () => {
    const count: (page: StatusPage) => Promise<number> = (
      page: StatusPage,
    ): Promise<number> => {
      return IncidentStatusPageScope.countIncidentsForStatusPage({
        statusPage: page,
        projectId: projectId,
        query: { monitors: monitorsOn(page) as never },
      });
    };

    expect(await count(statusPage(pageA, false))).toBe(3);
    expect(await count(statusPage(pageB, false))).toBe(3);
    expect(await count(statusPage(pageScopedOnly, true))).toBe(1);
  });

  test("resolvePagesForIncidents reads each incident's stored scope and each page's switch", async () => {
    const incidentOn: (id: ObjectID, monitorId: ObjectID) => Incident = (
      id: ObjectID,
      monitorId: ObjectID,
    ): Incident => {
      const incident: Incident = new Incident();
      incident._id = id.toString();
      incident.monitors = [monitorId as never];
      return incident;
    };

    const names: (resolved: ResolvedIncidentStatusPages) => Array<string> = (
      resolved: ResolvedIncidentStatusPages,
    ): Array<string> => {
      return resolved.statusPages.map((page: StatusPage): string => {
        return page.name!;
      });
    };

    const unscoped: ResolvedIncidentStatusPages =
      await IncidentStatusPageScope.resolvePagesForIncidents({
        incidents: [incidentOn(unscopedShared, sharedMonitor)],
      });
    expect(names(unscoped)).toEqual(["Site A", "Site B"]);
    expect(unscoped.excludedStatusPages).toEqual([
      expect.objectContaining({
        reason: StatusPageExclusionReason.OnlyShowsScopedIncidents,
      }),
    ]);

    const scoped: ResolvedIncidentStatusPages =
      await IncidentStatusPageScope.resolvePagesForIncidents({
        incidents: [incidentOn(scopedToScopedOnly, sharedMonitor)],
      });
    expect(names(scoped)).toEqual(["Site B", "Site C"]);
    expect(scoped.isScoped).toBe(true);

    const nowhere: ResolvedIncidentStatusPages =
      await IncidentStatusPageScope.resolvePagesForIncidents({
        incidents: [incidentOn(scopedToDeletedPage, sharedMonitor)],
      });
    expect(nowhere.statusPages).toEqual([]);

    // An episode of the two: the union.
    const episode: ResolvedIncidentStatusPages =
      await IncidentStatusPageScope.resolvePagesForIncidents({
        incidents: [
          incidentOn(scopedToA, sharedMonitor),
          incidentOn(unscopedOther, otherMonitor),
        ],
      });
    expect(names(episode)).toEqual(["Site A"]);
  });
});
