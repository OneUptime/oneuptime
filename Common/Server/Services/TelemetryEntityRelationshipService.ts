import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/TelemetryEntityRelationship";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { EntityRelationshipEdge } from "../../Utils/Telemetry/EntityRelationship";
import { reconcileByNaturalKey } from "../Utils/Telemetry/EntityRegistry";

export class TelemetryEntityRelationshipService extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /**
   * Forward-only topology reconciliation: upsert a row per directed edge and
   * bump `lastSeenAt`. Resilient — a topology-graph failure must never break
   * signal ingest, so every error is swallowed (logged). Callers throttle
   * this (see `reconcileEntityRegistryThrottled` in
   * `Common/Server/Utils/Telemetry/EntityRegistry`), and only pass edges
   * among registry-promoted entities so every edge endpoint has a row.
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

    await reconcileByNaturalKey({
      service: this,
      query: {
        projectId,
        fromEntityKey: edge.fromEntityKey,
        toEntityKey: edge.toEntityKey,
        relationshipType: edge.relationshipType,
      },
      lastSeenAt: now,
      describe: `edge ${edge.fromEntityKey}-[${edge.relationshipType}]->${edge.toEntityKey}`,
      buildModel: () => {
        const model: Model = new Model();
        model.projectId = projectId;
        model.fromEntityKey = edge.fromEntityKey;
        model.toEntityKey = edge.toEntityKey;
        model.relationshipType = edge.relationshipType;
        model.firstSeenAt = now;
        model.lastSeenAt = now;
        return model;
      },
    });
  }
}

export default new TelemetryEntityRelationshipService();
