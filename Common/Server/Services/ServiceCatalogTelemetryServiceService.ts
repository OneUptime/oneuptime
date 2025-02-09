import BadDataException from "../../Types/Exception/BadDataException";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import Model from "Common/Models/DatabaseModels/ServiceCatalogTelemetryService";
import ObjectID from "../../Types/ObjectID";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    // select a random color.

    if (!createBy.data.serviceCatalogId && !createBy.data.serviceCatalog) {
      throw new BadDataException("serviceCatalog is required");
    }

    if (!createBy.data.telemetryService && !createBy.data.telemetryServiceId) {
      throw new BadDataException("telemetryService is required");
    }

    // serviceCatalogId and dependencyServiceCatalogId should not be the same
    const serviceCatalogId: string | ObjectID | undefined =
      createBy.data.serviceCatalogId || createBy.data.serviceCatalog?._id;
    const telemetryServiceId: string | ObjectID | undefined =
      createBy.data.telemetryServiceId || createBy.data.telemetryService?._id;

    // check if this telemetryService is already added to the service catalog for this service.

    const existingtelemetryService: Model | null = await this.findOneBy({
      query: {
        serviceCatalogId: serviceCatalogId as ObjectID,
        telemetryServiceId: telemetryServiceId as ObjectID,
      },
      props: {
        isRoot: true,
      },
    });

    if (existingtelemetryService) {
      throw new BadDataException(
        "Telemetry Service already exists for this service",
      );
    }

    return {
      carryForward: null,
      createBy: createBy,
    };
  }
}

export default new Service();
