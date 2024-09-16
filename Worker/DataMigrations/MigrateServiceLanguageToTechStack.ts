import DataMigrationBase from "./DataMigrationBase";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import TechStack from "Common/Types/ServiceCatalog/TechStack";
import ServiceCatalogService from "Common/Server/Services/ServiceCatalogService";
import ServiceCatalog from "Common/Models/DatabaseModels/ServiceCatalog";

export default class MigrateServiceLanguageToTechStack extends DataMigrationBase {
  public constructor() {
    super("MigrateServiceLanguageToTechStack");
  }

  public override async migrate(): Promise<void> {
    // get all the users with email isVerified true.
    const serviceCatalogs: Array<ServiceCatalog> =
      await ServiceCatalogService.findBy({
        query: {},
        select: {
          _id: true,
          serviceLanguage: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: {
          isRoot: true,
        },
      });

    for (const serviceCatalog of serviceCatalogs) {
      const techStack: Array<TechStack> = [];
      if (serviceCatalog.serviceLanguage) {
        techStack.push(serviceCatalog.serviceLanguage);
      }

      // update the service catalog with tech stack.
      await ServiceCatalogService.updateOneById({
        id: serviceCatalog.id!,
        data: {
          techStack: techStack,
        },
        props: {
          isRoot: true,
        },
      });
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
