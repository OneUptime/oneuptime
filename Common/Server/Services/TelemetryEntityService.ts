import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/TelemetryEntity";
import TelemetryEntityRelationshipService from "./TelemetryEntityRelationshipService";
import EntityExtractor from "../Utils/Telemetry/EntityExtractor";
import ExtractedEntity from "../../Types/Telemetry/ExtractedEntity";
import EntityType from "../../Types/Telemetry/EntityType";
import ServiceType from "../../Types/Telemetry/ServiceType";
import Dictionary from "../../Types/Dictionary";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import GlobalCache from "../Infrastructure/GlobalCache";
import logger from "../Utils/Logger";

const RECONCILE_FENCE_NAMESPACE: string = "telemetry-entity-reconcile";
const RECONCILE_FENCE_TTL_SECONDS: number = 5 * 60; // 5 minutes

interface EntityResourcePointer {
  resourceType: string;
  resourceId: ObjectID;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Reconcile the registry + topology graph for one ingest resource
   * batch. Decoupled from signal writes (the caller fires this without
   * awaiting): signal `entityKeys` membership is correct immediately, the
   * registry and graph converge behind a throttle. Per-entity upserts are
   * fenced via Redis so steady-state ingest with unchanged entities costs
   * one cache check per entity, not a DB write.
   *
   * The `primary*` fields (the batch's existing single-owner selection)
   * link the matching entity's registry row to its rich typed resource
   * via the polymorphic (resourceType, resourceId) pointer, which governs
   * read access through @OwnedThrough.
   */
  @CaptureSpan()
  public async reconcileResource(data: {
    projectId: ObjectID;
    entities: Array<ExtractedEntity>;
    primaryServiceType?: ServiceType | undefined;
    primaryServiceId?: ObjectID | undefined;
  }): Promise<void> {
    if (!data.entities || data.entities.length === 0) {
      return;
    }

    for (const entity of data.entities) {
      try {
        if (!(await this.shouldReconcile(data.projectId, entity.entityKey))) {
          continue;
        }
        const pointer: EntityResourcePointer | null = this.resolvePointer(
          entity,
          data.primaryServiceType,
          data.primaryServiceId,
        );
        await this.upsertEntity({ projectId: data.projectId, entity, pointer });
      } catch (err) {
        logger.warn(
          `TelemetryEntityService.reconcileResource failed for ${entity.entityType} ${entity.entityKey}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    // Co-occurrence relationship edges fall out of the same entity set.
    try {
      const relationships: Array<{
        fromEntityKey: string;
        toEntityKey: string;
        relType: string;
      }> = EntityExtractor.inferRelationships(data.entities);
      if (relationships.length > 0) {
        await TelemetryEntityRelationshipService.reconcileEdges({
          projectId: data.projectId,
          relationships,
        });
      }
    } catch (err) {
      logger.warn(
        `TelemetryEntityService relationship reconcile failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /*
   * Upsert a registry row from an existing rich typed resource (Service /
   * Host / DockerHost / KubernetesCluster). Used by the one-time backfill
   * so historical entities get catalog rows + the polymorphic pointer.
   * The entityKey is computed with the same EntityExtractor.entityKey used
   * at ingest, so a backfilled row and the ingest-created row converge on
   * the same key (when the identifying attribute choice matches).
   */
  @CaptureSpan()
  public async upsertTypedEntity(data: {
    projectId: ObjectID;
    entityType: EntityType;
    identifyingAttributes: Dictionary<string>;
    descriptiveAttributes?: Dictionary<string> | undefined;
    displayName: string;
    resourceType: string;
    resourceId: ObjectID;
  }): Promise<void> {
    const entityKey: string = EntityExtractor.entityKey({
      projectId: data.projectId,
      entityType: data.entityType,
      identifyingAttributes: data.identifyingAttributes,
    });
    const entity: ExtractedEntity = {
      entityType: data.entityType,
      entityKey,
      displayName: data.displayName,
      identifyingAttributes: data.identifyingAttributes,
      descriptiveAttributes: data.descriptiveAttributes || {},
    };
    await this.upsertEntity({
      projectId: data.projectId,
      entity,
      pointer: {
        resourceType: data.resourceType,
        resourceId: data.resourceId,
      },
    });
  }

  private async shouldReconcile(
    projectId: ObjectID,
    entityKey: string,
  ): Promise<boolean> {
    try {
      const key: string = `${projectId.toString()}:${entityKey}`;
      const seen: string | null = await GlobalCache.getString(
        RECONCILE_FENCE_NAMESPACE,
        key,
      );
      if (seen) {
        return false;
      }
      await GlobalCache.setString(RECONCILE_FENCE_NAMESPACE, key, "1", {
        expiresInSeconds: RECONCILE_FENCE_TTL_SECONDS,
      });
      return true;
    } catch {
      return true;
    }
  }

  /*
   * Map the batch's single-owner primary selection to the matching
   * extracted entity, so that entity's registry row points at the rich
   * typed resource. Only the entity that corresponds to the primary owner
   * gets a pointer; secondary entities (a host a service merely runs on)
   * stay registry-only until they are themselves a primary, or until the
   * backfill links them.
   */
  private resolvePointer(
    entity: ExtractedEntity,
    primaryServiceType?: ServiceType | undefined,
    primaryServiceId?: ObjectID | undefined,
  ): EntityResourcePointer | null {
    if (!primaryServiceType || !primaryServiceId) {
      return null;
    }

    const matches: boolean =
      (primaryServiceType === ServiceType.OpenTelemetry &&
        entity.entityType === EntityType.Service) ||
      (primaryServiceType === ServiceType.Host &&
        entity.entityType === EntityType.Host) ||
      (primaryServiceType === ServiceType.DockerHost &&
        entity.entityType === EntityType.Host) ||
      (primaryServiceType === ServiceType.KubernetesCluster &&
        entity.entityType === EntityType.KubernetesCluster);

    if (!matches) {
      return null;
    }

    /*
     * resourceType names the rich typed Postgres table (a @OwnedThrough
     * parentModel) so Owned scope can union ids across the typed tables.
     */
    const resourceType: string =
      primaryServiceType === ServiceType.OpenTelemetry
        ? "Service"
        : primaryServiceType;

    return { resourceType, resourceId: primaryServiceId };
  }

  private async upsertEntity(data: {
    projectId: ObjectID;
    entity: ExtractedEntity;
    pointer: EntityResourcePointer | null;
  }): Promise<void> {
    const now: Date = OneUptimeDate.getCurrentDate();
    const { entity } = data;

    const existing: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        entityType: entity.entityType,
        entityKey: entity.entityKey,
      },
      select: {
        _id: true,
        descriptiveAttributes: true,
        resourceId: true,
      },
      props: { isRoot: true },
    });

    if (existing && existing.id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const update: any = {
        lastSeenAt: now,
        displayName: entity.displayName,
        descriptiveAttributes: {
          ...(existing.descriptiveAttributes || {}),
          ...entity.descriptiveAttributes,
        },
      };
      /*
       * Only set the pointer if we have one and it isn't already set, so a
       * secondary-membership upsert never clobbers an established link.
       */
      if (data.pointer && !existing.resourceId) {
        update.resourceType = data.pointer.resourceType;
        update.resourceId = data.pointer.resourceId;
      }
      await this.updateOneById({
        id: existing.id,
        data: update,
        props: { isRoot: true },
      });
      return;
    }

    try {
      const row: Model = new Model();
      row.projectId = data.projectId;
      row.entityType = entity.entityType;
      row.entityKey = entity.entityKey;
      row.displayName = entity.displayName;
      row.identifyingAttributes =
        entity.identifyingAttributes as Dictionary<string>;
      row.descriptiveAttributes =
        entity.descriptiveAttributes as Dictionary<string>;
      row.firstSeenAt = now;
      row.lastSeenAt = now;
      if (data.pointer) {
        row.resourceType = data.pointer.resourceType;
        row.resourceId = data.pointer.resourceId;
      }
      await this.create({ data: row, props: { isRoot: true } });
    } catch {
      /*
       * Concurrent insert raced us to the unique (projectId, entityType,
       * entityKey) index — harmless, the row now exists.
       */
    }
  }
}

export default new Service();
