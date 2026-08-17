import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Host from "../../../Models/DatabaseModels/Host";
import DatabaseService from "../../Services/DatabaseService";
import Query from "../../Types/Database/Query";
import Select from "../../Types/Database/Select";
import QueryDeepPartialEntity from "../../../Types/Database/PartialEntity";
import ObjectID from "../../../Types/ObjectID";
import EntityType from "../../../Types/Telemetry/EntityType";
import EntitySource from "../../../Types/Telemetry/EntitySource";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import GlobalCache from "../../Infrastructure/GlobalCache";
import HostService from "../../Services/HostService";
import logger from "../Logger";
import { ExtractedEntity, RetiredEntityIdentity } from "./TelemetryEntity";
import InventoryItemService from "../../Services/InventoryItemService";
import InventoryItemRelationshipService from "../../Services/InventoryItemRelationshipService";
import QueryHelper from "../../Types/Database/QueryHelper";
import {
  deriveRelationships,
  EntityRelationshipEdge,
} from "../../../Utils/Telemetry/EntityRelationship";
import { canonicalizeEntityValue } from "../../../Utils/Telemetry/EntityKey";
import crypto from "crypto";

/*
 * Shared entity-registry reconciliation machinery (phases 2 + 5 of the
 * entity model — see Internal/Docs/OpenTelemetryEntities.md). Lives in
 * Common so every ingest path that discovers entities — the OTLP pipeline
 * (OtelIngestBaseService.resolveTelemetryResource) and the lower-fidelity
 * name-only paths (syslog / fluent via
 * OpenTelemetryIngestService.telemetryServiceFromName) — funnels through
 * the SAME promotion gate and Redis fence.
 */

/*
 * High-churn types are membership-only by default (doc §Edge Cases /
 * Decision 7): their keys flow into the `entityKeys` column on signals,
 * but they are never promoted to registry rows — container restarts and
 * pid reuse would otherwise mint unbounded registry rows. Everything
 * else promotes. `service.instance` is membership-only too: semconv
 * `service.instance.id` is typically a per-restart UUID, so each deploy
 * would mint a fresh registry row per instance.
 */
const MEMBERSHIP_ONLY_TYPES: ReadonlySet<EntityType> = new Set<EntityType>([
  EntityType.Container,
  EntityType.Process,
  EntityType.ServiceInstance,
  EntityType.TelemetrySdk,
]);

/*
 * Per-(project, entityType) registry budget (doc §Edge Cases — "reuse the
 * existing per-service metricCardinalityBudget concept as a per-type
 * entity budget"). Beyond budget, NEW registry rows stop being created —
 * membership keys still flow into `entityKeys` on signals, and existing
 * rows keep their `lastSeenAt` bumps so the prune TTL never reaps live
 * entities. Hardcoded defaults; a per-project override is a follow-up.
 */
export const DEFAULT_ENTITY_BUDGET: ReadonlyMap<EntityType, number> = new Map<
  EntityType,
  number
>([
  [EntityType.Service, 10000],
  [EntityType.Host, 10000],
  [EntityType.KubernetesCluster, 10000],
  [EntityType.KubernetesNode, 1000],
  [EntityType.KubernetesNamespace, 1000],
  [EntityType.KubernetesPod, 5000],
  [EntityType.KubernetesDeployment, 5000],
  [EntityType.ProxmoxCluster, 10000],
  [EntityType.ProxmoxNode, 1000],
  [EntityType.ProxmoxGuest, 5000],
  [EntityType.CephCluster, 10000],
]);

// For types not in the map (future promotions of high-churn types).
export const FALLBACK_ENTITY_BUDGET: number = 5000;

export function getEntityBudget(entityType: EntityType): number {
  return DEFAULT_ENTITY_BUDGET.get(entityType) ?? FALLBACK_ENTITY_BUDGET;
}

export const REGISTRY_PROMOTED_TYPES: ReadonlySet<EntityType> =
  new Set<EntityType>(
    Object.values(EntityType).filter((entityType: EntityType) => {
      return !MEMBERSHIP_ONLY_TYPES.has(entityType);
    }),
  );

/*
 * Same Redis namespace / key shape / TTL as
 * OtelIngestBaseService.shouldRunMaintenance, so an entity set fenced by
 * one ingest path is fenced for all of them.
 */
