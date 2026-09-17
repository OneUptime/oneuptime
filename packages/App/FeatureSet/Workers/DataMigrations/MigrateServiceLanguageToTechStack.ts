import DataMigrationBase from "./DataMigrationBase";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import TechStack from "Common/Types/Service/TechStack";
import ServiceService from "Common/Server/Services/ServiceService";
import Service from "Common/Models/DatabaseModels/Service";

export default class MigrateServiceLanguageToTechStack extends DataMigrationBase {
  public constructor() {
    super("MigrateServiceLanguageToTechStack");
  }

  public override async migrate(): Promise<void> {
    // get all the services with serviceLanguage to migrate to techStack.
    const services: Array<Service> = await ServiceService.findBy({
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

    for (const service of services) {
      const techStack: Array<TechStack> = [];
      if (service.serviceLanguage) {
        techStack.push(service.serviceLanguage);
      }

      // update the service with tech stack.
      await ServiceService.updateOneById({
        id: service.id!,
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
