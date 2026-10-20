import Entities from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CephResource from "../../../Models/DatabaseModels/CephResource";
import DockerResource from "../../../Models/DatabaseModels/DockerResource";
import Incident from "../../../Models/DatabaseModels/Incident";
import KubernetesResource from "../../../Models/DatabaseModels/KubernetesResource";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import DatabaseService from "../../../Server/Services/DatabaseService";
import Includes from "../../../Types/BaseDatabase/Includes";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import {
  DashboardWidgetSortChoice,
  DashboardWidgetSortDirection,
} from "../../../Types/Dashboard/DashboardWidgetSort";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  DashboardWidgetListReadStep,
  getDashboardWidgetListReadSteps,
  readDashboardWidgetListInSteps,
  withDashboardWidgetListSortSelect,
} from "../../../Utils/Dashboard/DashboardWidgetSorts";
import { DataSource } from "typeorm";

jest.mock("../../../Server/Infrastructure/Postgres/DataSourceOptions", () => {
  return {};
});

/*
 * Dashboard list widgets sorted by the database (issue #5082), on Postgres.
 *
 * A list widget shows at most its Max Rows, so a sort must order the WHOLE
 * list before the limit - "the worst five monitors", never "the worst of
 * five monitors". The orders the registry builds (DashboardWidgetSorts)
 * run here through DatabaseService.findBy exactly as the widgets' list
 * reads and the public dashboard's route run them: a page read with the
 * related records' fields, which TypeORM pages through a DISTINCT subquery
 * that can only order by a related field it also selects. Only a real
 * database says that order works, and that a status sorts by the order the
 * project keeps rather than by its name.
 *
 * Opt in with RUN_POSTGRES_DASHBOARD_WIDGET_SORT_TESTS=true against a
 * database the registered migrations have run on: the table definitions
 * are copied from public into a schema of the test's own, every row is
 * synthetic, and the schema is dropped afterwards.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_DASHBOARD_WIDGET_SORT_TESTS"] === "true"
    ? describe
    : describe.skip;

const DESC: DashboardWidgetSortDirection =
  DashboardWidgetSortDirection.Descending;
const ASC: DashboardWidgetSortDirection = DashboardWidgetSortDirection.Ascending;

describePostgres("dashboard list widget sorts against Postgres", () => {
  const schema: string = `dashboard_widget_sort_${ObjectID.generate().toString().replace(/-/g, "")}`;
  const projectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();
  let database: DataSource;
  let sequence: number = 0;

  // An id that sorts after every id inserted before it, for stable ties.
  function nextId(): string {
    sequence++;
    return `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;
  }

  async function insert(table: string, row: JSONObject): Promise<string> {
    const id: string = (row["_id"] as string) || nextId();
    const values: JSONObject = { _id: id, version: 1, ...row };
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
        return values[column];
      }),
    );

    return id;
  }

  /*
   * A widget's list read the way the widgets and the public route read it:
   * the registry's steps over the widget's query, each a page of rows with
   * the select the order needs, until the list has `limit` rows.
   */
  async function readList<TBaseModel extends BaseModel>(data: {
    modelType: { new (): TBaseModel };
    componentType: DashboardComponentType;
    choice: DashboardWidgetSortChoice | null;
    query: JSONObject;
    select: JSONObject;
    limit: number;
  }): Promise<Array<TBaseModel>> {
    const service: DatabaseService<TBaseModel> = new DatabaseService(
      data.modelType,
    );

    const steps: Array<DashboardWidgetListReadStep> =
      getDashboardWidgetListReadSteps({
        componentType: data.componentType,
        choice: data.choice,
        query: data.query,
      });

    const select: JSONObject = withDashboardWidgetListSortSelect(
      data.componentType,
      data.select,
    );

    return readDashboardWidgetListInSteps<TBaseModel>({
      steps,
      limit: data.limit,
      read: (
        step: DashboardWidgetListReadStep,
        limit: number,
      ): Promise<Array<TBaseModel>> => {
        return service.findBy({
          query: step.query as any,
          select: select as any,
          sort: step.sort as any,
          limit,
          skip: 0,
          props: { isRoot: true },
        });
      },
    });
  }

  function names(rows: Array<BaseModel>): Array<string> {
    return rows.map((row: BaseModel) => {
      return (row as unknown as { name?: string; title?: string }).name ||
        (row as unknown as { title?: string }).title ||
        "";
    });
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["DASHBOARD_WIDGET_SORT_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["DASHBOARD_WIDGET_SORT_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["DASHBOARD_WIDGET_SORT_TEST_DATABASE_NAME"] ||
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
      "MonitorStatus",
      "Monitor",
      "IncidentSeverity",
      "IncidentState",
      "Incident",
      "KubernetesCluster",
      "KubernetesResource",
      "DockerHost",
      "DockerResource",
      "CephCluster",
      "CephResource",
      "ServiceLevelObjective",
    ]) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    for (const id of [projectId, otherProjectId]) {
      await insert("Project", {
        _id: id.toString(),
        name: "Synthetic project",
        slug: id.toString(),
      });
    }

    /*
     * Monitor statuses in the project's own order, healthiest first: the
     * names say nothing about the order, so a sort by name would differ.
     */
    const statuses: Record<string, string> = {};

    for (const [name, priority] of [
      ["Zen", 1],
      ["Maintenance", 2],
      ["Busy", 3],
      ["Alarm", 4],
    ] as Array<[string, number]>) {
      statuses[name] = await insert("MonitorStatus", {
        projectId: projectId.toString(),
        name,
        slug: name.toLowerCase(),
        color: "#000000",
        priority,
      });
    }

    for (const [name, status] of [
      ["api", "Zen"],
      ["billing", "Alarm"],
      ["cdn", "Busy"],
      ["dns", "Zen"],
      ["edge", "Maintenance"],
      ["fax", "Alarm"],
      ["gateway", "Zen"],
    ] as Array<[string, string]>) {
      await insert("Monitor", {
        projectId: projectId.toString(),
        name,
        slug: name,
        monitorType: "Manual",
        currentMonitorStatusId: statuses[status],
      });
    }

    // Another project's worst monitor never reaches this project's list.
    const otherStatus: string = await insert("MonitorStatus", {
      projectId: otherProjectId.toString(),
      name: "Other alarm",
      slug: "other-alarm",
      color: "#000000",
      priority: 99,
    });
    await insert("Monitor", {
      projectId: otherProjectId.toString(),
      name: "aaa-other",
      slug: "aaa-other",
      monitorType: "Manual",
      currentMonitorStatusId: otherStatus,
    });

    /*
     * Severities in the project's order, most severe first (order 1). The
     * project calls its most severe one "Sev 3": a sort by name would be
     * backwards.
     */
    const severities: Record<string, string> = {};

    for (const [name, order] of [
      ["Sev 3", 1],
      ["Sev 2", 2],
      ["Sev 1", 3],
    ] as Array<[string, number]>) {
      severities[name] = await insert("IncidentSeverity", {
        projectId: projectId.toString(),
        name,
        slug: name.toLowerCase().replace(" ", "-"),
        color: "#000000",
        order,
      });
    }

    const states: Record<string, string> = {};

    for (const [name, order] of [
      ["Identified", 1],
      ["Acknowledged", 2],
      ["Resolved", 3],
    ] as Array<[string, number]>) {
      states[name] = await insert("IncidentState", {
        projectId: projectId.toString(),
        name,
        slug: name.toLowerCase(),
        color: "#000000",
        order,
      });
    }

    const minute: number = 60_000;
    const start: number = Date.UTC(2026, 9, 20, 12, 0, 0);

    for (const [title, severity, state, minutesAgo] of [
      ["checkout down", "Sev 2", "Acknowledged", 50],
      ["login slow", "Sev 1", "Identified", 40],
      ["payments lost", "Sev 3", "Resolved", 30],
      ["queue backed up", "Sev 3", "Identified", 20],
      ["search flaky", "Sev 1", "Resolved", 10],
      ["typo on status page", "Sev 1", "Acknowledged", 5],
    ] as Array<[string, string, string, number]>) {
      await insert("Incident", {
        projectId: projectId.toString(),
        title,
        slug: title.split(" ").join("-"),
        incidentSeverityId: severities[severity],
        currentIncidentStateId: states[state],
        createdAt: new Date(start - minutesAgo * minute),
      });
    }

    const clusters: Record<string, string> = {};

    for (const name of ["prod-eu", "prod-us"]) {
      clusters[name] = await insert("KubernetesCluster", {
        projectId: projectId.toString(),
        name,
        slug: name,
        clusterIdentifier: name,
      });
    }

    for (const [name, namespace, phase, cluster] of [
      ["api-1", "web", "Running", "prod-us"],
      ["api-2", "web", "Failed", "prod-us"],
      ["batch-1", "jobs", "Succeeded", "prod-eu"],
      ["cache-1", "data", "Pending", "prod-eu"],
      ["db-1", "data", "Running", "prod-eu"],
      ["etl-1", "jobs", "Unknown", "prod-us"],
      ["etl-2", "jobs", "Failed", "prod-eu"],
      ["gc-1", "kube-system", null, "prod-us"],
      ["odd-1", "web", "Evicting", "prod-us"],
    ] as Array<[string, string, string | null, string]>) {
      await insert("KubernetesResource", {
        projectId: projectId.toString(),
        kubernetesClusterId: clusters[cluster],
        kind: "Pod",
        name,
        namespaceKey: namespace,
        phase,
        lastSeenAt: new Date(start),
      });
    }

    const dockerHost: string = await insert("DockerHost", {
      projectId: projectId.toString(),
      name: "docker-1",
      slug: "docker-1",
      hostIdentifier: "docker-1",
    });

    for (const [name, cpu] of [
      ["alpha", 12.5],
      ["bravo", null],
      ["charlie", 88],
      ["delta", 3],
      ["echo", null],
      ["foxtrot", 45],
    ] as Array<[string, number | null]>) {
      await insert("DockerResource", {
        projectId: projectId.toString(),
        dockerHostId: dockerHost,
        kind: "Container",
        name,
        latestCpuPercent: cpu,
        lastSeenAt: new Date(start),
      });
    }

    const cephCluster: string = await insert("CephCluster", {
      projectId: projectId.toString(),
      name: "ceph-1",
      slug: "ceph-1",
    });

    for (const [externalId, isUp, isIn] of [
      ["osd.0", true, true],
      ["osd.1", false, true],
      ["osd.2", true, false],
      ["osd.3", false, false],
      ["osd.4", null, true],
      ["osd.5", true, true],
      ["osd.6", false, true],
      ["osd.7", true, null],
    ] as Array<[string, boolean | null, boolean | null]>) {
      await insert("CephResource", {
        projectId: projectId.toString(),
        cephClusterId: cephCluster,
        kind: "Osd",
        externalId,
        name: externalId,
        isUp,
        isIn,
        lastSeenAt: new Date(start),
      });
    }

    for (const [name, isEnabled, budget] of [
      ["Checkout", true, 12],
      ["Login", true, -5],
      ["Search", true, 80],
      ["Frozen", false, -50],
      ["Unmeasured", true, null],
    ] as Array<[string, boolean, number | null]>) {
      await insert("ServiceLevelObjective", {
        projectId: projectId.toString(),
        name,
        slug: name.toLowerCase(),
        targetPercentage: 99.9,
        isEnabled,
        errorBudgetRemainingPercentage: budget,
      });
    }
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  const MONITOR_SELECT: JSONObject = {
    _id: true,
    name: true,
    monitorType: true,
    currentMonitorStatus: { name: true, color: true },
  };

  test("monitors worst first: by the priority the project gives each status, the worst of the whole list within the limit", async () => {
    const rows: Array<Monitor> = await readList({
      modelType: Monitor,
      componentType: DashboardComponentType.MonitorList,
      choice: { column: "status", direction: DESC },
      query: { projectId },
      select: MONITOR_SELECT,
      limit: 3,
    });

    expect(names(rows)).toEqual(["billing", "fax", "cdn"]);
    expect(
      rows.map((row: Monitor) => {
        return row.currentMonitorStatus?.name;
      }),
    ).toEqual(["Alarm", "Alarm", "Busy"]);
  });

  test("monitors best first, then by name among equal statuses", async () => {
    expect(
      names(
        await readList({
          modelType: Monitor,
          componentType: DashboardComponentType.MonitorList,
          choice: { column: "status", direction: ASC },
          query: { projectId },
          select: MONITOR_SELECT,
          limit: 25,
        }),
      ),
    ).toEqual(["api", "dns", "gateway", "edge", "cdn", "billing", "fax"]);
  });

  test("monitors saved without a sort list by name, as they always did", async () => {
    expect(
      names(
        await readList({
          modelType: Monitor,
          componentType: DashboardComponentType.MonitorList,
          choice: null,
          query: { projectId },
          select: MONITOR_SELECT,
          limit: 25,
        }),
      ),
    ).toEqual(["api", "billing", "cdn", "dns", "edge", "fax", "gateway"]);
  });

  const INCIDENT_SELECT: JSONObject = {
    _id: true,
    title: true,
    createdAt: true,
    currentIncidentState: { name: true, color: true },
    incidentSeverity: { name: true, color: true },
  };

  test("incidents worst severity first, by the project's own order, newest first within a severity", async () => {
    expect(
      names(
        await readList({
          modelType: Incident,
          componentType: DashboardComponentType.IncidentList,
          choice: { column: "severity", direction: DESC },
          query: { projectId },
          select: INCIDENT_SELECT,
          limit: 4,
        }),
      ),
    ).toEqual([
      "queue backed up",
      "payments lost",
      "checkout down",
      "typo on status page",
    ]);
  });

  test("incidents least progressed state first: identified, acknowledged, resolved", async () => {
    expect(
      names(
        await readList({
          modelType: Incident,
          componentType: DashboardComponentType.IncidentList,
          choice: { column: "state", direction: DESC },
          query: { projectId },
          select: INCIDENT_SELECT,
          limit: 25,
        }),
      ),
    ).toEqual([
      "queue backed up",
      "login slow",
      "typo on status page",
      "checkout down",
      "search flaky",
      "payments lost",
    ]);
  });

  test("incidents saved without a sort list newest first, as they always did", async () => {
    expect(
      names(
        await readList({
          modelType: Incident,
          componentType: DashboardComponentType.IncidentList,
          choice: null,
          query: { projectId },
          select: INCIDENT_SELECT,
          limit: 3,
        }),
      ),
    ).toEqual(["typo on status page", "search flaky", "queue backed up"]);
  });

  const POD_SELECT: JSONObject = {
    _id: true,
    name: true,
    namespaceKey: true,
    phase: true,
    kubernetesCluster: { name: true },
  };

  test("pods worst phase first, rank by rank: failed, unknown, pending, the healthy, then any other phase and none", async () => {
    expect(
      names(
        await readList({
          modelType: KubernetesResource,
          componentType: DashboardComponentType.KubernetesPodList,
          choice: { column: "phase", direction: DESC },
          query: { projectId, kind: "Pod" },
          select: POD_SELECT,
          limit: 25,
        }),
      ),
    ).toEqual([
      // Failed, by namespace then name.
      "etl-2",
      "api-2",
      // Unknown.
      "etl-1",
      // Pending.
      "cache-1",
      // Running and Succeeded.
      "db-1",
      "batch-1",
      "api-1",
      // A phase no rank knows, then none.
      "odd-1",
      "gc-1",
    ]);
  });

  test("pods worst phase first stop at the limit, after reading only the ranks they need", async () => {
    expect(
      names(
        await readList({
          modelType: KubernetesResource,
          componentType: DashboardComponentType.KubernetesPodList,
          choice: { column: "phase", direction: DESC },
          query: { projectId, kind: "Pod" },
          select: POD_SELECT,
          limit: 4,
        }),
      ),
    ).toEqual(["etl-2", "api-2", "etl-1", "cache-1"]);
  });

  test("pods kept to some phases, worst first, within those phases only", async () => {
    expect(
      names(
        await readList({
          modelType: KubernetesResource,
          componentType: DashboardComponentType.KubernetesPodList,
          choice: { column: "phase", direction: DESC },
          query: {
            projectId,
            kind: "Pod",
            phase: new Includes(["Running", "Failed"]),
          },
          select: POD_SELECT,
          limit: 25,
        }),
      ),
    ).toEqual(["etl-2", "api-2", "db-1", "api-1"]);
  });

  test("pods by cluster name, through the relation, then by namespace and name", async () => {
    expect(
      names(
        await readList({
          modelType: KubernetesResource,
          componentType: DashboardComponentType.KubernetesPodList,
          choice: { column: "cluster", direction: DESC },
          query: { projectId, kind: "Pod" },
          select: POD_SELECT,
          limit: 25,
        }),
      ),
    ).toEqual([
      "etl-1",
      "gc-1",
      "api-1",
      "api-2",
      "odd-1",
      "cache-1",
      "db-1",
      "batch-1",
      "etl-2",
    ]);
  });

  test("pods saved without a sort list by namespace, then name, as they always did", async () => {
    expect(
      names(
        await readList({
          modelType: KubernetesResource,
          componentType: DashboardComponentType.KubernetesPodList,
          choice: null,
          query: { projectId, kind: "Pod" },
          select: POD_SELECT,
          limit: 25,
        }),
      ),
    ).toEqual([
      "cache-1",
      "db-1",
      "batch-1",
      "etl-1",
      "etl-2",
      "gc-1",
      "api-1",
      "api-2",
      "odd-1",
    ]);
  });

  const CONTAINER_SELECT: JSONObject = {
    _id: true,
    name: true,
    latestCpuPercent: true,
    dockerHost: { name: true },
  };

  test("containers by CPU highest first, with those that have no reading at the bottom", async () => {
    expect(
      names(
        await readList({
          modelType: DockerResource,
          componentType: DashboardComponentType.DockerContainerList,
          choice: { column: "cpu", direction: DESC },
          query: { projectId, kind: "Container" },
          select: CONTAINER_SELECT,
          limit: 25,
        }),
      ),
    ).toEqual(["charlie", "foxtrot", "alpha", "delta", "bravo", "echo"]);
  });

  test("containers by CPU lowest first, still with no reading at the bottom", async () => {
    expect(
      names(
        await readList({
          modelType: DockerResource,
          componentType: DashboardComponentType.DockerContainerList,
          choice: { column: "cpu", direction: ASC },
          query: { projectId, kind: "Container" },
          select: CONTAINER_SELECT,
          limit: 25,
        }),
      ),
    ).toEqual(["delta", "alpha", "foxtrot", "charlie", "bravo", "echo"]);
  });

  test("Ceph OSDs worst state first: down but in, up but out, down and out, up and in, then missing a flag", async () => {
    const rows: Array<CephResource> = await readList({
      modelType: CephResource,
      componentType: DashboardComponentType.CephOsdList,
      choice: { column: "state", direction: DESC },
      query: { projectId, kind: "Osd" },
      select: {
        _id: true,
        name: true,
        externalId: true,
        isUp: true,
        isIn: true,
        cephCluster: { name: true },
      },
      limit: 25,
    });

    expect(
      rows.map((row: CephResource) => {
        return row.externalId;
      }),
    ).toEqual([
      "osd.1",
      "osd.6",
      "osd.2",
      "osd.3",
      "osd.0",
      "osd.5",
      "osd.4",
      "osd.7",
    ]);
  });

  test("SLOs saved without a sort list least budget first, disabled and unmeasured ones last, as they always did", async () => {
    const select: JSONObject = {
      _id: true,
      name: true,
      isEnabled: true,
      errorBudgetRemainingPercentage: true,
    };

    expect(
      names(
        await readList({
          modelType: ServiceLevelObjective,
          componentType: DashboardComponentType.SloList,
          choice: null,
          query: { projectId },
          select,
          limit: 25,
        }),
      ),
    ).toEqual(["Login", "Checkout", "Search", "Unmeasured", "Frozen"]);

    // Best first: most budget first, disabled still after every enabled one.
    expect(
      names(
        await readList({
          modelType: ServiceLevelObjective,
          componentType: DashboardComponentType.SloList,
          choice: { column: "status", direction: ASC },
          query: { projectId },
          select,
          limit: 25,
        }),
      ),
    ).toEqual(["Search", "Checkout", "Login", "Unmeasured", "Frozen"]);
  });
});