const FENCE_NAMESPACE: string = "otel-maintenance-fence";
const FENCE_SCOPE: string = "entity-reconcile";
const ROW_FENCE_SCOPE: string = "entity-reconcile-row";
const FENCE_TTL_SECONDS: number = 5 * 60; // 5 minutes
const LEGACY_HOST_RETIREMENT_CACHE_NAMESPACE: string =
  "legacy-kubernetes-host-retirement-completed";
const LEGACY_HOST_RETIREMENT_CACHE_TTL_SECONDS: number = 24 * 60 * 60;

/*
 * Atomic claim. A read-then-write here admits every worker that reads the
 * absent key in the same instant, which at ingest concurrency is all of them —
 * the defect behind the row-lock convoy documented in
 * DatabaseService.updateColumnsByIdIfUnlockedWithoutHooks. TTLs are jittered
 * so a fleet-wide restart cannot re-synchronise the windows and rebuild the
 * herd on a fixed period.
 */
async function shouldReconcile(fenceId: string): Promise<boolean> {
  try {
    return await GlobalCache.setStringIfNotExists(
      FENCE_NAMESPACE,
      `${FENCE_SCOPE}:${hashFenceId(fenceId)}`,
      "1",
      { expiresInSeconds: GlobalCache.withJitter(FENCE_TTL_SECONDS) },
    );
  } catch {
    // If the cache is down, default to running the reconcile.
    return true;
  }
}

/*
 * The set-level fence id concatenates every promoted entity key, so it is
 * unbounded in length — a pod with many entities would otherwise produce a
 * multi-kilobyte Redis key. Hashing keeps it fixed-width without changing which
 * sets collide.
 */
function hashFenceId(fenceId: string): string {
  return crypto.createHash("sha1").update(fenceId).digest("hex");
}

/*
 * Per-ROW fence, sitting inside the set-level one.
 *
 * The set-level fence keys on (project + the whole promoted entity set), which
 * in practice is unique per POD — a pod's own key is in the set. But the writes
 * it gates are per ROW: the single InventoryItem row for a Kubernetes cluster
 * takes one UPDATE per pod in that cluster per window, the namespace row one
 * per pod in the namespace, and so on. Throttle granularity finer than write
 * granularity means the throttle does not bound the writes at all, and the
 * mismatch factor is the pod count — the same shape of defect as the Service
 * heartbeat, one layer down.
 *
 * Claiming per row before the lookup also removes the redundant SELECT, not
 * just the redundant UPDATE.
 */
async function shouldReconcileRow(rowFenceId: string): Promise<boolean> {
  try {
    return await GlobalCache.setStringIfNotExists(
      FENCE_NAMESPACE,
      `${ROW_FENCE_SCOPE}:${hashFenceId(rowFenceId)}`,
      "1",
      { expiresInSeconds: GlobalCache.withJitter(FENCE_TTL_SECONDS) },
    );
  } catch {
    // If the cache is down, default to running the reconcile.
    return true;
  }
}

async function releaseRowFence(rowFenceId: string): Promise<void> {
  try {
    await GlobalCache.deleteKey(
      FENCE_NAMESPACE,
      `${ROW_FENCE_SCOPE}:${hashFenceId(rowFenceId)}`,
    );
  } catch {
    // Best effort — losing the release costs one window of staleness.
  }
}

/*
 * Over-budget skips happen per row, but the warn log is fenced to once per
 * (project, entityType) per fence window — an over-budget project would
 * otherwise emit a warn line for every skipped entity of every batch.
 */
export async function shouldWarnEntityBudgetOnce(data: {
  projectId: ObjectID;
  entityType: EntityType;
}): Promise<boolean> {
  try {
    return await GlobalCache.setStringIfNotExists(
      FENCE_NAMESPACE,
      `entity-budget-warn:${data.projectId.toString()}:${data.entityType}`,
      "1",
      { expiresInSeconds: GlobalCache.withJitter(FENCE_TTL_SECONDS) },
    );
  } catch {
    // If the cache is down, default to warning (visibility over silence).
    return true;
  }
}

