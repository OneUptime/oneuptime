import { EVERY_THREE_HOURS } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import TelemetryEntityService from "Common/Server/Services/TelemetryEntityService";
import TelemetryEntityRelationshipService from "Common/Server/Services/TelemetryEntityRelationshipService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import EntityType from "Common/Types/Telemetry/EntityType";

/*
 * TelemetryEntity:PruneStaleEntities
 *
 * The entity registry is populated forward-only at ingest and `lastSeenAt`
 * is bumped (throttled to the reconcile fence window, ~5 min) for as long
 * as an entity keeps emitting telemetry. So a row whose lastSeenAt exceeds
 * its type's TTL is genuinely gone (pod rescheduled, host decommissioned,
 * service deleted) — hard-delete it. Per-type TTLs reflect churn: pods /
 * deployments / instances cycle daily, nodes / namespaces weekly, and
 * service / host / cluster identities are long-lived.
 *
 * Relationship edges are pruned by lastSeenAt ONLY (no endpoint-existence
 * sweep — an endpoint disappearing is the entity prune's own concern). A
 * single 30-day TTL (the longest entity TTL) is used for all edges: a
 * still-active edge is re-bumped every fence window, and an edge whose
 * short-lived endpoint was already pruned dangles harmlessly (topology
 * reads join through the registry) until this TTL reaps it.
 *
 * Deletes are batched (limit + loop) so a huge stale backlog never holds
 * one giant transaction.
 */

const ENTITY_TTL_HOURS: ReadonlyMap<EntityType, number> = new Map<
  EntityType,
  number
>([
  [EntityType.KubernetesPod, 24],
  [EntityType.KubernetesDeployment, 24],
  [EntityType.ServiceInstance, 24],
  [EntityType.Container, 24],
  [EntityType.Process, 24],
  [EntityType.ProxmoxGuest, 24],
  [EntityType.KubernetesNode, 7 * 24],
  [EntityType.KubernetesNamespace, 7 * 24],
  [EntityType.ProxmoxNode, 7 * 24],
  [EntityType.TelemetrySdk, 30 * 24],
  [EntityType.Service, 30 * 24],
  [EntityType.Host, 30 * 24],
  [EntityType.KubernetesCluster, 30 * 24],
  [EntityType.ProxmoxCluster, 30 * 24],
  [EntityType.CephCluster, 30 * 24],
]);

// Edges carry no entity type, so they get the longest entity TTL.
const RELATIONSHIP_TTL_HOURS: number = 30 * 24;

async function deleteStaleEntities(data: {
  entityType: EntityType;
  cutoff: Date;
}): Promise<number> {
  let total: number = 0;
  let deleted: number = 0;
  do {
    deleted = await TelemetryEntityService.hardDeleteBy({
      query: {
        entityType: data.entityType,
        lastSeenAt: QueryHelper.lessThan(data.cutoff),
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });
    total += deleted;
  } while (deleted > 0);
  return total;
}

RunCron(
  "TelemetryEntity:PruneStaleEntities",
  { schedule: EVERY_THREE_HOURS, runOnStartup: false },
  async () => {
    try {
      let totalEntities: number = 0;

      for (const [entityType, ttlHours] of ENTITY_TTL_HOURS.entries()) {
        try {
          totalEntities += await deleteStaleEntities({
            entityType,
            cutoff: OneUptimeDate.getSomeHoursAgo(ttlHours),
          });
        } catch (err) {
          logger.error(
            `PruneStaleEntities: entity prune failed for type ${entityType}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      let totalEdges: number = 0;
      try {
        const cutoff: Date = OneUptimeDate.getSomeHoursAgo(
          RELATIONSHIP_TTL_HOURS,
        );
        let deleted: number = 0;
        do {
          deleted = await TelemetryEntityRelationshipService.hardDeleteBy({
            query: {
              lastSeenAt: QueryHelper.lessThan(cutoff),
            },
            limit: LIMIT_MAX,
            skip: 0,
            props: { isRoot: true },
          });
          totalEdges += deleted;
        } while (deleted > 0);
      } catch (err) {
        logger.error(
          `PruneStaleEntities: relationship prune failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      if (totalEntities > 0 || totalEdges > 0) {
        logger.debug(
          `PruneStaleEntities: pruned ${totalEntities} stale TelemetryEntity row(s) and ${totalEdges} TelemetryEntityRelationship row(s).`,
        );
      }
    } catch (err) {
      logger.error(
        `PruneStaleEntities cron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);
