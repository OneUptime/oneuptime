import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/TelemetryEntity";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import ColumnLength from "../../Types/Database/ColumnLength";
import QueryDeepPartialEntity from "../../Types/Database/PartialEntity";
import { JSONObject } from "../../Types/JSON";
import EntityType from "../../Types/Telemetry/EntityType";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { ExtractedEntity } from "../Utils/Telemetry/TelemetryEntity";
import {
  getEntityBudget,
  reconcileByNaturalKey,
  REGISTRY_PROMOTED_TYPES,
  shouldWarnEntityBudgetOnce,
} from "../Utils/Telemetry/EntityRegistry";

export class TelemetryEntityService extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /**
   * Forward-only registry reconciliation: upsert a catalog row per
   * discovered entity, bump `lastSeenAt`, merge descriptive attributes
   * (last-writer-wins) and union labels. High-churn membership-only
   * types (container / process / service.instance / telemetry.sdk — see
   * `REGISTRY_PROMOTED_TYPES`) are skipped: their keys still flow into
   * the `entityKeys` column on signals, they just never mint registry
   * rows. New rows are additionally gated by a per-(project, type)
   * entity budget. Resilient by design — a registry failure must never break
   * signal ingest, so every error is swallowed (logged). Callers are
   * expected to throttle this (it should not run on every batch); see
   * `reconcileEntityRegistryThrottled` in
   * `Common/Server/Utils/Telemetry/EntityRegistry`.
   */
  @CaptureSpan()
  public async reconcileEntities(data: {
    projectId: ObjectID;
    entities: Array<ExtractedEntity>;
  }): Promise<void> {
    /*
     * Per-reconcile budget count cache: at most one countBy per entity
     * type per reconcile (the fence already throttles reconciles to one
     * per entity-set per window, so this stays cheap). Creates within
     * this reconcile increment the cached count so a single batch cannot
     * blow past the budget.
     */
    const countByType: Map<EntityType, number> = new Map<EntityType, number>();

    for (const entity of data.entities) {
      if (!REGISTRY_PROMOTED_TYPES.has(entity.entityType)) {
        continue;
      }
      try {
        await this.upsertEntity({
          projectId: data.projectId,
          entity,
          countByType,
        });
      } catch (err) {
        logger.error(
          `TelemetryEntityService: failed to upsert entity ${entity.entityType}/${entity.entityKey}:`,
        );
        logger.error(err as Error);
      }
    }
  }

  private async upsertEntity(data: {
    projectId: ObjectID;
    entity: ExtractedEntity;
    countByType: Map<EntityType, number>;
  }): Promise<void> {
    const { projectId, entity, countByType } = data;
    const now: Date = OneUptimeDate.getCurrentDate();

    await reconcileByNaturalKey({
      service: this,
      query: {
        projectId,
        entityType: entity.entityType,
        entityKey: entity.entityKey,
      },
      lastSeenAt: now,
      describe: `entity ${entity.entityType}/${entity.entityKey}`,
      select: { descriptiveAttributes: true, labels: true },
      buildUpdate: (existing: Model): QueryDeepPartialEntity<Model> => {
        return TelemetryEntityService.buildDescriptiveUpdate(entity, existing);
      },
      /*
       * Entity budget (doc §Edge Cases): existing rows always get their
       * bump above; only NEW rows are gated. Counted via the
       * (projectId, entityType) index; over budget the row is skipped —
       * its key still flows in `entityKeys` on signals.
       */
      beforeCreate: async (): Promise<boolean> => {
        const budget: number = getEntityBudget(entity.entityType);

        let count: number | undefined = countByType.get(entity.entityType);
        if (count === undefined) {
          count = (
            await this.countBy({
              query: { projectId, entityType: entity.entityType },
              props: { isRoot: true },
            })
          ).toNumber();
          countByType.set(entity.entityType, count);
        }

        if (count < budget) {
          countByType.set(entity.entityType, count + 1);
          return true;
        }

        if (
          await shouldWarnEntityBudgetOnce({
            projectId,
            entityType: entity.entityType,
          })
        ) {
          logger.warn(
            `TelemetryEntityService: entity budget reached for project ${projectId.toString()} type ${entity.entityType} (${count} >= ${budget}); skipping new registry rows. Membership keys still flow on signals.`,
          );
        }
        return false;
      },
      buildModel: () => {
        const model: Model = new Model();
        model.projectId = projectId;
        model.entityType = entity.entityType;
        model.entityKey = entity.entityKey;
        model.identifyingAttributes = entity.identifyingAttributes;
        if (
          entity.descriptiveAttributes &&
          Object.keys(entity.descriptiveAttributes).length > 0
        ) {
          model.descriptiveAttributes = entity.descriptiveAttributes;
        }
        if (entity.labels && entity.labels.length > 0) {
          model.labels = TelemetryEntityService.normalizeLabels(entity.labels);
        }
        // varchar(ShortText) column; k8s names can run to 253 chars.
        model.displayName = TelemetryEntityService.deriveDisplayName(
          entity,
        ).substring(0, ColumnLength.ShortText);
        model.firstSeenAt = now;
        model.lastSeenAt = now;
        return model;
      },
    });
  }

  /**
   * Extra fields for the `lastSeenAt` bump on an existing row:
   * descriptive attributes merge last-writer-wins per key, labels merge
   * as a set union. Both are written ONLY when the merge actually changes
   * the stored value, so a stable resource keeps its bump a one-column
   * update (no jsonb churn).
   */
  private static buildDescriptiveUpdate(
    entity: ExtractedEntity,
    existing: Model,
  ): QueryDeepPartialEntity<Model> {
    /*
     * Built as a plain shape and cast once on return: assigning into
     * QueryDeepPartialEntity<Model> directly forces TS to instantiate the
     * recursive JSONObject mapping (TS2589).
     */
    const update: {
      descriptiveAttributes?: JSONObject;
      labels?: Array<string>;
    } = {};

    const incoming: Record<string, string> = entity.descriptiveAttributes || {};
    if (Object.keys(incoming).length > 0) {
      const current: Record<string, unknown> =
        (existing.descriptiveAttributes as Record<string, unknown>) || {};

      const differs: boolean = Object.keys(incoming).some((key: string) => {
        return current[key] !== incoming[key];
      });

      if (differs) {
        update.descriptiveAttributes = {
          ...current,
          ...incoming,
        } as JSONObject;
      }
    }

    const incomingLabels: Array<string> = entity.labels || [];
    if (incomingLabels.length > 0) {
      const currentLabels: Array<string> = existing.labels || [];
      const currentSet: Set<string> = new Set<string>(currentLabels);

      const hasNew: boolean = incomingLabels.some((label: string) => {
        return !currentSet.has(label);
      });

      if (hasNew) {
        update.labels = TelemetryEntityService.normalizeLabels([
          ...currentLabels,
          ...incomingLabels,
        ]);
      }
    }

    return update as unknown as QueryDeepPartialEntity<Model>;
  }

  /** Sorted + deduped for a stable stored value. */
  private static normalizeLabels(labels: Array<string>): Array<string> {
    return Array.from(new Set<string>(labels)).sort();
  }

  /**
   * Best-effort human-readable name for the entity explorer: prefer the
   * most specific `*.name` identifying attribute (e.g. k8s.pod.name over
   * k8s.cluster.name), else the last identifying value, else the key.
   */
  public static deriveDisplayName(entity: ExtractedEntity): string {
    const id: Record<string, string> = entity.identifyingAttributes || {};
    const nameKeys: Array<string> = Object.keys(id)
      .filter((k: string) => {
        return k.endsWith(".name");
      })
      .sort((a: string, b: string) => {
        return b.length - a.length;
      });

    if (nameKeys.length > 0 && id[nameKeys[0]!]) {
      return id[nameKeys[0]!]!;
    }

    const keys: Array<string> = Object.keys(id);
    if (keys.length > 0 && id[keys[keys.length - 1]!]) {
      return id[keys[keys.length - 1]!]!;
    }

    return entity.entityKey;
  }
}

export default new TelemetryEntityService();
