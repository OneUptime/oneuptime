import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "../../Services/DatabaseService";
import Query from "../../Types/Database/Query";
import Select from "../../Types/Database/Select";
import QueryDeepPartialEntity from "../../../Types/Database/PartialEntity";
import ObjectID from "../../../Types/ObjectID";
import EntityType from "../../../Types/Telemetry/EntityType";
import GlobalCache from "../../Infrastructure/GlobalCache";
import logger from "../Logger";
import { ExtractedEntity } from "./TelemetryEntity";
import TelemetryEntityService from "../../Services/TelemetryEntityService";
import TelemetryEntityRelationshipService from "../../Services/TelemetryEntityRelationshipService";
import {
  deriveRelationships,
  EntityRelationshipEdge,
} from "../../../Utils/Telemetry/EntityRelationship";

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
const FENCE_TTL_SECONDS: number = 5 * 60; // 5 minutes

async function shouldReconcile(fenceId: string): Promise<boolean> {
  try {
    const key: string = `${FENCE_SCOPE}:${fenceId}`;
    const seen: string | null = await GlobalCache.getString(
      FENCE_NAMESPACE,
      key,
    );
    if (seen) {
      return false;
    }
    await GlobalCache.setString(FENCE_NAMESPACE, key, "1", {
      expiresInSeconds: FENCE_TTL_SECONDS,
    });
    return true;
  } catch {
    // If the cache is down, default to running the reconcile.
    return true;
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
    const key: string = `entity-budget-warn:${data.projectId.toString()}:${
      data.entityType
    }`;
    const seen: string | null = await GlobalCache.getString(
      FENCE_NAMESPACE,
      key,
    );
    if (seen) {
      return false;
    }
    await GlobalCache.setString(FENCE_NAMESPACE, key, "1", {
      expiresInSeconds: FENCE_TTL_SECONDS,
    });
    return true;
  } catch {
    // If the cache is down, default to warning (visibility over silence).
    return true;
  }
}

/*
 * Upsert discovered entities into the `TelemetryEntity` registry and their
 * co-occurrence edges into `TelemetryEntityRelationship`. Gated by a single
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
}): Promise<void> {
  try {
    const promoted: Array<ExtractedEntity> = data.entities.filter(
      (entity: ExtractedEntity) => {
        return REGISTRY_PROMOTED_TYPES.has(entity.entityType);
      },
    );

    if (promoted.length === 0) {
      return;
    }

    const fenceId: string = `${data.projectId.toString()}:${promoted
      .map((entity: ExtractedEntity) => {
        return entity.entityKey;
      })
      .sort()
      .join(",")}`;

    if (!(await shouldReconcile(fenceId))) {
      return;
    }

    await TelemetryEntityService.reconcileEntities({
      projectId: data.projectId,
      entities: promoted,
    });

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
      await TelemetryEntityRelationshipService.reconcileRelationships({
        projectId: data.projectId,
        edges,
      });
    }
  } catch (err) {
    logger.error("Entity registry reconciliation failed:");
    logger.error(err as Error);
  }
}

/*
 * Find-or-create by natural key, bumping `lastSeenAt` — the one upsert
 * scaffold shared by TelemetryEntityService and
 * TelemetryEntityRelationshipService. Both tables have a unique index on
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

  const existing: TBaseModel | null = await data.service.findOneBy({
    query: data.query,
    select,
    props: { isRoot: true },
  });

  if (existing) {
    /*
     * Throttled bump of lastSeenAt (+ any caller-supplied merge fields).
     * Heartbeat write: single-statement UPDATE, no hooks and no `version`
     * bump (TelemetryEntity/Relationship enable no update workflow/realtime/
     * audit). buildBump returns only plain values — lastSeenAt plus, at most,
     * the descriptiveAttributes / labels JSON columns — which the primitive
     * persists via the driver transformer path. See ServiceService.updateLastSeen.
     */
    await data.service.updateColumnsByIdWithoutHooks({
      id: existing.id!,
      data: buildBump(existing),
    });
    return;
  }

  if (data.beforeCreate && !(await data.beforeCreate())) {
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
      await data.service.updateColumnsByIdWithoutHooks({
        id: winner.id!,
        data: buildBump(winner),
      });
      return;
    }

    logger.warn(`EntityRegistry: create failed for ${data.describe}:`);
    logger.warn(err as Error);
  }
}
