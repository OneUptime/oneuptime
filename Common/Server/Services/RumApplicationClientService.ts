import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/RumApplicationClient";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /**
   * Upsert a RUM client platform (browser.platform / device.model) from
   * ingest. Refreshes lastSeenAt if it already exists.
   */
  @CaptureSpan()
  public async recordClient(data: {
    projectId: ObjectID;
    rumApplicationId: ObjectID;
    clientName: string;
    clientType?: string | undefined;
  }): Promise<void> {
    try {
      const existing: Model | null = await this.findOneBy({
        query: {
          projectId: data.projectId,
          rumApplicationId: data.rumApplicationId,
          clientName: data.clientName,
        },
        select: { _id: true },
        props: { isRoot: true },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fields: any = { lastSeenAt: OneUptimeDate.getCurrentDate() };
      if (data.clientType) {
        fields.clientType = data.clientType;
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
      item.rumApplicationId = data.rumApplicationId;
      item.clientName = data.clientName;
      item.lastSeenAt = OneUptimeDate.getCurrentDate();
      if (data.clientType) {
        item.clientType = data.clientType;
      }
      await this.create({ data: item, props: { isRoot: true } });
    } catch (err) {
      logger.warn(
        `RumApplicationClientService.recordClient failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

export default new Service();
