import BadDataException from "Common/Types/Exception/BadDataException";
import PostgresDatabase from "../Infrastructure/PostgresDatabase";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import Model from "Common/Models/DatabaseModels/ServiceCatalogMonitor";
import ObjectID from "Common/Types/ObjectID";

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

    if (!createBy.data.monitor && !createBy.data.monitorId) {
      throw new BadDataException("monitor is required");
    }

    // serviceCatalogId and dependencyServiceCatalogId should not be the same
    const serviceCatalogId: string | ObjectID | undefined =
      createBy.data.serviceCatalogId || createBy.data.serviceCatalog?._id;
    const monitorId: string | ObjectID | undefined =
      createBy.data.monitorId || createBy.data.monitor?._id;

    // check if this monitor is already added to the service catalog for this service.

    const existingMonitor: Model | null = await this.findOneBy({
      query: {
        serviceCatalogId: serviceCatalogId as ObjectID,
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
