import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/ServerlessFunctionInstance";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /**
   * Upsert a serverless function instance (faas.instance) from ingest.
   * Refreshes lastSeenAt if the instance already exists.
   */
  @CaptureSpan()
  public async recordInstance(data: {
    projectId: ObjectID;
    serverlessFunctionId: ObjectID;
    instanceName: string;
  }): Promise<void> {
    try {
      const existing: Model | null = await this.findOneBy({
        query: {
          projectId: data.projectId,
          serverlessFunctionId: data.serverlessFunctionId,
          instanceName: data.instanceName,
        },
        select: { _id: true },
        props: { isRoot: true },
      });

      if (existing && existing._id) {
        await this.updateOneById({
          id: new ObjectID(existing._id.toString()),
          data: { lastSeenAt: OneUptimeDate.getCurrentDate() },
          props: { isRoot: true },
        });
        return;
      }

      const item: Model = new Model();
      item.projectId = data.projectId;
      item.serverlessFunctionId = data.serverlessFunctionId;
      item.instanceName = data.instanceName;
      item.lastSeenAt = OneUptimeDate.getCurrentDate();
      await this.create({ data: item, props: { isRoot: true } });
    } catch (err) {
      // Inventory is best-effort — a unique-violation race or transient error
      // must never fail ingest.
      logger.warn(
        `ServerlessFunctionInstanceService.recordInstance failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

export default new Service();
