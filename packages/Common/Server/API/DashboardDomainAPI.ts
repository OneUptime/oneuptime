import { DashboardCNameRecord } from "../EnvironmentConfig";
import DashboardDomainService, {
  Service as DashboardDomainServiceType,
} from "../Services/DashboardDomainService";
import BaseAPI from "./BaseAPI";
import DashboardDomain from "../../Models/DatabaseModels/DashboardDomain";
import CustomDomainRoutes from "./CustomDomainRoutes";

export default class DashboardDomainAPI extends BaseAPI<
  DashboardDomain,
  DashboardDomainServiceType
> {
  public constructor() {
    super(DashboardDomain, DashboardDomainService);

    /*
     * Check now (verify-cname), Order SSL, Reissue SSL and the Status
     * column's certificates: the same routes as a status page's custom
     * domains, registered once for both (CustomDomainRoutes). The three that
     * change a domain take what editing it takes.
     */
    CustomDomainRoutes.add({
      router: this.router,
      crudApiPath: new this.entityType().getCrudApiPath()?.toString() || "",
      service: DashboardDomainService,
      getCnameRecord: (): string => {
        return DashboardCNameRecord;
      },
      parentColumn: "dashboardId",
    });
  }
}
