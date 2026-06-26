import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import SpanService from "Common/Server/Services/SpanService";
import ServiceService from "Common/Server/Services/ServiceService";
import TelemetryEntityRelationshipService from "Common/Server/Services/TelemetryEntityRelationshipService";
import Service from "Common/Models/DatabaseModels/Service";
import Includes from "Common/Types/BaseDatabase/Includes";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { EntityRelationshipEdge } from "Common/Utils/Telemetry/EntityRelationship";
import { keyForService } from "Common/Utils/Telemetry/EntityKey";

/*
 * TelemetryEntity:ComputeServiceDependencies
 *
 * Service → service `depends-on` edges for the topology graph (the
 * resurrected ServiceDependency capability — doc §4: "service→service
 * dependency edges fall out of the same table once we derive them from
 * span client/server pairs"). Co-occurrence inference cannot produce
 * these: a caller and its callee never share one resource. Instead,
 * every ~10 minutes this aggregates the recent span window in ClickHouse:
 * parent/child span pairs joined on (traceId, parentSpanId = spanId)
 * whose primaryEntityId differs and whose primaryEntityType is the
 * Service discriminator on BOTH sides, grouped to distinct
 * (caller, callee) service-id pairs.
 *
 * The service *entity key* hashes the service NAME (keyForService), so
 * the distinct primaryEntityIds are resolved to Service rows in Postgres
 * and hashed from their names — never from the ids. Edges are upserted
 * through the same reconcile scaffold as the co-occurrence graph
 * (forward-only, lastSeenAt-bumped, pruned by TTL), and reference
 * service entity keys that ingest already registered, so endpoints
 * resolve in the registry.
 *
 * Query shape (sanity-checked against dev ClickHouse): both join sides
 * are pre-filtered subqueries pruned by the (projectId, startTime) sort
 * key with LIMIT guards, so memory stays bounded on busy projects.
 */

// CronTime.ts has no ten-minute constant; this job is its only user.
const EVERY_TEN_MINUTES: string = "*/10 * * * *";

// Look slightly past the cron period so a slow/missed run leaves no gap.
const WINDOW_MINUTES: number = 15;

// LIMIT guards: per-side span sample and max distinct edges per project.
const MAX_SPANS_PER_SIDE: number = 500000;
const MAX_EDGES_PER_PROJECT: number = 1000;
const MAX_PROJECTS_PER_RUN: number = 1000;

const QUERY_SETTINGS: string =
  "SETTINGS max_execution_time = 60, timeout_overflow_mode = 'break', max_memory_usage = 2000000000, max_bytes_before_external_group_by = 1000000000, max_bytes_before_external_sort = 1000000000";

