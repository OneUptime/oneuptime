import DataMigrationBase from "./DataMigrationBase";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import DomainService from "Common/Server/Services/DomainService";
import DomainModel from "Common/Models/DatabaseModels/Domain";
import Domain from "Common/Types/Domain";
import StatusPageDomain from "Common/Models/DatabaseModels/StatusPageDomain";
import StatusPageDomainService from "Common/Server/Services/StatusPageDomainService";
import logger from "Common/Server/Utils/Logger";

export default class LowercaseDomains extends DataMigrationBase {
  public constructor() {
    super("LowercaseDomains");
  }

  public override async migrate(): Promise<void> {
    const domains: Array<DomainModel> = await DomainService.findBy({
      query: {},
      select: {
        _id: true,
        domain: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    for (const domain of domains) {
      try {
        let domainString: string | undefined = undefined;

        if (domain.domain instanceof Domain) {
          domainString = domain.domain.domain;
        }

        // if string

        if (typeof domain.domain === "string") {
          domainString = domain.domain;
        }

        // Lowercase the domain
        if (!domainString) {
          continue;
        }

        domainString = domainString.toLowerCase().trim();

        // Update the domain

        await DomainService.updateOneBy({
          query: {
            _id: domain._id,
          },
          data: {
            domain: new Domain(domainString),
          },
          props: {
            isRoot: true,
          },
        });
      } catch (err) {
        logger.error("Error updating domain:");
        logger.error(err);
      }
    }

    // now get status page domains and lowercase them as well
    const statusPageDomains: Array<StatusPageDomain> =
      await StatusPageDomainService.findBy({
        query: {},
        select: {
          _id: true,
          fullDomain: true,
          subdomain: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: {
          isRoot: true,
        },
      });

    for (const statusPageDomain of statusPageDomains) {
      try {
        // update one by one
        await StatusPageDomainService.updateOneById({
          id: statusPageDomain.id!,
          data: {
            fullDomain: statusPageDomain.fullDomain?.toLowerCase().trim() || "",
            subdomain: statusPageDomain.subdomain?.toLowerCase().trim() || "",
          },
          props: {
            isRoot: true,
          },
        });
      } catch (err) {
        logger.error("Error updating status page domain:");
        logger.error(err);
      }
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
