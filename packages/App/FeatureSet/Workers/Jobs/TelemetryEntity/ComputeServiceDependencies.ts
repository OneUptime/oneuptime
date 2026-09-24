import RunCron from "../../Utils/Cron";
import AutoCreateBudget from "../DatabaseServer/AutoCreateBudget";
import logger from "Common/Server/Utils/Logger";
import SpanService from "Common/Server/Services/SpanService";
import MetricService from "Common/Server/Services/MetricService";
import ServiceService from "Common/Server/Services/ServiceService";
import InventoryItemService from "Common/Server/Services/InventoryItemService";
import InventoryItemRelationshipService from "Common/Server/Services/InventoryItemRelationshipService";
import DatabaseServerService from "Common/Server/Services/DatabaseServerService";
import DatabaseServerEndpointService, {
  DatabaseServerEndpointClaimResult,
} from "Common/Server/Services/DatabaseServerEndpointService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Service from "Common/Models/DatabaseModels/Service";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import DatabaseServerEndpoint from "Common/Models/DatabaseModels/DatabaseServerEndpoint";
import Includes from "Common/Types/BaseDatabase/Includes";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import DatabaseServerDiscoverySource from "Common/Types/DatabaseServer/DatabaseServerDiscoverySource";
import {
  DatabaseEndpoint,
  formatDatabaseEndpoint,
  getDatabaseEndpointScope,
} from "Common/Types/DatabaseServer/DatabaseEndpoint";
import EntityType from "Common/Types/Telemetry/EntityType";
import { EntityRelationshipEdge } from "Common/Utils/Telemetry/EntityRelationship";
import {
  canonicalizeEntityValue,
  keyForService,
} from "Common/Utils/Telemetry/EntityKey";
import { ExtractedEntity } from "Common/Server/Utils/Telemetry/TelemetryEntity";
import {
  ClientSpanDependencyRow,
  DependencyEdgeCollector,
  DependencyQueryWindow,
  DependencyTarget,
  QUERY_SETTINGS,
  ServiceGraphMetricRow,
  TraceLinkedDependencyRow,
  buildClientSpanDependencySql,
  buildServiceGraphMetricSql,
  buildTraceLinkedDependencySql,
  isUuid,
  mergeDependencySources,
  resolveClientSpanTarget,
  resolveServiceGraphPeer,
  toEdgeMetrics,
  toExtractedDependencyEntity,
} from "Common/Server/Utils/Telemetry/ServiceDependencyDiscovery";
import {
  DatabaseEndpointRow,
  DiscoveredDatabaseEndpoint,
  buildDatabaseEndpointSql,
  getDatabaseServerMinCalls,
  getDiscoveredDatabaseEndpoints,
  isDatabaseEndpointAutoCreateCandidate,
  resolveDatabaseEndpointRows,
} from "Common/Server/Utils/Telemetry/DatabaseEndpointDiscovery";

/*
 * "TelemetryEntity:ComputeServiceDependencies"
 *
 * Every ~10 minutes, derive the `depends-on` edges of the Service Map from
 * the recent telemetry window and upsert them — plus a registry row for every
 * database and remote endpoint they point at — through the same reconcile
 * scaffold as the co-occurrence graph (forward-only, lastSeenAt-bumped,
 * pruned by TTL).
 *
 * Edges come from three sources, precise first (see
 * ServiceDependencyDiscovery for why one source was not enough):
 *
 *   1. trace-linked calls   — SERVER/CONSUMER spans whose parent is another
 *                             service's span;
 *   2. unanswered clients   — CLIENT/PRODUCER spans into a database, broker
 *                             or endpoint that reported nothing itself;
 *   3. service graph metrics — eBPF `traces_service_graph_request_total`.
 *
 * A service's entity key hashes its NAME (keyForService), so span
 * primaryEntityIds are resolved to Service rows and the registry's service
 * rows are matched by name — never by id.
 *
 * The same window also feeds the Databases product: the database endpoints
 * DB CLIENT spans call are matched to their DatabaseServer rows (created,
 * conservatively, when new) and sighted — see
 * discoverDatabaseServersForProject. That step is isolated from the edges:
 * it neither changes the dependency queries nor the Database registry
 * identity above, and neither side's failure costs the other its run. It
 * runs after the dependency queries rather than beside them, so a project
 * never has its two attribute-map scans of the window in flight at once.
 */

// CronTime.ts has no ten-minute constant; this job is its only user.
const EVERY_TEN_MINUTES: string = "*/10 * * * *";

