import BadDataException from "../../Types/Exception/BadDataException";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import Model from "Common/Models/DatabaseModels/ServiceCatalogDependency";
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

    if (
      !createBy.data.dependencyServiceCatalogId &&
      !createBy.data.dependencyServiceCatalog
    ) {
      throw new BadDataException("dependencyServiceCatalog is required");
    }

    // serviceCatalogId and dependencyServiceCatalogId should not be the same
    const serviceCatalogId: string | ObjectID | undefined =
      createBy.data.serviceCatalogId || createBy.data.serviceCatalog?._id;
    const dependencyServiceCatalogId: string | ObjectID | undefined =
      createBy.data.dependencyServiceCatalogId ||
      createBy.data.dependencyServiceCatalog?._id;

    if (
      serviceCatalogId?.toString() === dependencyServiceCatalogId?.toString()
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
