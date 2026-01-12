import BadDataException from "../../Types/Exception/BadDataException";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/ServiceCodeRepository";
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
    if (!createBy.data.serviceId && !createBy.data.service) {
      throw new BadDataException("service is required");
    }

    if (!createBy.data.codeRepository && !createBy.data.codeRepositoryId) {
      throw new BadDataException("codeRepository is required");
    }

    const serviceId: string | ObjectID | undefined =
      createBy.data.serviceId || createBy.data.service?._id;
    const codeRepositoryId: string | ObjectID | undefined =
      createBy.data.codeRepositoryId || createBy.data.codeRepository?._id;

    // check if this code repository is already added to the service for this service.
    const existingCodeRepository: Model | null = await this.findOneBy({
      query: {
        serviceId: serviceId as ObjectID,
        codeRepositoryId: codeRepositoryId as ObjectID,
      },
      props: {
        isRoot: true,
      },
    });

    if (existingCodeRepository) {
      throw new BadDataException(
        "Code Repository already exists for this service",
      );
    }

    return {
      carryForward: null,
      createBy: createBy,
    };
  }
}

export default new Service();
