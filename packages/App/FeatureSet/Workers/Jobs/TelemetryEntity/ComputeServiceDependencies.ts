import RunCron from "../../Utils/Cron";
import AutoCreateBudget from "../DatabaseServer/AutoCreateBudget";
import logger from "Common/Server/Utils/Logger";
import SpanService from "Common/Server/Services/SpanService";
import MetricService from "Common/Server/Services/MetricService";
import ServiceService from "Common/Server/Services/ServiceService";
import InventoryItemService from "Common/Server/Services/InventoryItemService";
import InventoryItemRelationshipService from "Common/Server/Services/InventoryItemRelationshipService";
import DatabaseServerService from "Common/Server/Services/DatabaseServerService";
import Service from "Common/Models/DatabaseModels/Service";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import Includes from "Common/Types/BaseDatabase/Includes";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import DatabaseServerDiscoverySource from "Common/Types/DatabaseServer/DatabaseServerDiscoverySource";
import {
  DatabaseEndpoint,
  formatDatabaseEndpoint,
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
 * identity above, and neither side's failure costs the other its run.
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
  row: DatabaseServer | null;
  created: boolean;
  // A create the policy allowed but the project's auto-create budget refused.
  overBudget: boolean;
}

/*
 * One discovered endpoint → its DatabaseServer row, or null. Looked up
 * first WITHOUT permission to create, so an endpoint that already has a row
 * (the steady state) costs no budget query; only a miss that passes the
 * conservative create policy asks the project's auto-create budget and tries
 * again with creation allowed (see AutoCreateBudget).
 */
async function findOrCreateDatabaseServerForEndpoint(data: {
  projectId: ObjectID;
  discovered: DiscoveredDatabaseEndpoint;
  minCalls: number;
  budget: AutoCreateBudget;
}): Promise<DatabaseEndpointMatch> {
  const lookup: {
    projectId: ObjectID;
    dbSystem: string;
    endpoint: DatabaseEndpoint;
    discoverySource: DatabaseServerDiscoverySource;
  } = {
    projectId: data.projectId,
    dbSystem: data.discovered.system,
    endpoint: data.discovered.endpoint,
    discoverySource: DatabaseServerDiscoverySource.ClientSpans,
  };

  const existing: DatabaseServer | null =
    await DatabaseServerService.findOrCreateByEndpoint({
      ...lookup,
      allowCreate: false,
    });

  if (existing) {
    return { row: existing, created: false, overBudget: false };
  }

  if (
    !isDatabaseEndpointAutoCreateCandidate({
      discovered: data.discovered,
      minCalls: data.minCalls,
    })
  ) {
    return { row: null, created: false, overBudget: false };
  }

  if (!(await data.budget.allowsCreate(data.projectId))) {
    return { row: null, created: false, overBudget: true };
  }

  const created: DatabaseServer | null =
    await DatabaseServerService.findOrCreateByEndpoint({
      ...lookup,
      allowCreate: true,
    });

  if (created) {
    data.budget.recordCreate(data.projectId);
  }

  return { row: created, created: Boolean(created), overBudget: false };
}

/**
 * Databases from client spans: every database endpoint the project's DB
 * CLIENT spans called in the window is matched to its DatabaseServer row —
 * created when new, busy enough, global-scope, named by host and of an
 * auto-creatable engine, within budget — and that row is sighted
 * (lastSeenAt). Each endpoint is isolated from the next, and the whole step
 * from the dependency sources: it never throws. Returns how many rows were
 * sighted.
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
        `ComputeServiceDependencies: project ${args.projectId} called at least ${MAX_DATABASE_ENDPOINT_ROWS} database endpoint groups in the window; only the busiest ${MAX_DATABASE_ENDPOINT_ROWS} were matched to databases this run`,
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

    let sighted: number = 0;
    let created: number = 0;
    let overBudget: number = 0;

    for (const discovered of endpoints) {
      try {
        const result: DatabaseEndpointMatch =
          await findOrCreateDatabaseServerForEndpoint({
            projectId: projectId,
            discovered: discovered,
            minCalls: minCalls,
            budget: budget,
          });

        if (result.overBudget) {
          overBudget++;
        }

        if (!result.row || !result.row.id) {
          continue;
        }

        if (result.created) {
          created++;
        }

        await DatabaseServerService.recordSighting(result.row.id);
        sighted++;
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

    if (sighted > 0) {
      logger.debug(
        `ComputeServiceDependencies: sighted ${sighted} database(s) (${created} new) from client spans for project ${args.projectId}.`,
      );
    }

    return sighted;
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
  /*
   * Databases from the same window. Started next to the dependency sources
   * and awaited before anything below can return early, so it runs whether
   * or not the window produced a single edge. It never rejects.
   */
  const databaseDiscovery: Promise<number> = discoverDatabaseServersForProject({
    projectId: args.projectId,
    startSql: args.startSql,
    endSql: args.endSql,
  });

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

  await databaseDiscovery;

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
