/* eslint-disable @typescript-eslint/no-explicit-any */
import Entities from "../../../Models/DatabaseModels/Index";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DatabaseServerEndpoint from "../../../Models/DatabaseModels/DatabaseServerEndpoint";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import DatabaseServerEndpointService from "../../../Server/Services/DatabaseServerEndpointService";
import DatabaseServerFeedService from "../../../Server/Services/DatabaseServerFeedService";
import DatabaseServerLabelRuleEngineService from "../../../Server/Services/DatabaseServerLabelRuleEngineService";
import DatabaseServerOwnerRuleEngineService from "../../../Server/Services/DatabaseServerOwnerRuleEngineService";
import DatabaseServerService from "../../../Server/Services/DatabaseServerService";
import logger from "../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import DatabaseServerDiscoverySource from "../../../Types/DatabaseServer/DatabaseServerDiscoverySource";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import { DataSource } from "typeorm";

/*
 * The hand-written Postgres of the Databases product, EXECUTED - not string
 * matched. The unit suites replace manager.query with a mock, so a renamed
 * join table or column (IncidentDatabaseServer, automaticAssignments, ...)
 * would pass them and then fail in production every five minutes, logged
 * and swallowed by DatabaseServer:CleanupStaleResources. Here the real
 * service methods run against structure-only clones of the MIGRATED tables:
 *
 *   - the disconnect sweep, the auto-archive sweep (every "invested" rule,
 *     automatic labels and owners, a person's restore, a dark parent), the
 *     auto-create budget count and the auto-archive restore;
 *   - the automaticAssignments bookkeeping;
 *   - the endpoint lifecycle statements (refresh, hand-over, release) and
 *     a whole workload identity change end to end;
 *   - a person adding an alias through the real create pipeline, label- and
 *     Owned-scoped.
 *
 * Opt in with RUN_POSTGRES_DATABASE_SERVER_SQL_TESTS=true against a Postgres
 * migrated to the current head (the clones copy public.<table>) - the
 * Postgres Schema Drift workflow's database right after its drift check, as
 * for AIInvestigationDecisionPostgres. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from DATABASE_SERVER_SQL_TEST_DATABASE_NAME or
 * DATABASE_NAME, endpoint from DATABASE_SERVER_SQL_TEST_DATABASE_HOST /
 * _PORT (default localhost:5400, Scripts/Dev/docker-compose.dev.yml). Every
 * table and row lives in a
 * unique schema that is dropped afterwards; search_path holds only that
 * schema, so a statement naming a table that was not cloned fails loudly
 * instead of touching real data.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_DATABASE_SERVER_SQL_TESTS"] === "true"
    ? describe
    : describe.skip;

const DAY_MS: number = 24 * 60 * 60 * 1000;
const HOUR_MS: number = 60 * 60 * 1000;

// Tables the SQL under test reads or writes.
const TABLES: Array<string> = [
  "DatabaseServer",
  "DatabaseServerEndpoint",
  "DatabaseServerLabel",
  "DatabaseServerOwnerUser",
  "DatabaseServerOwnerTeam",
  "Label",
  "IncidentDatabaseServer",
  "Incident",
  "AlertDatabaseServer",
  "Alert",
  "ScheduledMaintenanceDatabaseServer",
  "ScheduledMaintenance",
  "KubernetesCluster",
  "DockerHost",
  "PodmanHost",
];

/*
 * Tables only ever seeded by hand here: their NOT NULL columns are relaxed
 * so a fixture names only what the SQL reads. DatabaseServer and
 * DatabaseServerEndpoint keep every constraint - the ORM writes them.
 */
const FIXTURE_TABLES: Array<string> = TABLES.filter((table: string) => {
  return table !== "DatabaseServer" && table !== "DatabaseServerEndpoint";
});

