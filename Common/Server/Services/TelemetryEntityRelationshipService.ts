import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/TelemetryEntityRelationship";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { EntityRelationshipEdge } from "../../Utils/Telemetry/EntityRelationship";

export class TelemetryEntityRelationshipService extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /**
   * Forward-only topology reconciliation: upsert a row per directed edge and
   * bump `lastSeenAt`. Resilient — a topology-graph failure must never break
   * signal ingest, so every error is swallowed (logged). Callers throttle
   * this (see `OtelIngestBaseService.reconcileEntitiesThrottled`).
   */
  @CaptureSpan()
  public async reconcileRelationships(data: {
    projectId: ObjectID;
    edges: Array<EntityRelationshipEdge>;
  }): Promise<void> {
    for (const edge of data.edges) {
      try {
        await this.upsertRelationship({ projectId: data.projectId, edge });
      } catch (err) {
        logger.error(
          `TelemetryEntityRelationshipService: failed to upsert edge ${edge.fromEntityKey}-[${edge.relationshipType}]->${edge.toEntityKey}:`,
        );
        logger.error(err as Error);
      }
    }
  }

  private async upsertRelationship(data: {
    projectId: ObjectID;
    edge: EntityRelationshipEdge;
  }): Promise<void> {
    const { projectId, edge } = data;
    const now: Date = OneUptimeDate.getCurrentDate();

    const existing: Model | null = await this.findOneBy({
      query: {
        projectId,
        fromEntityKey: edge.fromEntityKey,
        toEntityKey: edge.toEntityKey,
        relationshipType: edge.relationshipType,
      },
      select: { _id: true },
      props: { isRoot: true },
    });

    if (existing) {
      await this.updateOneById({
        id: existing.id!,
        data: { lastSeenAt: now },
        props: { isRoot: true },
      });
      return;
    }

    const model: Model = new Model();
    model.projectId = projectId;
    model.fromEntityKey = edge.fromEntityKey;
    model.toEntityKey = edge.toEntityKey;
    model.relationshipType = edge.relationshipType;
    model.firstSeenAt = now;
    model.lastSeenAt = now;

    try {
      await this.create({ data: model, props: { isRoot: true } });
    } catch (err) {
      /*
       * A concurrent worker likely inserted the same edge — the unique
       * index rejected this. Harmless for a forward-only graph; the next
       * throttle window bumps lastSeenAt. Swallow + log.
       */
      logger.debug(
        `TelemetryEntityRelationshipService: create raced for ${edge.fromEntityKey}->${edge.toEntityKey} (likely concurrent insert): ${
          (err as Error)?.message
        }`,
      );
    }
  }
}

export default new TelemetryEntityRelationshipService();
