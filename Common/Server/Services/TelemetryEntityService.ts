import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/TelemetryEntity";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { ExtractedEntity } from "../Utils/Telemetry/TelemetryEntity";

export class TelemetryEntityService extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /**
   * Forward-only registry reconciliation: upsert a catalog row per
   * discovered entity and bump `lastSeenAt`. Resilient by design — a
   * registry failure must never break signal ingest, so every error is
   * swallowed (logged). Callers are expected to throttle this (it should
   * not run on every batch); see
   * `OtelIngestBaseService.reconcileEntitiesThrottled`.
   */
  @CaptureSpan()
  public async reconcileEntities(data: {
    projectId: ObjectID;
    entities: Array<ExtractedEntity>;
  }): Promise<void> {
    for (const entity of data.entities) {
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

    const existing: Model | null = await this.findOneBy({
      query: {
        projectId,
        entityType: entity.entityType,
        entityKey: entity.entityKey,
      },
      select: { _id: true },
      props: { isRoot: true },
    });

    if (existing) {
      // Throttled bump of lastSeenAt (descriptive merge can come later).
      await this.updateOneById({
        id: existing.id!,
        data: { lastSeenAt: now },
        props: { isRoot: true },
      });
      return;
    }

    const model: Model = new Model();
    model.projectId = projectId;
    model.entityType = entity.entityType;
    model.entityKey = entity.entityKey;
    model.identifyingAttributes = entity.identifyingAttributes;
    model.displayName = TelemetryEntityService.deriveDisplayName(entity);
    model.firstSeenAt = now;
    model.lastSeenAt = now;

    try {
      await this.create({ data: model, props: { isRoot: true } });
    } catch (err) {
      /*
       * A concurrent worker likely created the same (projectId,
       * entityType, entityKey) — the unique index rejected this insert.
       * Harmless for a forward-only registry: the row exists, and the
       * next throttle window will bump lastSeenAt. Swallow + log.
       */
      logger.debug(
        `TelemetryEntityService: create raced for ${entity.entityType}/${entity.entityKey} (likely concurrent insert): ${
          (err as Error)?.message
        }`,
      );
    }
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
