import BadDataException from "../../Types/Exception/BadDataException";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/ServiceDependency";
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

    if (
      !createBy.data.dependencyServiceId &&
      !createBy.data.dependencyService
    ) {
      throw new BadDataException("dependencyService is required");
    }

    // serviceId and dependencyServiceId should not be the same
    const serviceId: string | ObjectID | undefined =
      createBy.data.serviceId || createBy.data.service?._id;
    const dependencyServiceId: string | ObjectID | undefined =
      createBy.data.dependencyServiceId ||
      createBy.data.dependencyService?._id;

    if (
      serviceId?.toString() === dependencyServiceId?.toString()
    ) {
      throw new BadDataException("Service cannot depend on itself.");
    }

    return {
      carryForward: null,
      createBy: createBy,
    };
  }
}

export default new Service();
