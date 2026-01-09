import BadDataException from "../../Types/Exception/BadDataException";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/ServiceMonitor";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    // select a random color.

    if (!createBy.data.serviceId && !createBy.data.service) {
      throw new BadDataException("service is required");
    }

    if (!createBy.data.monitor && !createBy.data.monitorId) {
      throw new BadDataException("monitor is required");
    }

    // serviceId and dependencyServiceId should not be the same
    const serviceId: string | ObjectID | undefined =
      createBy.data.serviceId || createBy.data.service?._id;
    const monitorId: string | ObjectID | undefined =
      createBy.data.monitorId || createBy.data.monitor?._id;

    // check if this monitor is already added to the service for this service.

    const existingMonitor: Model | null = await this.findOneBy({
      query: {
        serviceId: serviceId as ObjectID,
        monitorId: monitorId as ObjectID,
      },
      props: {
        isRoot: true,
      },
    });

    if (existingMonitor) {
      throw new BadDataException("Monitor already exists for this service");
    }

    return {
      carryForward: null,
      createBy: createBy,
    };
  }
}

export default new Service();