/*
 * Upsert discovered entities into the `InventoryItem` registry and their
 * co-occurrence edges into `InventoryItemRelationship`. Gated by a single
 * per-batch Redis fence keyed on the PROMOTED entity subset, so a stable
 * resource reconciles at most once per window while a changed set (e.g. a
 * pod reschedule) reconciles immediately — and the high-churn
 * membership-only keys (container restarts, pid reuse) cannot churn the
 * fence id and defeat the throttle. Edges are derived only among promoted
 * entities so no edge references a key the registry never registered.
 *
 * Forward-only and best-effort: every error is swallowed (logged) here, so
 * callers may fire-and-forget — a registry failure must never break signal
 * ingest. `entityKeys` stamping on signal rows is independent of this and
 * stays synchronous at the call sites.
 */
export async function reconcileEntityRegistryThrottled(data: {
  projectId: ObjectID;
  entities: Array<ExtractedEntity>;
  retiredEntities?: Array<RetiredEntityIdentity> | undefined;
}): Promise<void> {
  try {
    const promoted: Array<ExtractedEntity> = data.entities.filter(
      (entity: ExtractedEntity) => {
        return REGISTRY_PROMOTED_TYPES.has(entity.entityType);
      },
    );
    const retiredHosts: Array<RetiredEntityIdentity> = (
      data.retiredEntities || []
    ).filter((entity: RetiredEntityIdentity) => {
      /*
       * This repair path is intentionally closed over the one historical bug
       * it can prove. A future caller cannot turn the generic-looking payload
       * into a broad deletion primitive for another entity type.
       */
      return entity.entityType === EntityType.Host;
    });

    if (promoted.length === 0 && retiredHosts.length === 0) {
      return;
    }

    const fenceMembers: Array<string> = [
      ...promoted.map((entity: ExtractedEntity) => {
        return entity.entityKey;
      }),
      ...retiredHosts.map((entity: RetiredEntityIdentity) => {
        return `retire:${entity.entityType}:${entity.entityKey}`;
      }),
    ].sort();
    const fenceId: string = `${data.projectId.toString()}:${fenceMembers.join(",")}`;

    if (!(await shouldReconcile(fenceId))) {
      return;
    }

    await retireEntityRegistryIdentitiesBestEffort({
      projectId: data.projectId,
      retiredEntities: retiredHosts,
    });

    if (promoted.length > 0) {
      await InventoryItemService.reconcileEntities({
        projectId: data.projectId,
        entities: promoted,
      });
    }

    /*
     * Topology (phase 5): the co-occurrence edges derive from the same
     * entity set, so they reconcile under the same fence — no extra
     * Redis check. A stable resource bumps both the registry and the
     * graph once per window; a changed set re-derives both.
     */
    const edges: Array<EntityRelationshipEdge> = deriveRelationships(
      promoted.map((entity: ExtractedEntity) => {
        return {
          entityType: entity.entityType,
          entityKey: entity.entityKey,
        };
      }),
    );
    if (edges.length > 0) {
      await InventoryItemRelationshipService.reconcileRelationships({
        projectId: data.projectId,
        edges,
      });
    }
  } catch (err) {
    logger.error("Entity registry reconciliation failed:");
    logger.error(err as Error);
  }
}

/**
 * Remove exact legacy discovered Host rows proven obsolete by the current
 * resource observation, plus discovered topology edges that reference them.
 *
 * Every predicate is repeated at the delete boundary: tenant, type, key and
 * source for InventoryItem; tenant, endpoint key and source for relationships.
 * Manual and inventory-authored data is therefore unreachable even if a bad
 * caller supplies its key. Failures are logged and swallowed so this optional
 * repair can never delay or reject signal ingest.
 */
