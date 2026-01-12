import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import ArrayUtil from "../../Utils/Array";
import { BrightColors } from "../../Types/BrandColors";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import Model from "../../Models/DatabaseModels/Service";
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
    createBy.data.serviceColor = ArrayUtil.selectItemByRandom(BrightColors);

    return {
      carryForward: null,
      createBy: createBy,
    };
  }

  @CaptureSpan()
  public async getTelemetryDataRetentionInDays(
    serviceId: ObjectID,
  ): Promise<number> {
    const service: Model | null = await this.findOneById({
      id: serviceId,
      select: {
        retainTelemetryDataForDays: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!service) {
      throw new BadDataException("Service not found");
    }

    return service.retainTelemetryDataForDays || 15; // default is 15 days.
  }
}

export default new Service();