const UUID_REGEX: RegExp =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function escapeSql(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

interface DependencyRow {
  callerServiceId: string;
  calleeServiceId: string;
}

async function findProjectsWithRecentSpans(window: {
  startSql: string;
  endSql: string;
}): Promise<Array<string>> {
  const sql: string = `
    SELECT DISTINCT projectId
    FROM oneuptime.SpanItemV3
    WHERE startTime >= ${window.startSql}
      AND startTime < ${window.endSql}
    LIMIT ${MAX_PROJECTS_PER_RUN}
    ${QUERY_SETTINGS}
  `;

  const resultSet: {
    json: () => Promise<{ data: Array<{ projectId: string }> }>;
  } = (await SpanService.executeQuery(sql)) as unknown as {
    json: () => Promise<{ data: Array<{ projectId: string }> }>;
  };

  const parsed: { data: Array<{ projectId: string }> } = await resultSet.json();

  return parsed.data
    .map((row: { projectId: string }) => {
      return row.projectId;
    })
    .filter((projectId: string) => {
      return UUID_REGEX.test(projectId);
    });
}

async function findServiceDependencyPairs(args: {
  projectId: string;
  startSql: string;
  endSql: string;
}): Promise<Array<DependencyRow>> {
  const projectIdSql: string = escapeSql(args.projectId);
  const serviceTypeSql: string = escapeSql(ServiceType.OpenTelemetry);

  /*
   * caller = parent span, callee = child span; the pair crosses a service
   * boundary when the primary entity differs. Both sides prune on the
   * (projectId, startTime) sort-key prefix.
   */
  const sql: string = `
    SELECT
      caller.primaryEntityId AS callerServiceId,
      callee.primaryEntityId AS calleeServiceId,
      count() AS callCount
    FROM
    (
      SELECT traceId, spanId, primaryEntityId
      FROM oneuptime.SpanItemV3
      WHERE projectId = '${projectIdSql}'
        AND startTime >= ${args.startSql}
        AND startTime < ${args.endSql}
        AND primaryEntityType = '${serviceTypeSql}'
      LIMIT ${MAX_SPANS_PER_SIDE}
    ) AS caller
    INNER JOIN
    (
      SELECT traceId, parentSpanId, primaryEntityId
      FROM oneuptime.SpanItemV3
      WHERE projectId = '${projectIdSql}'
        AND startTime >= ${args.startSql}
        AND startTime < ${args.endSql}
        AND primaryEntityType = '${serviceTypeSql}'
        AND parentSpanId IS NOT NULL
        AND parentSpanId != ''
      LIMIT ${MAX_SPANS_PER_SIDE}
    ) AS callee
    ON caller.traceId = callee.traceId AND caller.spanId = callee.parentSpanId
    WHERE caller.primaryEntityId != callee.primaryEntityId
    GROUP BY callerServiceId, calleeServiceId
    LIMIT ${MAX_EDGES_PER_PROJECT}
    ${QUERY_SETTINGS}
  `;

  const resultSet: {
    json: () => Promise<{ data: Array<DependencyRow> }>;
  } = (await SpanService.executeQuery(sql)) as unknown as {
    json: () => Promise<{ data: Array<DependencyRow> }>;
  };

  const parsed: { data: Array<DependencyRow> } = await resultSet.json();

  return parsed.data.filter((row: DependencyRow) => {
    return (
      UUID_REGEX.test(row.callerServiceId) &&
      UUID_REGEX.test(row.calleeServiceId)
    );
  });
}

async function computeDependenciesForProject(args: {
  projectId: string;
  startSql: string;
  endSql: string;
}): Promise<number> {
  const pairs: Array<DependencyRow> = await findServiceDependencyPairs(args);

  if (pairs.length === 0) {
    return 0;
  }

  const distinctServiceIds: Array<string> = Array.from(
    new Set<string>(
      pairs.flatMap((pair: DependencyRow) => {
        return [pair.callerServiceId, pair.calleeServiceId];
      }),
    ),
  );

  /*
   * Resolve primaryEntityId → Service name (the entity key hashes the
   * name, not the id). Ids without a row (service deleted since the
   * window) drop their edges.
   */
  const services: Array<Service> = await ServiceService.findBy({
    query: {
      projectId: new ObjectID(args.projectId),
      _id: new Includes(distinctServiceIds),
    },
    select: { _id: true, name: true },
    skip: 0,
    limit: LIMIT_MAX,
    props: { isRoot: true },
  });

  const entityKeyByServiceId: Map<string, string> = new Map<string, string>();
  for (const service of services) {
    if (!service._id || !service.name) {
      continue;
    }
    entityKeyByServiceId.set(
      service._id.toString(),
      keyForService(args.projectId, service.name),
    );
  }

  const edges: Array<EntityRelationshipEdge> = [];
  const seen: Set<string> = new Set<string>();
  for (const pair of pairs) {
    const fromEntityKey: string | undefined = entityKeyByServiceId.get(
      pair.callerServiceId,
    );
    const toEntityKey: string | undefined = entityKeyByServiceId.get(
      pair.calleeServiceId,
    );

    // Same-key guard: distinct ids can map to one identity post-hash.
    if (!fromEntityKey || !toEntityKey || fromEntityKey === toEntityKey) {
      continue;
    }

    const dedupeKey: string = `${fromEntityKey}|${toEntityKey}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    edges.push({
      fromEntityKey,
      toEntityKey,
      relationshipType: EntityRelationshipType.DependsOn,
    });
  }

  if (edges.length === 0) {
    return 0;
  }

  await TelemetryEntityRelationshipService.reconcileRelationships({
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

      const projectIds: Array<string> = await findProjectsWithRecentSpans({
        startSql,
        endSql,
      });

      if (projectIds.length === 0) {
        return;
      }

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
