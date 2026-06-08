import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/TelemetryEntityRelationship";
import { ExtractedEntityRelationship } from "../../Types/Telemetry/ExtractedEntity";
import EntityRelationshipType from "../../Types/Telemetry/EntityRelationshipType";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import GlobalCache from "../Infrastructure/GlobalCache";
import logger from "../Utils/Logger";

const RECONCILE_FENCE_NAMESPACE: string = "telemetry-entity-rel-reconcile";
const RECONCILE_FENCE_TTL_SECONDS: number = 5 * 60; // 5 minutes

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Upsert a batch of co-occurrence edges (throttled per edge). Mirrors
   * the lastSeenAt / label-promotion throttle pattern used elsewhere on
   * the ingest path — steady-state ingest with unchanged topology costs
   * one Redis check per edge per fence window, not a DB write.
   */
  @CaptureSpan()
  public async reconcileEdges(data: {
    projectId: ObjectID;
    relationships: Array<ExtractedEntityRelationship>;
  }): Promise<void> {
    for (const edge of data.relationships) {
      try {
        if (
          !(await this.shouldReconcile(
            data.projectId,
            edge.fromEntityKey,
            edge.toEntityKey,
            edge.relType,
          ))
        ) {
          continue;
        }
        await this.upsertEdge({ projectId: data.projectId, edge });
      } catch (err) {
        logger.warn(
          `TelemetryEntityRelationshipService.reconcileEdges failed for ${edge.fromEntityKey}->${edge.toEntityKey}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  private async shouldReconcile(
    projectId: ObjectID,
    fromEntityKey: string,
    toEntityKey: string,
    relType: string,
  ): Promise<boolean> {
    try {
      const key: string = `${projectId.toString()}:${fromEntityKey}:${toEntityKey}:${relType}`;
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
      // Cache down — default to reconciling.
      return true;
    }
  }

  private async upsertEdge(data: {
    projectId: ObjectID;
    edge: ExtractedEntityRelationship;
  }): Promise<void> {
    const now: Date = OneUptimeDate.getCurrentDate();

    const existing: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        fromEntityKey: data.edge.fromEntityKey,
        toEntityKey: data.edge.toEntityKey,
        relType: data.edge.relType as EntityRelationshipType,
      },
      select: { _id: true },
      props: { isRoot: true },
    });

    if (existing && existing.id) {
      await this.updateOneById({
        id: existing.id,
        data: { lastSeenAt: now },
        props: { isRoot: true },
      });
      return;
    }

    try {
      const edge: Model = new Model();
      edge.projectId = data.projectId;
      edge.fromEntityKey = data.edge.fromEntityKey;
      edge.toEntityKey = data.edge.toEntityKey;
      edge.relType = data.edge.relType as EntityRelationshipType;
      edge.firstSeenAt = now;
      edge.lastSeenAt = now;
      await this.create({ data: edge, props: { isRoot: true } });
    } catch {
      /*
       * Concurrent insert raced us to the unique (projectId, from, to,
       * relType) index — harmless, the row now exists.
       */
    }
  }
}

export default new Service();
