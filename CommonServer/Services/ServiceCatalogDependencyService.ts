import BadDataException from "Common/Types/Exception/BadDataException";
import PostgresDatabase from "../Infrastructure/PostgresDatabase";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import Model from "Model/Models/ServiceCatalogDependency";

export class Service extends DatabaseService<Model> {
  public constructor(postgresDatabase?: PostgresDatabase) {
    super(Model, postgresDatabase);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    // select a random color.

    if (!createBy.data.serviceCatalogId) {
      throw new Error("serviceCatalogId is required");
    }

    if (!createBy.data.dependencyServiceCatalogId) {
      throw new Error("dependencyServiceCatalogId is required");
    }

    // serviceCatalogId and dependencyServiceCatalogId should not be the same

    if (
      createBy.data.serviceCatalogId ===
      createBy.data.dependencyServiceCatalogId
    ) {
      throw new BadDataException(
        "serviceCatalogId and dependencyServiceCatalogId should not be the same",
      );
    }

    return {
      carryForward: null,
      createBy: createBy,
    };
  }
}

export default new Service();
