import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/TelemetryEntity";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import ColumnLength from "../../Types/Database/ColumnLength";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { ExtractedEntity } from "../Utils/Telemetry/TelemetryEntity";
import {
  reconcileByNaturalKey,
  REGISTRY_PROMOTED_TYPES,
} from "../Utils/Telemetry/EntityRegistry";

export class TelemetryEntityService extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /**
   * Forward-only registry reconciliation: upsert a catalog row per
   * discovered entity and bump `lastSeenAt`. High-churn membership-only
   * types (container / process / telemetry.sdk — see
   * `REGISTRY_PROMOTED_TYPES`) are skipped: their keys still flow into
   * the `entityKeys` column on signals, they just never mint registry
   * rows. Resilient by design — a registry failure must never break
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
    for (const entity of data.entities) {
      if (!REGISTRY_PROMOTED_TYPES.has(entity.entityType)) {
        continue;
      }
      try {
        await this.upsertEntity({ projectId: data.projectId, entity });
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
  }): Promise<void> {
    const { projectId, entity } = data;
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
      buildModel: () => {
        const model: Model = new Model();
        model.projectId = projectId;
        model.entityType = entity.entityType;
        model.entityKey = entity.entityKey;
        model.identifyingAttributes = entity.identifyingAttributes;
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