export async function retireEntityRegistryIdentitiesBestEffort(data: {
  projectId: ObjectID;
  retiredEntities: Array<RetiredEntityIdentity>;
}): Promise<void> {
  const seen: Set<string> = new Set<string>();

  for (const retired of data.retiredEntities) {
    if (retired.entityType !== EntityType.Host || seen.has(retired.entityKey)) {
      continue;
    }
    seen.add(retired.entityKey);

    const retirementCacheKey: string = `${data.projectId.toString()}:${retired.entityKey}`;
    try {
      if (
        await GlobalCache.getString(
          LEGACY_HOST_RETIREMENT_CACHE_NAMESPACE,
          retirementCacheKey,
        )
      ) {
        continue;
      }
    } catch (err) {
      /* Cache maintenance must never become a signal-ingest dependency. */
      logger.error(
        `Entity registry: failed to read legacy Host retirement cache for ${retired.entityKey}; proceeding with repair: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const rawHostName: string | undefined =
      retired.identifyingAttributes["host.name"];
    const hostName: string = canonicalizeEntityValue(rawHostName || "");
    if (!hostName) {
      /*
       * The key alone cannot establish which typed Host owns this identity.
       * Fail closed instead of turning a malformed retirement into deletion.
       */
      logger.error(
        `Entity registry: preserving legacy Host ${retired.entityKey} because its canonical host.name proof is missing`,
      );
      continue;
    }

    try {
      const typedHost: Host | null = await HostService.findOneBy({
        query: {
          projectId: data.projectId,
          hostIdentifier: QueryHelper.findWithSameText(hostName),
        },
        select: { _id: true },
        props: { isRoot: true },
      });

      if (typedHost) {
        /*
         * A real Host with this canonical identifier makes the discovered
         * registry Host legitimate, even when this particular observation is
         * Kubernetes telemetry. Preserve it and cache that safe resolution.
         */
        await markLegacyHostRetirementCompletedBestEffort({
          retirementCacheKey,
          entityKey: retired.entityKey,
        });
        continue;
      }
    } catch (err) {
      /* A lookup outage is uncertainty; uncertainty must preserve data. */
      logger.error(
        `Entity registry: preserving legacy Host ${retired.entityKey} because typed Host lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    try {
      await InventoryItemService.hardDeleteBy({
        query: {
          projectId: data.projectId,
          entityType: EntityType.Host,
          entityKey: retired.entityKey,
          source: EntitySource.Discovered,
        },
        limit: 1,
        skip: 0,
        props: { isRoot: true },
      });
    } catch (err) {
      /*
       * Keep its edges if the endpoint delete did not complete. That is less
       * surprising than erasing topology for a row that remains visible.
       */
      logger.error(
        `Entity registry: failed to retire legacy Kubernetes Host ${retired.entityKey}: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    let retirementCompleted: boolean = true;
    for (const direction of ["fromEntityKey", "toEntityKey"] as const) {
      try {
        let deleted: number = 0;
        do {
          deleted = await InventoryItemRelationshipService.hardDeleteBy({
            query: {
              projectId: data.projectId,
              [direction]: retired.entityKey,
              source: EntitySource.Discovered,
            },
            limit: LIMIT_MAX,
            skip: 0,
            props: { isRoot: true },
          });
        } while (deleted > 0);
      } catch (err) {
        retirementCompleted = false;
        logger.error(
          `Entity registry: failed to remove ${direction === "fromEntityKey" ? "outgoing" : "incoming"} relationships for retired Host ${retired.entityKey}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (retirementCompleted) {
      await markLegacyHostRetirementCompletedBestEffort({
        retirementCacheKey,
        entityKey: retired.entityKey,
      });
    }
  }
}

async function markLegacyHostRetirementCompletedBestEffort(data: {
  retirementCacheKey: string;
  entityKey: string;
}): Promise<void> {
  try {
    await GlobalCache.setString(
      LEGACY_HOST_RETIREMENT_CACHE_NAMESPACE,
      data.retirementCacheKey,
      "1",
      { expiresInSeconds: LEGACY_HOST_RETIREMENT_CACHE_TTL_SECONDS },
    );
  } catch (err) {
    logger.error(
      `Entity registry: failed to cache completed legacy Host retirement for ${data.entityKey}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/*
 * Find-or-create by natural key, bumping `lastSeenAt` — the one upsert
 * scaffold shared by InventoryItemService and
 * InventoryItemRelationshipService. Both tables have a unique index on
 * their natural key, so a concurrent first-contact create loses the race
 * with a unique-violation: in that case the winning row is re-fetched and
 * its `lastSeenAt` bumped immediately (instead of waiting a full throttle
 * window). A create failure with NO winning row is a real error (e.g. a
 * column constraint violation) and is surfaced at warn.
 */
export async function reconcileByNaturalKey<
  TBaseModel extends BaseModel & { lastSeenAt?: Date },
>(data: {
  service: DatabaseService<TBaseModel>;
  query: Query<TBaseModel>;
  buildModel: () => TBaseModel;
  lastSeenAt: Date;
  /** Human-readable row identity for log lines, e.g. "entity host/abc123". */
  describe: string;
  /**
   * Stable identity of the ROW being reconciled, e.g.
   * `${projectId}:${entityType}:${entityKey}`. Claimed atomically before the
   * lookup so one writer per row per window does the work — see
   * shouldReconcileRow for why the set-level fence above is not enough.
   */
  rowFenceId: string;
  /** Extra columns to select on the existing row, for `buildUpdate` diffing. */
  select?: Select<TBaseModel> | undefined;
  /**
   * Extra fields to fold into the `lastSeenAt` bump (descriptive-attribute
   * merge, label union). Return an empty object when nothing changed so the
   * bump stays a single-column update.
   */
  buildUpdate?:
    | ((existing: TBaseModel) => QueryDeepPartialEntity<TBaseModel>)
    | undefined;
  /**
   * Gate run only when a NEW row is about to be created (entity budget).
   * Returning false skips creation silently — the gate owns its own
   * logging/throttling. Existing-row bumps are never gated.
   */
  beforeCreate?: (() => Promise<boolean>) | undefined;
}): Promise<void> {
  const select: Select<TBaseModel> = {
    ...({ _id: true } as Select<TBaseModel>),
    ...(data.select || {}),
  };

  const buildBump: (
    existing: TBaseModel,
  ) => QueryDeepPartialEntity<TBaseModel> = (
    existing: TBaseModel,
  ): QueryDeepPartialEntity<TBaseModel> => {
    // Unresolved generic mapped type — TS cannot prove overlap directly.
    return {
      lastSeenAt: data.lastSeenAt,
      ...(data.buildUpdate ? data.buildUpdate(existing) : {}),
    } as unknown as QueryDeepPartialEntity<TBaseModel>;
  };

  if (!(await shouldReconcileRow(data.rowFenceId))) {
    return;
  }

  const existing: TBaseModel | null = await data.service.findOneBy({
    query: data.query,
    select,
    props: { isRoot: true },
  });

  if (existing) {
    /*
     * Throttled bump of lastSeenAt (+ any caller-supplied merge fields).
     * Heartbeat write: single-statement UPDATE, no hooks and no `version`
     * bump (InventoryItem/Relationship enable no update workflow/realtime/
     * audit). buildBump returns only plain values — lastSeenAt plus, at most,
     * the descriptiveAttributes / labels JSON columns — which the primitive
     * persists via the driver transformer path. See ServiceService.updateLastSeen.
     *
     * SKIP LOCKED: a contended bump yields rather than queueing behind the
     * writer that already holds the row. Registry rows for shared entities (a
     * cluster, a namespace) are written by every pod that reports them, so
     * this is exactly the hot-row shape that convoyed on Service.
     */
    const wrote: boolean =
      await data.service.updateColumnsByIdIfUnlockedWithoutHooks({
        id: existing.id!,
        data: buildBump(existing),
      });

    if (!wrote) {
      // Skipped under contention — re-open the window so the next batch retries.
      await releaseRowFence(data.rowFenceId);
    }
    return;
  }

  if (data.beforeCreate && !(await data.beforeCreate())) {
    /*
     * Over budget: release the row fence so the gate is re-evaluated next
     * batch rather than being suppressed for a full window by a decision that
     * wrote nothing.
     */
    await releaseRowFence(data.rowFenceId);
    return;
  }

  try {
    await data.service.create({
      data: data.buildModel(),
      props: { isRoot: true },
    });
    return;
  } catch (err) {
    /*
     * Re-find to disambiguate: a row now exists means a concurrent worker
     * won the unique-indexed create race (harmless — bump it); no row
     * means the insert itself was invalid, which must be visible.
     */
    const winner: TBaseModel | null = await data.service.findOneBy({
      query: data.query,
      select,
      props: { isRoot: true },
    });

    if (winner) {
      logger.debug(
        `EntityRegistry: create raced for ${data.describe} (concurrent insert); bumping lastSeenAt on the winning row.`,
      );
      await data.service.updateColumnsByIdIfUnlockedWithoutHooks({
        id: winner.id!,
        data: buildBump(winner),
      });
      return;
    }

    /*
     * The insert itself was invalid. Re-open the row window so the next batch
     * retries rather than being silently suppressed for the TTL — a genuinely
     * broken row should keep surfacing this warning, not go quiet.
     */
    await releaseRowFence(data.rowFenceId);

    logger.warn(`EntityRegistry: create failed for ${data.describe}:`);
    logger.warn(err as Error);
  }
}