describePostgres("Databases SQL against Postgres", () => {
  const schema: string = `database_server_sql_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  const projectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();
  const userId: ObjectID = ObjectID.generate();
  const teamId: ObjectID = ObjectID.generate();
  let database: DataSource;

  function silence(): void {
    for (const level of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["DATABASE_SERVER_SQL_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["DATABASE_SERVER_SQL_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["DATABASE_SERVER_SQL_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema}` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }
    for (const table of FIXTURE_TABLES) {
      // Primary-key columns (a join table's pair included) stay NOT NULL.
      const columns: Array<{ column_name: string }> = await database.query(
        `SELECT c.column_name FROM information_schema.columns c
        WHERE c.table_schema = $1 AND c.table_name = $2 AND c.is_nullable = 'NO'
          AND c.column_name NOT IN (
            SELECT a.attname FROM pg_index i
            INNER JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
            WHERE i.indrelid = format('%I.%I', $1::text, $2::text)::regclass AND i.indisprimary
          )`,
        [schema, table],
      );
      for (const column of columns) {
        await database.query(
          `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
        );
      }
    }
    expect(
      (await database.query("SELECT current_schema()"))[0].current_schema,
    ).toBe(schema);
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  let feed: jest.SpyInstance;

  beforeEach(async () => {
    silence();
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    feed = jest
      .spyOn(DatabaseServerFeedService, "createDatabaseServerFeedItem")
      .mockResolvedValue(undefined);
    jest
      .spyOn(DatabaseServerService, "getDatabaseServerMarkdownLink")
      .mockResolvedValue("[Database x](/x)");
    jest
      .spyOn(DatabaseServerLabelRuleEngineService, "applyRulesToDatabaseServer")
      .mockResolvedValue(undefined);
    jest
      .spyOn(DatabaseServerOwnerRuleEngineService, "applyRulesToDatabaseServer")
      .mockResolvedValue(undefined);
    for (const service of [
      DatabaseServerService,
      DatabaseServerEndpointService,
    ] as Array<any>) {
      jest.spyOn(service, "onTriggerRealtime").mockResolvedValue(undefined);
      jest.spyOn(service, "onTriggerWorkflow").mockResolvedValue(undefined);
    }
    DatabaseServerService.clearAutoCreateBudgetMemo();
    await database.query(
      TABLES.map((table: string): string => {
        return `DELETE FROM "${schema}"."${table}"`;
      }).join("; "),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function ago(ms: number): Date {
    return new Date(Date.now() - ms);
  }

  async function insertDatabase(data: {
    name?: string;
    project?: ObjectID;
    source?: string;
    lastSeenAt?: Date | null;
    createdAt?: Date;
    isArchived?: boolean;
    autoArchivedAt?: Date | null;
    collectorStatus?: string;
    collectorLastSeenAt?: Date | null;
    retainDays?: number | null;
    retentionConfig?: unknown;
    manuallyRestoredAt?: Date | null;
    automaticAssignments?: unknown;
    kubernetesClusterId?: ObjectID | null;
    dockerHostId?: ObjectID | null;
    podmanHostId?: ObjectID | null;
    workloadIdentifier?: string | null;
    deletedAt?: Date | null;
  }): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    const name: string = data.name || `db-${id.toString().substring(0, 8)}`;
    await database.query(
      `INSERT INTO "${schema}"."DatabaseServer" (
        "_id", "version", "projectId", "name", "slug", "databaseIdentifier",
        "dbSystem", "discoverySource", "lastSeenAt", "createdAt", "isArchived",
        "autoArchivedAt", "otelCollectorStatus", "collectorLastSeenAt",
        "retainTelemetryDataForDays", "telemetryRetentionConfig",
        "manuallyRestoredAt", "automaticAssignments", "kubernetesClusterId",
        "dockerHostId", "podmanHostId", "workloadIdentifier", "deletedAt"
      ) VALUES ($1, 1, $2, $3, $4, $5, 'postgresql', $6, $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
      [
        id.toString(),
        (data.project || projectId).toString(),
        name,
        `${name}-${id.toString()}`,
        `postgresql|${id.toString()}.example.com:5432`,
        data.source === undefined
          ? DatabaseServerDiscoverySource.ClientSpans
          : data.source,
        data.lastSeenAt === undefined ? ago(10 * DAY_MS) : data.lastSeenAt,
        data.createdAt || ago(30 * DAY_MS),
        Boolean(data.isArchived),
        data.autoArchivedAt || null,
        data.collectorStatus || "disconnected",
        data.collectorLastSeenAt || null,
        data.retainDays ?? null,
        data.retentionConfig === undefined
          ? null
          : JSON.stringify(data.retentionConfig),
        data.manuallyRestoredAt || null,
        data.automaticAssignments === undefined
          ? null
          : JSON.stringify(data.automaticAssignments),
        data.kubernetesClusterId?.toString() || null,
        data.dockerHostId?.toString() || null,
        data.podmanHostId?.toString() || null,
        data.workloadIdentifier || null,
        data.deletedAt || null,
      ],
    );
    return id;
  }

  async function insertRow(
    table: string,
    values: Record<string, unknown>,
  ): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    const columns: Array<string> = ["_id", ...Object.keys(values)];
    const parameters: Array<unknown> = [
      id.toString(),
      ...Object.values(values),
    ];
    await database.query(
      `INSERT INTO "${schema}"."${table}" (${columns
        .map((column: string): string => {
          return `"${column}"`;
        })
        .join(", ")}) VALUES (${parameters
        .map((_value: unknown, index: number): string => {
          return `$${index + 1}`;
        })
        .join(", ")})`,
      parameters.map((value: unknown): unknown => {
        return value instanceof ObjectID ? value.toString() : value;
      }),
    );
    return id;
  }

  async function link(
    table: string,
    columns: Record<string, ObjectID>,
  ): Promise<void> {
    const names: Array<string> = Object.keys(columns);
    await database.query(
      `INSERT INTO "${schema}"."${table}" (${names
        .map((name: string): string => {
          return `"${name}"`;
        })
        .join(", ")}) VALUES (${names
        .map((_name: string, index: number): string => {
          return `$${index + 1}`;
        })
        .join(", ")})`,
      Object.values(columns).map((value: ObjectID): string => {
        return value.toString();
      }),
    );
  }

  async function databaseState(id: ObjectID): Promise<any> {
    const rows: Array<any> = await database.query(
      `SELECT * FROM "${schema}"."DatabaseServer" WHERE "_id" = $1`,
      [id.toString()],
    );
    return rows[0];
  }

  async function endpointsOf(id: ObjectID): Promise<Array<any>> {
    return await database.query(
      `SELECT "endpoint", "source", "isPrimary", "lastMatchedAt" FROM "${schema}"."DatabaseServerEndpoint" WHERE "databaseServerId" = $1 ORDER BY "endpoint"`,
      [id.toString()],
    );
  }

  async function insertEndpoint(data: {
    databaseServerId: ObjectID;
    endpoint: string;
    source: string;
    isPrimary?: boolean;
    lastMatchedAt?: Date | null;
    project?: ObjectID;
  }): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    await database.query(
      `INSERT INTO "${schema}"."DatabaseServerEndpoint" ("_id", "version", "projectId", "databaseServerId", "endpoint", "isPrimary", "source", "lastMatchedAt")
      VALUES ($1, 1, $2, $3, $4, $5, $6, $7)`,
      [
        id.toString(),
        (data.project || projectId).toString(),
        data.databaseServerId.toString(),
        data.endpoint,
        Boolean(data.isPrimary),
        data.source,
        data.lastMatchedAt === undefined ? new Date() : data.lastMatchedAt,
      ],
    );
    return id;
  }

  /*
   * -------------------------------------------------------------------------
   * The sweeps
   * -------------------------------------------------------------------------
   */
  test("the disconnect sweep flips only live connected rows whose collector went quiet", async () => {
    const quiet: ObjectID = await insertDatabase({
      collectorStatus: "connected",
      collectorLastSeenAt: ago(HOUR_MS),
    });
    const neverReported: ObjectID = await insertDatabase({
      collectorStatus: "connected",
      collectorLastSeenAt: null,
    });
    const live: ObjectID = await insertDatabase({
      collectorStatus: "connected",
      collectorLastSeenAt: ago(60 * 1000),
    });
    const deleted: ObjectID = await insertDatabase({
      collectorStatus: "connected",
      collectorLastSeenAt: ago(HOUR_MS),
      deletedAt: new Date(),
    });

    await expect(
      DatabaseServerService.markDisconnectedDatabaseServers(),
    ).resolves.toBe(2);

    expect((await databaseState(quiet)).otelCollectorStatus).toBe(
      "disconnected",
    );
    expect((await databaseState(neverReported)).otelCollectorStatus).toBe(
      "disconnected",
    );
    expect((await databaseState(live)).otelCollectorStatus).toBe("connected");
    expect((await databaseState(deleted)).otelCollectorStatus).toBe(
      "connected",
    );
  });

  test("the auto-archive sweep archives exactly the stale rows nobody invested in", async () => {
    const archived: Map<string, ObjectID> = new Map();
    const kept: Map<string, ObjectID> = new Map();

    archived.set("plain stale", await insertDatabase({}));
    kept.set(
      "manual",
      await insertDatabase({ source: DatabaseServerDiscoverySource.Manual }),
    );
    kept.set(
      "seen yesterday",
      await insertDatabase({ lastSeenAt: ago(DAY_MS) }),
    );
    archived.set(
      "never seen, created long ago",
      await insertDatabase({ lastSeenAt: null, createdAt: ago(20 * DAY_MS) }),
    );

    // Labels: a person's count, a rule's / ingest's do not.
    const labelA: ObjectID = await insertRow("Label", {
      projectId: projectId,
      name: "a",
    });
    const labelB: ObjectID = await insertRow("Label", {
      projectId: projectId,
      name: "b",
    });
    const foreignLabel: ObjectID = await insertRow("Label", {
      projectId: otherProjectId,
      name: "x",
    });
    const deletedLabel: ObjectID = await insertRow("Label", {
      projectId: projectId,
      name: "d",
      deletedAt: new Date(),
    });
    const humanLabelled: ObjectID = await insertDatabase({});
    await link("DatabaseServerLabel", {
      databaseServerId: humanLabelled,
      labelId: labelA,
    });
    kept.set("labelled by a person", humanLabelled);
    const ruleLabelled: ObjectID = await insertDatabase({
      automaticAssignments: { labelIds: [labelA.toString()] },
    });
    await link("DatabaseServerLabel", {
      databaseServerId: ruleLabelled,
      labelId: labelA,
    });
    archived.set("labelled only by a rule", ruleLabelled);
    const mixedLabels: ObjectID = await insertDatabase({
      automaticAssignments: { labelIds: [labelA.toString()] },
    });
    await link("DatabaseServerLabel", {
      databaseServerId: mixedLabels,
      labelId: labelA,
    });
    await link("DatabaseServerLabel", {
      databaseServerId: mixedLabels,
      labelId: labelB,
    });
    kept.set("a rule's label plus a person's", mixedLabels);
    const foreignLabelled: ObjectID = await insertDatabase({});
    await link("DatabaseServerLabel", {
      databaseServerId: foreignLabelled,
      labelId: foreignLabel,
    });
    archived.set("labelled from another project", foreignLabelled);
    const deletedLabelled: ObjectID = await insertDatabase({});
    await link("DatabaseServerLabel", {
      databaseServerId: deletedLabelled,
      labelId: deletedLabel,
    });
    archived.set("labelled with a deleted label", deletedLabelled);

    // Owners: the same rule.
    const humanOwned: ObjectID = await insertDatabase({});
    await insertRow("DatabaseServerOwnerUser", {
      projectId: projectId,
      databaseServerId: humanOwned,
      userId: userId,
    });
    kept.set("owned by a person-added user", humanOwned);
    const ruleOwned: ObjectID = await insertDatabase({
      automaticAssignments: {
        ownerUserIds: [userId.toString()],
        ownerTeamIds: [teamId.toString()],
      },
    });
    await insertRow("DatabaseServerOwnerUser", {
      projectId: projectId,
      databaseServerId: ruleOwned,
      userId: userId,
    });
    await insertRow("DatabaseServerOwnerTeam", {
      projectId: projectId,
      databaseServerId: ruleOwned,
      teamId: teamId,
    });
    archived.set("owned only through owner rules", ruleOwned);
    const teamOwned: ObjectID = await insertDatabase({});
    await insertRow("DatabaseServerOwnerTeam", {
      projectId: projectId,
      databaseServerId: teamOwned,
      teamId: teamId,
    });
    kept.set("owned by a person-added team", teamOwned);

    // Incidents, alerts, maintenance.
    const incident: ObjectID = await insertRow("Incident", {
      projectId: projectId,
    });
    const deletedIncident: ObjectID = await insertRow("Incident", {
      projectId: projectId,
      deletedAt: new Date(),
    });
    const alert: ObjectID = await insertRow("Alert", { projectId: projectId });
    const maintenance: ObjectID = await insertRow("ScheduledMaintenance", {
      projectId: projectId,
    });
    const incidentLinked: ObjectID = await insertDatabase({});
    await link("IncidentDatabaseServer", {
      incidentId: incident,
      databaseServerId: incidentLinked,
    });
    kept.set("linked to an incident", incidentLinked);
    const deletedIncidentLinked: ObjectID = await insertDatabase({});
    await link("IncidentDatabaseServer", {
      incidentId: deletedIncident,
      databaseServerId: deletedIncidentLinked,
    });
    archived.set("linked only to a deleted incident", deletedIncidentLinked);
    const alertLinked: ObjectID = await insertDatabase({});
    await link("AlertDatabaseServer", {
      alertId: alert,
      databaseServerId: alertLinked,
    });
    kept.set("linked to an alert", alertLinked);
    const maintenanceLinked: ObjectID = await insertDatabase({});
    await link("ScheduledMaintenanceDatabaseServer", {
      scheduledMaintenanceId: maintenance,
      databaseServerId: maintenanceLinked,
    });
    kept.set("linked to scheduled maintenance", maintenanceLinked);

    // Endpoints and retention.
    const userEndpoint: ObjectID = await insertDatabase({});
    await insertEndpoint({
      databaseServerId: userEndpoint,
      endpoint: `${userEndpoint.toString()}.example.com:5432`,
      source: "user",
    });
    kept.set("with a person-added endpoint", userEndpoint);
    const autoEndpoint: ObjectID = await insertDatabase({});
    await insertEndpoint({
      databaseServerId: autoEndpoint,
      endpoint: `${autoEndpoint.toString()}.example.com:5432`,
      source: "workload",
    });
    archived.set("with discovered endpoints only", autoEndpoint);
    kept.set(
      "with a retention override",
      await insertDatabase({ retainDays: 30 }),
    );
    archived.set(
      "with an empty retention config",
      await insertDatabase({ retentionConfig: {} }),
    );

    // A person's restore.
    kept.set(
      "restored yesterday, unseen since",
      await insertDatabase({ manuallyRestoredAt: ago(DAY_MS) }),
    );
    archived.set(
      "restored beyond the grace period",
      await insertDatabase({
        manuallyRestoredAt: ago(40 * DAY_MS),
        lastSeenAt: ago(50 * DAY_MS),
      }),
    );
    archived.set(
      "restored, seen again, then stale",
      await insertDatabase({
        manuallyRestoredAt: ago(20 * DAY_MS),
        lastSeenAt: ago(10 * DAY_MS),
      }),
    );

    // Parents: a dark parent keeps its databases' last-known state.
    const darkCluster: ObjectID = await insertRow("KubernetesCluster", {
      projectId: projectId,
      lastSeenAt: ago(9 * DAY_MS),
    });
    const liveCluster: ObjectID = await insertRow("KubernetesCluster", {
      projectId: projectId,
      lastSeenAt: new Date(),
    });
    const deletedCluster: ObjectID = await insertRow("KubernetesCluster", {
      projectId: projectId,
      lastSeenAt: ago(9 * DAY_MS),
      deletedAt: new Date(),
    });
    const darkDocker: ObjectID = await insertRow("DockerHost", {
      projectId: projectId,
      lastSeenAt: ago(9 * DAY_MS),
    });
    const darkPodman: ObjectID = await insertRow("PodmanHost", {
      projectId: projectId,
      lastSeenAt: ago(9 * DAY_MS),
    });
    kept.set(
      "workload of a dark cluster",
      await insertDatabase({
        source: DatabaseServerDiscoverySource.Kubernetes,
        kubernetesClusterId: darkCluster,
        lastSeenAt: ago(9 * DAY_MS - 5 * 60 * 1000),
      }),
    );
    archived.set(
      "workload gone well before its cluster went dark",
      await insertDatabase({
        source: DatabaseServerDiscoverySource.Kubernetes,
        kubernetesClusterId: darkCluster,
        lastSeenAt: ago(12 * DAY_MS),
      }),
    );
    archived.set(
      "workload gone from a live cluster",
      await insertDatabase({
        source: DatabaseServerDiscoverySource.Kubernetes,
        kubernetesClusterId: liveCluster,
        lastSeenAt: ago(8 * DAY_MS),
      }),
    );
    archived.set(
      "workload of a deleted cluster",
      await insertDatabase({
        source: DatabaseServerDiscoverySource.Kubernetes,
        kubernetesClusterId: deletedCluster,
        lastSeenAt: ago(9 * DAY_MS),
      }),
    );
    kept.set(
      "container of a dark Docker host",
      await insertDatabase({
        source: DatabaseServerDiscoverySource.Docker,
        dockerHostId: darkDocker,
        lastSeenAt: ago(9 * DAY_MS),
      }),
    );
    kept.set(
      "container of a dark Podman host",
      await insertDatabase({
        source: DatabaseServerDiscoverySource.Podman,
        podmanHostId: darkPodman,
        lastSeenAt: ago(9 * DAY_MS),
      }),
    );

    const personArchived: ObjectID = await insertDatabase({ isArchived: true });

    const count: number =
      await DatabaseServerService.autoArchiveStaleDatabaseServers();

    const unexpected: Array<string> = [];
    for (const [label, id] of archived) {
      const state: any = await databaseState(id);
      if (!state.isArchived || !state.autoArchivedAt) {
        unexpected.push(`${label}: should have been archived`);
      }
    }
    for (const [label, id] of kept) {
      const state: any = await databaseState(id);
      if (state.isArchived) {
        unexpected.push(`${label}: should have been kept`);
      }
    }
    expect(unexpected).toEqual([]);
    expect(count).toBe(archived.size);
    expect(feed).toHaveBeenCalledTimes(archived.size);

    const untouched: any = await databaseState(personArchived);
    expect(untouched.isArchived).toBe(true);
    expect(untouched.autoArchivedAt).toBeNull();
  });

  test("the auto-create budget counts live, non-archived, non-manual rows of the project - collector rows included", async () => {
    await insertDatabase({ source: DatabaseServerDiscoverySource.Collector });
    await insertDatabase({ source: DatabaseServerDiscoverySource.ClientSpans });
    await insertDatabase({ source: DatabaseServerDiscoverySource.Kubernetes });
    await insertDatabase({ source: DatabaseServerDiscoverySource.Manual });
    await insertDatabase({ isArchived: true });
    await insertDatabase({ deletedAt: new Date() });
    await insertDatabase({ project: otherProjectId });

    await expect(
      DatabaseServerService.countAutoCreatedDatabaseServers(projectId),
    ).resolves.toBe(3);
  });

  test("discovery restores only a row it archived itself", async () => {
    const autoArchived: ObjectID = await insertDatabase({
      isArchived: true,
      autoArchivedAt: ago(DAY_MS),
    });
    const personArchived: ObjectID = await insertDatabase({ isArchived: true });
    const service: any = DatabaseServerService;

    for (const id of [autoArchived, personArchived]) {
      const row: DatabaseServer =
        (await DatabaseServerService.findByIdInProject(projectId, id))!;
      await service.restoreIfAutoArchived(row);
    }

    const restored: any = await databaseState(autoArchived);
    expect(restored.isArchived).toBe(false);
    expect(restored.autoArchivedAt).toBeNull();
    expect(restored.archivedAt).toBeNull();
    expect((await databaseState(personArchived)).isArchived).toBe(true);
  });

  test("automatic assignments are recorded deduped and forgotten precisely", async () => {
    const id: ObjectID = await insertDatabase({});
    const a: string = ObjectID.generate().toString();
    const b: string = ObjectID.generate().toString();

    await DatabaseServerService.recordAutomaticAssignments({
      databaseServerId: id,
      kind: "labelIds",
      ids: [a],
    });
    await DatabaseServerService.recordAutomaticAssignments({
      databaseServerId: id,
      kind: "labelIds",
      ids: [a, b],
    });
    await DatabaseServerService.recordAutomaticAssignments({
      databaseServerId: id,
      kind: "ownerTeamIds",
      ids: [b],
    });

    let state: any = (await databaseState(id)).automaticAssignments;
    expect([...state.labelIds].sort()).toEqual([a, b].sort());
    expect(state.ownerTeamIds).toEqual([b]);

    await DatabaseServerService.forgetAutomaticAssignments({
      databaseServerId: id,
      kind: "labelIds",
      ids: [a],
    });
    await DatabaseServerService.forgetAutomaticAssignments({
      databaseServerId: id,
      kind: "ownerUserIds",
      ids: [a],
    });

    state = (await databaseState(id)).automaticAssignments;
    expect(state.labelIds).toEqual([b]);
    expect(state.ownerTeamIds).toEqual([b]);
    expect(state.ownerUserIds).toBeUndefined();

    // A row that never had any stays NULL: a person's label counts as-is.
    const plain: ObjectID = await insertDatabase({});
    await DatabaseServerService.forgetAutomaticAssignments({
      databaseServerId: plain,
      kind: "labelIds",
      ids: [a],
    });
    expect((await databaseState(plain)).automaticAssignments).toBeNull();
  });

  test("an untouched trace-discovered duplicate is found; an invested one or a workload row is not", async () => {
    const untouched: ObjectID = await insertDatabase({
      lastSeenAt: new Date(),
    });
    const invested: ObjectID = await insertDatabase({ lastSeenAt: new Date() });
    const label: ObjectID = await insertRow("Label", {
      projectId: projectId,
      name: "keep",
    });
    await link("DatabaseServerLabel", {
      databaseServerId: invested,
      labelId: label,
    });
    const workload: ObjectID = await insertDatabase({
      workloadIdentifier: "postgresql|kubernetes:c/ns/statefulset/pg",
    });
    const service: any = DatabaseServerService;

    const found: Set<string> = await service.findUntouchedTraceRows(projectId, [
      untouched.toString(),
      invested.toString(),
      workload.toString(),
    ]);

    expect(Array.from(found)).toEqual([untouched.toString()]);
  });

  /*
   * -------------------------------------------------------------------------
   * Endpoint lifecycle statements
   * -------------------------------------------------------------------------
   */
  test("refresh, hand-over and release touch exactly the endpoints they name", async () => {
    const oldRow: ObjectID = await insertDatabase({});
    const newRow: ObjectID = await insertDatabase({});
    const now: Date = new Date();

    const stale: ObjectID = await insertEndpoint({
      databaseServerId: oldRow,
      endpoint: "a.example.com:5432",
      source: "workload",
      lastMatchedAt: ago(3 * HOUR_MS),
    });
    const person: ObjectID = await insertEndpoint({
      databaseServerId: oldRow,
      endpoint: "b.example.com:5432",
      source: "user",
    });
    await insertEndpoint({
      databaseServerId: oldRow,
      endpoint: "c.example.com:5432",
      source: "workload",
      lastMatchedAt: ago(3 * HOUR_MS),
    });
    await insertEndpoint({
      databaseServerId: oldRow,
      endpoint: "primary.example.com:5432",
      source: "workload",
      isPrimary: true,
      lastMatchedAt: ago(3 * HOUR_MS),
    });
    await insertEndpoint({
      databaseServerId: oldRow,
      endpoint: "auto.example.com:5432",
      source: "auto",
      lastMatchedAt: ago(3 * HOUR_MS),
    });

    await DatabaseServerEndpointService.refreshMatchedEndpoints({
      projectId: projectId,
      databaseServerId: oldRow,
      endpoints: ["c.example.com:5432"],
      now: now,
      staleBefore: ago(HOUR_MS),
    });

    // A person's endpoint never moves; a discovered one does, once.
    await expect(
      DatabaseServerEndpointService.transferEndpoint({
        projectId: projectId,
        endpointId: person,
        fromDatabaseServerId: oldRow,
        toDatabaseServerId: newRow,
        isPrimary: false,
        now: now,
      }),
    ).resolves.toBe(false);
    await expect(
      DatabaseServerEndpointService.transferEndpoint({
        projectId: projectId,
        endpointId: stale,
        fromDatabaseServerId: oldRow,
        toDatabaseServerId: newRow,
        isPrimary: true,
        now: now,
      }),
    ).resolves.toBe(true);
    await expect(
      DatabaseServerEndpointService.transferEndpoint({
        projectId: projectId,
        endpointId: stale,
        fromDatabaseServerId: oldRow,
        toDatabaseServerId: newRow,
        isPrimary: true,
        now: now,
      }),
    ).resolves.toBe(false);

    // Nothing kept: only the stale non-primary workload aliases go.
    await expect(
      DatabaseServerEndpointService.releaseUnproducedWorkloadEndpoints({
        projectId: projectId,
        databaseServerId: oldRow,
        keepEndpoints: [],
        staleBefore: ago(2 * HOUR_MS),
      }),
    ).resolves.toEqual([]);

    const oldEndpoints: Array<any> = await endpointsOf(oldRow);
    expect(
      oldEndpoints.map((row: any): string => {
        return row.endpoint;
      }),
    ).toEqual([
      "auto.example.com:5432",
      "b.example.com:5432",
      "c.example.com:5432",
      "primary.example.com:5432",
    ]);
    // "c" was re-stamped by the refresh, so it survived the release.
    const c: any = oldEndpoints.find((row: any) => {
      return row.endpoint === "c.example.com:5432";
    });
    expect(new Date(c.lastMatchedAt).getTime()).toBe(now.getTime());

    const moved: Array<any> = await endpointsOf(newRow);
    expect(moved).toEqual([
      {
        endpoint: "a.example.com:5432",
        source: "workload",
        isPrimary: true,
        lastMatchedAt: now,
      },
    ]);

    // Once "c" is stale again and still not produced, it is released.
    await database.query(
      `UPDATE "${schema}"."DatabaseServerEndpoint" SET "lastMatchedAt" = $1 WHERE "endpoint" = 'c.example.com:5432'`,
      [ago(3 * HOUR_MS)],
    );
    await expect(
      DatabaseServerEndpointService.releaseUnproducedWorkloadEndpoints({
        projectId: projectId,
        databaseServerId: oldRow,
        keepEndpoints: ["primary.example.com:5432"],
        staleBefore: ago(2 * HOUR_MS),
      }),
    ).resolves.toEqual(["c.example.com:5432"]);
  });

  test("a workload identity change hands the Service endpoint to the new workload, end to end", async () => {
    const cluster: ObjectID = await insertRow("KubernetesCluster", {
      projectId: projectId,
      lastSeenAt: new Date(),
    });
    const service: string = "redis.cache.svc.cluster.local:6379@prod";
    const unqualified: string = "redis.cache.svc.cluster.local:6379";

    const deployment: DatabaseServer | null =
      await DatabaseServerService.upsertWorkloadDatabase({
        projectId: projectId,
        workloadIdentifier: "redis|kubernetes:prod/cache/deployment/redis",
        dbSystem: "redis",
        displayName: "Redis cache/redis",
        discoverySource: DatabaseServerDiscoverySource.Kubernetes,
        aliases: [service, unqualified],
        memberKeysSeenNow: [],
        instanceCount: 1,
        kubernetesClusterId: cluster,
        kubernetesNamespace: "cache",
        workloadKind: "Deployment",
        workloadName: "redis",
        allowCreate: true,
      });
    expect(deployment).not.toBeNull();
    expect(await endpointsOf(deployment!.id!)).toEqual([
      expect.objectContaining({
        endpoint: unqualified,
        source: "workload",
        isPrimary: false,
      }),
      expect.objectContaining({
        endpoint: service,
        source: "workload",
        isPrimary: true,
      }),
    ]);

    /*
     * Two hours later: the Deployment is gone, and a second cluster means
     * the unqualified alias is no longer produced.
     */
    await database.query(
      `UPDATE "${schema}"."DatabaseServer" SET "workloadLastSeenAt" = $1 WHERE "_id" = $2`,
      [ago(2 * HOUR_MS), deployment!.id!.toString()],
    );
    await database.query(
      `UPDATE "${schema}"."DatabaseServerEndpoint" SET "lastMatchedAt" = $1`,
      [ago(3 * HOUR_MS)],
    );

    const statefulSet: DatabaseServer | null =
      await DatabaseServerService.upsertWorkloadDatabase({
        projectId: projectId,
        workloadIdentifier: "redis|kubernetes:prod/cache/statefulset/redis",
        dbSystem: "redis",
        displayName: "Redis cache/redis",
        discoverySource: DatabaseServerDiscoverySource.Kubernetes,
        aliases: [service],
        memberKeysSeenNow: [],
        instanceCount: 1,
        kubernetesClusterId: cluster,
        kubernetesNamespace: "cache",
        workloadKind: "StatefulSet",
        workloadName: "redis",
        allowCreate: true,
      });

    expect(statefulSet).not.toBeNull();
    expect(statefulSet!.id!.toString()).not.toBe(deployment!.id!.toString());
    expect(await endpointsOf(statefulSet!.id!)).toEqual([
      expect.objectContaining({
        endpoint: service,
        source: "workload",
        isPrimary: true,
      }),
    ]);
    /*
     * The old row keeps what nobody else serves - until its own workload
     * runs again, nothing releases its unqualified alias.
     */
    expect(
      (await endpointsOf(deployment!.id!)).map((row: any): string => {
        return row.endpoint;
      }),
    ).toEqual([unqualified]);
    const state: any = await databaseState(statefulSet!.id!);
    expect(state.workloadLastSeenAt).not.toBeNull();
    expect(state.dbSystem).toBe("redis");
  });

  test("the same workload under a fork of its engine stays the same database", async () => {
    const cluster: ObjectID = await insertRow("KubernetesCluster", {
      projectId: projectId,
      lastSeenAt: new Date(),
    });
    const input: any = {
      projectId: projectId,
      workloadIdentifier: "redis|kubernetes:prod/cache/statefulset/cache",
      dbSystem: "redis",
      displayName: "Redis cache/cache",
      discoverySource: DatabaseServerDiscoverySource.Kubernetes,
      aliases: ["cache.cache.svc.cluster.local:6379@prod"],
      memberKeysSeenNow: [],
      instanceCount: 1,
      kubernetesClusterId: cluster,
      kubernetesNamespace: "cache",
      workloadKind: "StatefulSet",
      workloadName: "cache",
      allowCreate: true,
    };

    const redis: DatabaseServer | null =
      await DatabaseServerService.upsertWorkloadDatabase(input);
    const valkey: DatabaseServer | null =
      await DatabaseServerService.upsertWorkloadDatabase({
        ...input,
        workloadIdentifier: "valkey|kubernetes:prod/cache/statefulset/cache",
        dbSystem: "valkey",
      });

    expect(valkey!.id!.toString()).toBe(redis!.id!.toString());
    const state: any = await databaseState(redis!.id!);
    expect(state.workloadIdentifier).toBe(
      "valkey|kubernetes:prod/cache/statefulset/cache",
    );
    expect(state.dbSystem).toBe("valkey");
    expect(state.dbSystemSource).toBe("container");
    expect(state.name).toBe("Valkey cache/cache");
    const rows: Array<any> = await database.query(
      `SELECT "_id" FROM "${schema}"."DatabaseServer"`,
    );
    expect(rows).toHaveLength(1);
  });

  test("a workload that stops producing an alias releases it after the grace period", async () => {
    const cluster: ObjectID = await insertRow("KubernetesCluster", {
      projectId: projectId,
      lastSeenAt: new Date(),
    });
    const input: any = {
      projectId: projectId,
      workloadIdentifier: "postgresql|kubernetes:prod/data/statefulset/pg",
      dbSystem: "postgresql",
      displayName: "PostgreSQL data/pg",
      discoverySource: DatabaseServerDiscoverySource.Kubernetes,
      aliases: [
        "pg.data.svc.cluster.local:5432@prod",
        "pg.data.svc.cluster.local:5432",
      ],
      memberKeysSeenNow: [],
      instanceCount: 1,
      kubernetesClusterId: cluster,
      kubernetesNamespace: "data",
      workloadKind: "StatefulSet",
      workloadName: "pg",
      allowCreate: true,
    };

    const row: DatabaseServer | null =
      await DatabaseServerService.upsertWorkloadDatabase(input);

    // Not produced once, but produced recently: kept.
    await DatabaseServerService.upsertWorkloadDatabase({
      ...input,
      aliases: ["pg.data.svc.cluster.local:5432@prod"],
    });
    expect((await endpointsOf(row!.id!)).length).toBe(2);

    await database.query(
      `UPDATE "${schema}"."DatabaseServerEndpoint" SET "lastMatchedAt" = $1 WHERE "endpoint" = 'pg.data.svc.cluster.local:5432'`,
      [ago(3 * HOUR_MS)],
    );
    await DatabaseServerService.upsertWorkloadDatabase({
      ...input,
      aliases: ["pg.data.svc.cluster.local:5432@prod"],
    });

    expect(
      (await endpointsOf(row!.id!)).map((endpoint: any): string => {
        return endpoint.endpoint;
      }),
    ).toEqual(["pg.data.svc.cluster.local:5432@prod"]);
  });

  test("a workload seen again with nothing new is not rewritten; a change is written at once", async () => {
    const cluster: ObjectID = await insertRow("KubernetesCluster", {
      projectId: projectId,
      lastSeenAt: new Date(),
    });
    const input: any = {
      projectId: projectId,
      workloadIdentifier: "mysql|kubernetes:prod/shop/statefulset/orders",
      dbSystem: "mysql",
      displayName: "MySQL shop/orders",
      discoverySource: DatabaseServerDiscoverySource.Kubernetes,
      aliases: ["orders.shop.svc.cluster.local:3306@prod"],
      memberKeysSeenNow: ["0123456789abcdef"],
      instanceCount: 1,
      dbVersion: "8.0",
      kubernetesClusterId: cluster,
      kubernetesNamespace: "shop",
      workloadKind: "StatefulSet",
      workloadName: "orders",
      allowCreate: true,
    };

    const row: DatabaseServer | null =
      await DatabaseServerService.upsertWorkloadDatabase(input);
    const created: any = await databaseState(row!.id!);

    // Every column the workload path reads back exists on the migrated table.
    const again: DatabaseServer | null =
      await DatabaseServerService.upsertWorkloadDatabase(input);
    expect(again!.id!.toString()).toBe(row!.id!.toString());
    const unchanged: any = await databaseState(row!.id!);
    expect(unchanged.updatedAt.toISOString()).toBe(
      created.updatedAt.toISOString(),
    );
    expect(unchanged.lastSeenAt.toISOString()).toBe(
      created.lastSeenAt.toISOString(),
    );
    expect(unchanged.version).toBe(created.version);

    await DatabaseServerService.upsertWorkloadDatabase({
      ...input,
      instanceCount: 3,
      dbSystem: "mariadb",
    });
    const changed: any = await databaseState(row!.id!);
    expect(changed.instanceCount).toBe(3);
    expect(changed.dbSystem).toBe("mariadb");
    expect(changed.name).toBe("MariaDB shop/orders");
    expect(changed.lastSeenAt.getTime()).toBeGreaterThanOrEqual(
      created.lastSeenAt.getTime(),
    );

    // A quarter of an hour on, an unchanged workload refreshes its liveness.
    await database.query(
      `UPDATE "${schema}"."DatabaseServer" SET "lastSeenAt" = $1, "workloadLastSeenAt" = $1 WHERE "_id" = $2`,
      [ago(20 * 60 * 1000), row!.id!.toString()],
    );
    const before: number = Date.now();
    await DatabaseServerService.upsertWorkloadDatabase({
      ...input,
      instanceCount: 3,
      dbSystem: "mariadb",
    });
    const refreshed: any = await databaseState(row!.id!);
    expect(refreshed.workloadLastSeenAt.getTime()).toBeGreaterThanOrEqual(
      before - 1000,
    );
  });

  /*
   * -------------------------------------------------------------------------
   * The collector status is only ever a collector's
   * -------------------------------------------------------------------------
   */
  test("a database found from traces stores no collector status - and the sweep leaves it empty", async () => {
    const traces: DatabaseServer | null =
      await DatabaseServerService.findOrCreateByEndpoint({
        projectId: projectId,
        dbSystem: "postgresql",
        endpoint: { host: "orders-db.example.com", port: 5432 },
        discoverySource: DatabaseServerDiscoverySource.ClientSpans,
        allowCreate: true,
      });
    const collector: DatabaseServer | null =
      await DatabaseServerService.findOrCreateByEndpoint({
        projectId: projectId,
        dbSystem: "postgresql",
        endpoint: { host: "billing-db.example.com", port: 5432 },
        discoverySource: DatabaseServerDiscoverySource.Collector,
        allowCreate: true,
      });

    expect((await databaseState(traces!.id!)).otelCollectorStatus).toBeNull();
    expect((await databaseState(collector!.id!)).otelCollectorStatus).toBe(
      "connected",
    );

    await DatabaseServerService.markDisconnectedDatabaseServers();

    expect((await databaseState(traces!.id!)).otelCollectorStatus).toBeNull();
  });

  /*
   * -------------------------------------------------------------------------
   * The cluster names a manual create's refusal lists
   * -------------------------------------------------------------------------
   */
  test("the cluster names are the project's live clusters, sorted", async () => {
    for (const clusterIdentifier of ["staging", "prod-eu"]) {
      await insertRow("KubernetesCluster", {
        projectId: projectId,
        clusterIdentifier: clusterIdentifier,
      });
    }
    await insertRow("KubernetesCluster", {
      projectId: projectId,
      clusterIdentifier: "decommissioned",
      deletedAt: new Date(),
    });
    await insertRow("KubernetesCluster", {
      projectId: projectId,
      clusterIdentifier: "",
    });
    await insertRow("KubernetesCluster", {
      projectId: otherProjectId,
      clusterIdentifier: "theirs",
    });

    await expect(
      (DatabaseServerService as any).findKubernetesClusterNames(projectId),
    ).resolves.toEqual(["prod-eu", "staging"]);
    await expect(
      (DatabaseServerService as any).findKubernetesClusterNames(
        ObjectID.generate(),
      ),
    ).resolves.toEqual([]);
  });

  /*
   * -------------------------------------------------------------------------
   * A person adding an alias: label- and Owned-scoped edit permission
   * -------------------------------------------------------------------------
   */
  describe("a person adding an alias", () => {
    function scopedProps(
      scope: PermissionScope,
      labelIds: Array<ObjectID> = [],
    ): DatabaseCommonInteractionProps {
      const permissions: Array<UserPermission> = [
        Permission.EditDatabaseServer,
        Permission.ReadDatabaseServer,
      ].map((permission: Permission): UserPermission => {
        return {
          permission,
          labelIds,
          scope,
          isBlockPermission: false,
          _type: "UserPermission",
        };
      });
      return {
        userId: userId,
        tenantId: projectId,
        userGlobalAccessPermission: {
          projectIds: [projectId],
          globalPermissions: [Permission.Public, Permission.User],
          _type: "UserGlobalAccessPermission",
        },
        userTenantAccessPermission: {
          [projectId.toString()]: {
            projectId: projectId,
            permissions: permissions,
            _type: "UserTenantAccessPermission",
          },
        },
        userTeamIds: [],
      };
    }

    function alias(databaseServerId: ObjectID, endpoint: string): any {
      const data: DatabaseServerEndpoint = new DatabaseServerEndpoint();
      data.databaseServerId = databaseServerId;
      data.endpoint = endpoint;
      return data;
    }

    test("a label-scoped editor adds aliases to their label's databases only", async () => {
      const teamA: ObjectID = await insertRow("Label", {
        projectId: projectId,
        name: "team-a",
      });
      const teamB: ObjectID = await insertRow("Label", {
        projectId: projectId,
        name: "team-b",
      });
      const ours: ObjectID = await insertDatabase({ name: "orders (team A)" });
      const theirs: ObjectID = await insertDatabase({
        name: "payments (team B)",
      });
      await link("DatabaseServerLabel", {
        databaseServerId: ours,
        labelId: teamA,
      });
      await link("DatabaseServerLabel", {
        databaseServerId: theirs,
        labelId: teamB,
      });
      await insertEndpoint({
        databaseServerId: theirs,
        endpoint: "taken.example.com:5432",
        source: "auto",
      });

      await DatabaseServerEndpointService.create({
        data: alias(ours, "orders-replica.example.com"),
        props: scopedProps(PermissionScope.Labels, [teamA]),
      });
      expect(
        (await endpointsOf(ours)).map((row: any): string => {
          return row.endpoint;
        }),
      ).toEqual(["orders-replica.example.com:5432"]);

      await expect(
        DatabaseServerEndpointService.create({
          data: alias(theirs, "hijack.example.com"),
          props: scopedProps(PermissionScope.Labels, [teamA]),
        }),
      ).rejects.toThrow("you do not have permission to edit it");
      expect(await endpointsOf(theirs)).toHaveLength(1);

      // The owner of a colliding endpoint is not named to someone who cannot read it.
      const error: Error = (await DatabaseServerEndpointService.create({
        data: alias(ours, "taken.example.com"),
        props: scopedProps(PermissionScope.Labels, [teamA]),
      }).catch((e: unknown) => {
        return e;
      })) as Error;
      expect(error.message).toContain("already belongs to another database");
      expect(error.message).not.toContain("payments");
    });

    test("an Owned-scoped editor adds aliases to databases they own only", async () => {
      const owned: ObjectID = await insertDatabase({ name: "owned" });
      const notOwned: ObjectID = await insertDatabase({ name: "not owned" });
      await insertRow("DatabaseServerOwnerUser", {
        projectId: projectId,
        databaseServerId: owned,
        userId: userId,
      });

      await DatabaseServerEndpointService.create({
        data: alias(owned, "owned-replica.example.com"),
        props: scopedProps(PermissionScope.Owned),
      });
      expect(await endpointsOf(owned)).toHaveLength(1);

      await expect(
        DatabaseServerEndpointService.create({
          data: alias(notOwned, "not-owned-replica.example.com"),
          props: scopedProps(PermissionScope.Owned),
        }),
      ).rejects.toThrow("you do not have permission to edit it");
      expect(await endpointsOf(notOwned)).toHaveLength(0);
    });

    test("a relation object cannot point an alias at another project's database", async () => {
      const foreign: ObjectID = await insertDatabase({
        project: otherProjectId,
      });
      const ours: ObjectID = await insertDatabase({});
      const data: any = alias(ours, "cross.example.com");
      data.databaseServer = new DatabaseServer(foreign);

      await expect(
        DatabaseServerEndpointService.create({
          data: data,
          props: scopedProps(PermissionScope.All),
        }),
      ).rejects.toThrow("Conflicting database references");

      const onlyRelation: any = new DatabaseServerEndpoint();
      onlyRelation.endpoint = "cross.example.com";
      onlyRelation.databaseServer = new DatabaseServer(foreign);
      await expect(
        DatabaseServerEndpointService.create({
          data: onlyRelation,
          props: scopedProps(PermissionScope.All),
        }),
      ).rejects.toThrow("you do not have permission to edit it");

      const rows: Array<any> = await database.query(
        `SELECT "_id" FROM "${schema}"."DatabaseServerEndpoint"`,
      );
      expect(rows).toHaveLength(0);
    });

    test("an alias the form cannot use is refused with what to change, and nothing is written", async () => {
      const ours: ObjectID = await insertDatabase({});

      await expect(
        DatabaseServerEndpointService.create({
          data: alias(ours, "admin@10.0.0.5:5432"),
          props: scopedProps(PermissionScope.All),
        }),
      ).rejects.toThrow('Remove "admin@"');
      await expect(
        DatabaseServerEndpointService.create({
          data: alias(ours, "orders-db.example.com:70000"),
          props: scopedProps(PermissionScope.All),
        }),
      ).rejects.toThrow("has a port outside 1-65535");
      expect(await endpointsOf(ours)).toHaveLength(0);
    });
  });

  /*
   * -------------------------------------------------------------------------
   * A person adding a database: the real create pipeline
   * -------------------------------------------------------------------------
   */
  describe("a person adding a database", () => {
    beforeEach(() => {
      // The Created feed item names its creator from the User table, not cloned here.
      jest
        .spyOn(DatabaseServerService as any, "writeDatabaseServerCreatedFeed")
        .mockResolvedValue(undefined);
    });

    function creatorProps(): DatabaseCommonInteractionProps {
      return {
        userId: userId,
        tenantId: projectId,
        userGlobalAccessPermission: {
          projectIds: [projectId],
          globalPermissions: [Permission.Public, Permission.User],
          _type: "UserGlobalAccessPermission",
        },
        userTenantAccessPermission: {
          [projectId.toString()]: {
            projectId: projectId,
            permissions: [
              Permission.CreateDatabaseServer,
              Permission.ReadDatabaseServer,
            ].map((permission: Permission): UserPermission => {
              return {
                permission,
                labelIds: [],
                isBlockPermission: false,
                _type: "UserPermission",
              };
            }),
            _type: "UserTenantAccessPermission",
          },
        },
        userTeamIds: [],
      };
    }

    function manual(serverAddress: string): DatabaseServer {
      const data: DatabaseServer = new DatabaseServer();
      data.dbSystem = "postgresql";
      data.serverAddress = serverAddress;
      return data;
    }

    test("an unqualified Kubernetes Service name is refused in a project with clusters, naming them", async () => {
      await insertRow("KubernetesCluster", {
        projectId: projectId,
        clusterIdentifier: "prod-eu",
      });

      await expect(
        DatabaseServerService.create({
          data: manual("pg.shop.svc.cluster.local"),
          props: creatorProps(),
        }),
      ).rejects.toThrow(
        "for example pg.shop.svc.cluster.local:5432@prod-eu (this project's clusters: prod-eu)",
      );
      const rows: Array<any> = await database.query(
        `SELECT "_id" FROM "${schema}"."DatabaseServer"`,
      );
      expect(rows).toHaveLength(0);

      const created: DatabaseServer = await DatabaseServerService.create({
        data: manual("pg.shop.svc.cluster.local@prod-eu"),
        props: creatorProps(),
      });
      expect((await databaseState(created.id!)).databaseIdentifier).toBe(
        "postgresql|pg.shop.svc.cluster.local:5432@prod-eu",
      );
      expect(await endpointsOf(created.id!)).toEqual([
        expect.objectContaining({
          endpoint: "pg.shop.svc.cluster.local:5432@prod-eu",
          source: "user",
          isPrimary: true,
        }),
      ]);
      // ...and a database found from traces has no collector status.
      expect((await databaseState(created.id!)).otelCollectorStatus).toBeNull();
    });

    test("the same name is accepted as typed in a project without clusters, and a private IP always is", async () => {
      await insertRow("KubernetesCluster", {
        projectId: otherProjectId,
        clusterIdentifier: "theirs",
      });

      const service: DatabaseServer = await DatabaseServerService.create({
        data: manual("pg.shop.svc.cluster.local"),
        props: creatorProps(),
      });
      expect((await databaseState(service.id!)).databaseIdentifier).toBe(
        "postgresql|pg.shop.svc.cluster.local:5432",
      );

      await insertRow("KubernetesCluster", {
        projectId: projectId,
        clusterIdentifier: "prod-eu",
      });
      const privateIp: DatabaseServer = await DatabaseServerService.create({
        data: manual("10.0.1.5"),
        props: creatorProps(),
      });
      expect((await databaseState(privateIp.id!)).databaseIdentifier).toBe(
        "postgresql|10.0.1.5:5432",
      );
    });
  });
});