// Look slightly past the cron period so a slow/missed run leaves no gap.
export const WINDOW_MINUTES: number = 15;

const MAX_ENTRY_SPANS: number = 500000;
const MAX_ROWS_PER_SOURCE: number = 1000;
const MAX_PROJECTS_PER_RUN: number = 1000;
// Grouped database endpoint rows read per project per run, busiest first.
export const MAX_DATABASE_ENDPOINT_ROWS: number = 500;

interface JsonResultSet<T> {
  json: () => Promise<{ data: Array<T> }>;
}

async function readRows<T>(execute: Promise<unknown>): Promise<Array<T>> {
  const resultSet: JsonResultSet<T> =
    (await execute) as unknown as JsonResultSet<T>;
  const parsed: { data: Array<T> } = await resultSet.json();
  return Array.isArray(parsed?.data) ? parsed.data : [];
}

async function findProjectsWithRecentTelemetry(window: {
  startSql: string;
  endSql: string;
}): Promise<Array<string>> {
  const spanSql: string = `
    SELECT DISTINCT projectId
    FROM oneuptime.SpanItemV3
    WHERE startTime >= ${window.startSql}
      AND startTime < ${window.endSql}
    LIMIT ${MAX_PROJECTS_PER_RUN}
    ${QUERY_SETTINGS}
  `;
  const metricSql: string = `
    SELECT DISTINCT projectId
    FROM oneuptime.MetricItemV3
    WHERE name = 'traces_service_graph_request_total'
      AND time >= ${window.startSql}
      AND time < ${window.endSql}
    LIMIT ${MAX_PROJECTS_PER_RUN}
    ${QUERY_SETTINGS}
  `;

  const [spanProjects, metricProjects]: [
    Array<{ projectId: string }>,
    Array<{ projectId: string }>,
  ] = await Promise.all([
    readRows<{ projectId: string }>(SpanService.executeQuery(spanSql)),
    readRows<{ projectId: string }>(
      MetricService.executeQuery(metricSql),
    ).catch((err: unknown): Array<{ projectId: string }> => {
      // Metrics are an optional source; never let them block span edges.
      logger.error(
        `ComputeServiceDependencies: service graph project scan failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }),
  ]);

  return Array.from(
    new Set<string>(
      [...spanProjects, ...metricProjects]
        .map((row: { projectId: string }): string => {
          return row.projectId;
        })
        .filter(isUuid),
    ),
  );
}

/** Registry service rows by canonical name → entity key. */
async function loadServiceEntityKeys(
  projectId: string,
): Promise<Map<string, string>> {
  const rows: Array<InventoryItem> = await InventoryItemService.findBy({
    query: {
      projectId: new ObjectID(projectId),
      entityType: EntityType.Service,
    },
    select: { entityKey: true, displayName: true },
    skip: 0,
    limit: LIMIT_MAX,
    props: { isRoot: true },
  });

  const keyByName: Map<string, string> = new Map<string, string>();
  for (const row of rows) {
    const name: string = canonicalizeEntityValue(row.displayName || "");
    if (!name || !row.entityKey) {
      continue;
    }
    /*
     * Several registry rows can share a name (service.namespace is part of
     * service identity). Prefer the namespace-less one, whose key is exactly
     * keyForService(name); otherwise keep the first seen.
     */
    const plainKey: string = keyForService(projectId, name);
    if (!keyByName.has(name) || row.entityKey === plainKey) {
      keyByName.set(name, row.entityKey);
    }
  }
  return keyByName;
}

interface DatabaseEndpointMatch {
  // The rows the database's endpoints belong to: usually one, else none.
  rows: Array<DatabaseServer>;
  created: boolean;
  // A create the policy allowed but the project's auto-create budget refused.
  overBudget: boolean;
}

/*
 * endpoint → owning databaseServerId for every endpoint of the window that
 * already belongs to a database: ONE indexed query per project and run
 * instead of a lookup per endpoint. The endpoints nothing owns and nothing
 * may create (IP literals, local names, quiet or unknown engines — most of
 * a busy window) then cost no Postgres round trip at all.
 */
async function findDatabaseEndpointOwners(
  projectId: ObjectID,
  endpoints: Array<string>,
): Promise<Map<string, string>> {
  const owners: Map<string, string> = new Map<string, string>();

  if (endpoints.length === 0) {
    return owners;
  }

  const rows: Array<DatabaseServerEndpoint> =
    await DatabaseServerEndpointService.findBy({
      query: {
        projectId: projectId,
        endpoint: QueryHelper.any(endpoints),
      },
      select: {
        endpoint: true,
        databaseServerId: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    });

  for (const row of rows) {
    if (row.endpoint && row.databaseServerId) {
      owners.set(row.endpoint, row.databaseServerId.toString());
    }
  }

  return owners;
}

/*
 * The other endpoints of one logical database (the members of a managed
 * cluster) become aliases of its row — "auto", only the global-scope ones
 * (a local endpoint never auto-matches anything) and only while nobody owns
 * them: an endpoint another row claimed first stays with it.
 */
async function claimSiblingEndpoints(data: {
  projectId: ObjectID;
  databaseServerId: ObjectID;
  endpoints: Array<DatabaseEndpoint>;
  owners: Map<string, string>;
}): Promise<void> {
  for (const endpoint of data.endpoints) {
    const formatted: string = formatDatabaseEndpoint(endpoint);

    if (
      data.owners.has(formatted) ||
      getDatabaseEndpointScope(endpoint) !== "global"
    ) {
      continue;
    }

    try {
      const result: DatabaseServerEndpointClaimResult =
        await DatabaseServerEndpointService.claimEndpoint({
          projectId: data.projectId,
          databaseServerId: data.databaseServerId,
          endpoint: formatted,
          isPrimary: false,
          source: "auto",
        });

      if (result !== "owned-by-other") {
        data.owners.set(formatted, data.databaseServerId.toString());
      }
    } catch (err) {
      logger.error(
        `ComputeServiceDependencies: claiming endpoint ${formatted} for database ${data.databaseServerId.toString()} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

/*
 * One discovered database → its DatabaseServer row(s). `owners` (one query
 * for the whole run) says which of its endpoints already belong to a row:
 *
 *   - owned: each owned endpoint is looked up WITHOUT permission to create
 *     (the steady state, which also restores a row auto-archived while it
 *     was quiet), and when they all belong to one row its still-unowned
 *     siblings are claimed for it;
 *   - unowned: only an endpoint that passes the conservative create policy
 *     asks the project's auto-create budget (see AutoCreateBudget) and is
 *     created — named after the cluster for a managed cluster, whose other
 *     members it then claims. Anything else is not looked up at all.
 */
async function matchDatabaseServerForEndpoint(data: {
  projectId: ObjectID;
  discovered: DiscoveredDatabaseEndpoint;
  owners: Map<string, string>;
  minCalls: number;
  budget: AutoCreateBudget;
}): Promise<DatabaseEndpointMatch> {
  const endpoints: Array<DatabaseEndpoint> = getDiscoveredDatabaseEndpoints(
    data.discovered,
  );

  const lookup: (
    endpoint: DatabaseEndpoint,
    allowCreate: boolean,
  ) => Promise<DatabaseServer | null> = (
    endpoint: DatabaseEndpoint,
    allowCreate: boolean,
  ): Promise<DatabaseServer | null> => {
    return DatabaseServerService.findOrCreateByEndpoint({
      projectId: data.projectId,
      dbSystem: data.discovered.system,
      endpoint: endpoint,
      discoverySource: DatabaseServerDiscoverySource.ClientSpans,
      displayName: allowCreate ? data.discovered.displayName : undefined,
      allowCreate: allowCreate,
    });
  };

  const ownerIds: Set<string> = new Set<string>();
  const owned: Array<DatabaseEndpoint> = [];
  for (const endpoint of endpoints) {
    const ownerId: string | undefined = data.owners.get(
      formatDatabaseEndpoint(endpoint),
    );
    if (ownerId) {
      ownerIds.add(ownerId);
      owned.push(endpoint);
    }
  }

  if (owned.length > 0) {
    const rows: Array<DatabaseServer> = [];
    const rowIds: Set<string> = new Set<string>();

    for (const endpoint of owned) {
      const row: DatabaseServer | null = await lookup(endpoint, false);
      const rowId: string | undefined = row?.id?.toString();
      if (row && rowId && !rowIds.has(rowId)) {
        rowIds.add(rowId);
        rows.push(row);
      }
    }

    // Every owned member belongs to one database: the rest join it.
    if (ownerIds.size === 1 && rows.length === 1 && rows[0]!.id) {
      await claimSiblingEndpoints({
        projectId: data.projectId,
        databaseServerId: rows[0]!.id,
        endpoints: endpoints,
        owners: data.owners,
      });
    }

    return { rows: rows, created: false, overBudget: false };
  }

  if (
    !isDatabaseEndpointAutoCreateCandidate({
      discovered: data.discovered,
      minCalls: data.minCalls,
    })
  ) {
    return { rows: [], created: false, overBudget: false };
  }

  if (!(await data.budget.allowsCreate(data.projectId))) {
    return { rows: [], created: false, overBudget: true };
  }

  const created: DatabaseServer | null = await lookup(
    data.discovered.endpoint,
    true,
  );

  if (!created) {
    return { rows: [], created: false, overBudget: false };
  }

  data.budget.recordCreate(data.projectId);

  if (created.id) {
    data.owners.set(
      formatDatabaseEndpoint(data.discovered.endpoint),
      created.id.toString(),
    );
    await claimSiblingEndpoints({
      projectId: data.projectId,
      databaseServerId: created.id,
      endpoints: endpoints,
      owners: data.owners,
    });
  }

  return { rows: [created], created: true, overBudget: false };
}

/**
 * Databases from client spans: every database the project's DB CLIENT
 * spans called in the window is matched to its DatabaseServer row —
 * created when new, busy enough, global-scope, named by host and of an
 * auto-creatable engine, within budget — and that row is sighted
 * (lastSeenAt) once. The members of one managed cluster are one database.
 * Which endpoints already have a row is read in one query up front. Each
 * database is isolated from the next, and the whole step from the
 * dependency sources: it never throws. Returns how many rows were sighted.
 */
export async function discoverDatabaseServersForProject(args: {
  projectId: string;
  startSql: string;
  endSql: string;
}): Promise<number> {
  try {
    const rows: Array<DatabaseEndpointRow> =
      await readRows<DatabaseEndpointRow>(
        SpanService.executeQuery(
          buildDatabaseEndpointSql({
            projectId: args.projectId,
            startSql: args.startSql,
            endSql: args.endSql,
            maxRows: MAX_DATABASE_ENDPOINT_ROWS,
          }),
        ),
      );

    if (rows.length >= MAX_DATABASE_ENDPOINT_ROWS) {
      logger.warn(
        `ComputeServiceDependencies: project ${args.projectId} called at least ${MAX_DATABASE_ENDPOINT_ROWS} database endpoint groups in the window; only the first ${MAX_DATABASE_ENDPOINT_ROWS} (host names before IP addresses, then the busiest) were matched to databases this run`,
      );
    }

    const endpoints: Array<DiscoveredDatabaseEndpoint> =
      resolveDatabaseEndpointRows(rows);

    if (endpoints.length === 0) {
      return 0;
    }

    const projectId: ObjectID = new ObjectID(args.projectId);
    const minCalls: number = getDatabaseServerMinCalls();
    const budget: AutoCreateBudget = new AutoCreateBudget();

    const owners: Map<string, string> = await findDatabaseEndpointOwners(
      projectId,
      Array.from(
        new Set<string>(
          endpoints
            .flatMap(getDiscoveredDatabaseEndpoints)
            .map((endpoint: DatabaseEndpoint): string => {
              return formatDatabaseEndpoint(endpoint);
            }),
        ),
      ),
    );

    const sightedIds: Set<string> = new Set<string>();
    let created: number = 0;
    let overBudget: number = 0;

    for (const discovered of endpoints) {
      try {
        const result: DatabaseEndpointMatch =
          await matchDatabaseServerForEndpoint({
            projectId: projectId,
            discovered: discovered,
            owners: owners,
            minCalls: minCalls,
            budget: budget,
          });

        if (result.overBudget) {
          overBudget++;
        }

        if (result.created) {
          created++;
        }

        // A row several endpoints belong to is sighted once.
        for (const row of result.rows) {
          const rowId: string | undefined = row.id?.toString();
          if (!row.id || !rowId || sightedIds.has(rowId)) {
            continue;
          }
          await DatabaseServerService.recordSighting(row.id);
          sightedIds.add(rowId);
        }
      } catch (err) {
        logger.error(
          `ComputeServiceDependencies: database endpoint ${formatDatabaseEndpoint(discovered.endpoint)} failed for project ${args.projectId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (overBudget > 0) {
      logger.warn(
        `ComputeServiceDependencies: ${overBudget} new database endpoint(s) called by client spans were not created because project ${args.projectId} reached its auto-create budget (DATABASE_SERVER_AUTO_CREATE_BUDGET)`,
      );
    }

    if (sightedIds.size > 0) {
      logger.debug(
        `ComputeServiceDependencies: sighted ${sightedIds.size} database(s) (${created} new) from client spans for project ${args.projectId}.`,
      );
    }

    return sightedIds.size;
  } catch (err) {
    logger.error(
      `ComputeServiceDependencies: database endpoint discovery failed for project ${args.projectId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 0;
  }
}

export async function computeDependenciesForProject(args: {
  projectId: string;
  startSql: string;
  endSql: string;
}): Promise<number> {
  const window: DependencyQueryWindow = {
    projectId: args.projectId,
    startSql: args.startSql,
    endSql: args.endSql,
    maxEntrySpans: MAX_ENTRY_SPANS,
    maxRows: MAX_ROWS_PER_SOURCE,
  };

  const runSource: <T>(
    name: string,
    run: () => Promise<Array<T>>,
  ) => Promise<Array<T>> = async <T>(
    name: string,
    run: () => Promise<Array<T>>,
  ): Promise<Array<T>> => {
    try {
      return await run();
    } catch (err) {
      // One failing source must not cost the project the other two.
      logger.error(
        `ComputeServiceDependencies: ${name} failed for project ${args.projectId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  };

  const [traceRows, clientRows, graphRows]: [
    Array<TraceLinkedDependencyRow>,
    Array<ClientSpanDependencyRow>,
    Array<ServiceGraphMetricRow>,
  ] = await Promise.all([
    runSource<TraceLinkedDependencyRow>("trace-linked calls", () => {
      return readRows<TraceLinkedDependencyRow>(
        SpanService.executeQuery(buildTraceLinkedDependencySql(window)),
      );
    }),
    runSource<ClientSpanDependencyRow>("client span dependencies", () => {
      return readRows<ClientSpanDependencyRow>(
        SpanService.executeQuery(buildClientSpanDependencySql(window)),
      );
    }),
    runSource<ServiceGraphMetricRow>("service graph metrics", () => {
      return readRows<ServiceGraphMetricRow>(
        MetricService.executeQuery(
          buildServiceGraphMetricSql({
            projectId: args.projectId,
            startSql: args.startSql,
            endSql: args.endSql,
            maxRows: MAX_ROWS_PER_SOURCE,
          }),
        ),
      );
    }),
  ]);

  /*
   * Databases from the same window: after the dependency scans rather than
   * beside them (both read the window's attribute maps), and before anything
   * below can return early, so it runs whether or not the window produced a
   * single edge. It never rejects.
   */
  await discoverDatabaseServersForProject({
    projectId: args.projectId,
    startSql: args.startSql,
    endSql: args.endSql,
  });

  if (
    traceRows.length === 0 &&
    clientRows.length === 0 &&
    graphRows.length === 0
  ) {
    return 0;
  }

  /*
   * Span rows name services by Service row id; resolve every id either
   * source mentions to its name once.
   */
  const serviceIds: Array<string> = Array.from(
    new Set<string>([
      ...traceRows.flatMap((row: TraceLinkedDependencyRow): Array<string> => {
        return [row.callerServiceId, row.calleeServiceId];
      }),
      ...clientRows.map((row: ClientSpanDependencyRow): string => {
        return row.callerServiceId;
      }),
    ]),
  ).filter(isUuid);

  const services: Array<Service> =
    serviceIds.length > 0
      ? await ServiceService.findBy({
          query: {
            projectId: new ObjectID(args.projectId),
            _id: new Includes(serviceIds),
          },
          select: { _id: true, name: true },
          skip: 0,
          limit: LIMIT_MAX,
          props: { isRoot: true },
        })
      : [];

  const serviceKeyByName: Map<string, string> = await loadServiceEntityKeys(
    args.projectId,
  );
  const knownServiceNames: Set<string> = new Set<string>(
    serviceKeyByName.keys(),
  );

  const keyForServiceName: (name: string) => string = (
    name: string,
  ): string => {
    const canonical: string = canonicalizeEntityValue(name);
    return (
      serviceKeyByName.get(canonical) || keyForService(args.projectId, name)
    );
  };

  const serviceKeyById: Map<string, string> = new Map<string, string>();
  for (const service of services) {
    if (service._id && service.name) {
      serviceKeyById.set(
        service._id.toString(),
        keyForServiceName(service.name),
      );
    }
  }

  const dependencyEntities: Map<string, ExtractedEntity> = new Map<
    string,
    ExtractedEntity
  >();
  const keyForTarget: (target: DependencyTarget) => string = (
    target: DependencyTarget,
  ): string => {
    if (target.kind === "service") {
      return keyForServiceName(target.serviceName);
    }
    const entity: ExtractedEntity = toExtractedDependencyEntity({
      projectId: args.projectId,
      entity: target.entity,
    });
    dependencyEntities.set(entity.entityKey, entity);
    return entity.entityKey;
  };

  const traced: DependencyEdgeCollector = new DependencyEdgeCollector();
  for (const row of traceRows) {
    const fromEntityKey: string | undefined = serviceKeyById.get(
      row.callerServiceId,
    );
    const toEntityKey: string | undefined = serviceKeyById.get(
      row.calleeServiceId,
    );
    if (fromEntityKey && toEntityKey) {
      traced.add({ fromEntityKey, toEntityKey, metrics: toEdgeMetrics(row) });
    }
  }

  const inferred: DependencyEdgeCollector = new DependencyEdgeCollector();
  for (const row of clientRows) {
    const fromEntityKey: string | undefined = serviceKeyById.get(
      row.callerServiceId,
    );
    const target: DependencyTarget | null = resolveClientSpanTarget(
      row,
      knownServiceNames,
    );
    if (fromEntityKey && target) {
      inferred.add({
        fromEntityKey,
        toEntityKey: keyForTarget(target),
        metrics: toEdgeMetrics(row),
      });
    }
  }

  const graphed: DependencyEdgeCollector = new DependencyEdgeCollector();
  for (const row of graphRows) {
    const client: DependencyTarget | null = resolveServiceGraphPeer(
      row.client,
      knownServiceNames,
    );
    const server: DependencyTarget | null = resolveServiceGraphPeer(
      row.server,
      knownServiceNames,
    );
    // An edge needs a service on the calling side to belong on a service map.
    if (!client || client.kind !== "service" || !server) {
      continue;
    }
    graphed.add({
      fromEntityKey: keyForTarget(client),
      toEntityKey: keyForTarget(server),
      metrics: toEdgeMetrics({
        callCount: row.requestCount,
        errorCount: row.failedCount,
      }),
    });
  }

  const edges: Array<EntityRelationshipEdge> = mergeDependencySources([
    traced.edges(),
    inferred.edges(),
    graphed.edges(),
  ]);

  if (edges.length === 0) {
    return 0;
  }

  /*
   * Register the endpoints first, and only those an edge still references,
   * so no edge is written pointing at a row that does not exist.
   */
  const referenced: Set<string> = new Set<string>(
    edges.flatMap((edge: EntityRelationshipEdge): Array<string> => {
      return [edge.fromEntityKey, edge.toEntityKey];
    }),
  );
  const entities: Array<ExtractedEntity> = Array.from(
    dependencyEntities.values(),
  ).filter((entity: ExtractedEntity): boolean => {
    return referenced.has(entity.entityKey);
  });
  if (entities.length > 0) {
    await InventoryItemService.reconcileEntities({
      projectId: new ObjectID(args.projectId),
      entities,
    });
  }

  await InventoryItemRelationshipService.reconcileRelationships({
    projectId: new ObjectID(args.projectId),
    edges,
  });

  return edges.length;
}

RunCron(
  "TelemetryEntity:ComputeServiceDependencies",
  { schedule: EVERY_TEN_MINUTES, runOnStartup: false },
  async () => {
    try {
      const endTime: Date = OneUptimeDate.getCurrentDate();
      const startTime: Date = OneUptimeDate.getSomeMinutesAgo(WINDOW_MINUTES);

      const startSql: string = `toDateTime64('${OneUptimeDate.toClickhouseDateTime64(startTime)}', 9)`;
      const endSql: string = `toDateTime64('${OneUptimeDate.toClickhouseDateTime64(endTime)}', 9)`;

      const projectIds: Array<string> = await findProjectsWithRecentTelemetry({
        startSql,
        endSql,
      });

      let totalEdges: number = 0;
      for (const projectId of projectIds) {
        try {
          totalEdges += await computeDependenciesForProject({
            projectId,
            startSql,
            endSql,
          });
        } catch (err) {
          logger.error(
            `ComputeServiceDependencies: failed for project ${projectId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (totalEdges > 0) {
        logger.debug(
          `ComputeServiceDependencies: reconciled ${totalEdges} depends-on edge(s) across ${projectIds.length} project(s).`,
        );
      }
    } catch (err) {
      logger.error(
        `ComputeServiceDependencies cron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);
