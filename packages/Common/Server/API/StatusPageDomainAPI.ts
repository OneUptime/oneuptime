import { StatusPageCNameRecord } from "../EnvironmentConfig";
import StatusPageDomainService, {
  Service as StatusPageDomainServiceType,
} from "../Services/StatusPageDomainService";
import BaseAPI from "./BaseAPI";
import StatusPageDomain from "../../Models/DatabaseModels/StatusPageDomain";
import CustomDomainRoutes from "./CustomDomainRoutes";

export default class StatusPageDomainAPI extends BaseAPI<
  StatusPageDomain,
  StatusPageDomainServiceType
> {
  public constructor() {
    super(StatusPageDomain, StatusPageDomainService);

    /*
     * Check now (verify-cname), Order SSL, Reissue SSL and the Status
     * column's certificates: the same routes as a dashboard's custom
     * domains, registered once for both (CustomDomainRoutes). The three that
     * change a domain take what editing it takes.
     */
    CustomDomainRoutes.add({
      router: this.router,
      crudApiPath: new this.entityType().getCrudApiPath()?.toString() || "",
      service: StatusPageDomainService,
      getCnameRecord: (): string => {
        return StatusPageCNameRecord;
      },
      parentColumn: "statusPageId",
    });
  }
}
