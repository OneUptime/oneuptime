import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/CloudResourceInstance";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /**
   * Upsert a cloud-resource instance / task (service.instance.id) from ingest.
   * Refreshes lastSeenAt (and cpu/mem when provided) if it already exists.
   */
  @CaptureSpan()
  public async recordInstance(data: {
    projectId: ObjectID;
    cloudResourceId: ObjectID;
    instanceName: string;
    cpuPercent?: number | undefined;
    memoryBytes?: number | undefined;
  }): Promise<void> {
    try {
      const existing: Model | null = await this.findOneBy({
        query: {
          projectId: data.projectId,
          cloudResourceId: data.cloudResourceId,
          instanceName: data.instanceName,
        },
        select: { _id: true },
        props: { isRoot: true },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fields: any = { lastSeenAt: OneUptimeDate.getCurrentDate() };
      if (data.cpuPercent !== undefined) {
        fields.latestCpuPercent = data.cpuPercent;
      }
      if (data.memoryBytes !== undefined) {
        fields.latestMemoryBytes = data.memoryBytes;
      }

      if (existing && existing._id) {
        await this.updateOneById({
          id: new ObjectID(existing._id.toString()),
          data: fields,
          props: { isRoot: true },
        });
        return;
      }

      const item: Model = new Model();
      item.projectId = data.projectId;
      item.cloudResourceId = data.cloudResourceId;
      item.instanceName = data.instanceName;
      item.lastSeenAt = OneUptimeDate.getCurrentDate();
      if (data.cpuPercent !== undefined) {
        item.latestCpuPercent = data.cpuPercent;
      }
      if (data.memoryBytes !== undefined) {
        item.latestMemoryBytes = data.memoryBytes;
      }
      await this.create({ data: item, props: { isRoot: true } });
    } catch (err) {
      logger.warn(
        `CloudResourceInstanceService.recordInstance failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

export default new Service();
