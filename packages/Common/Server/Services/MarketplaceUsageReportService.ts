import DatabaseService from "./DatabaseService";
import MarketplaceUsageReport from "../../Models/DatabaseModels/MarketplaceUsageReport";

export class Service extends DatabaseService<MarketplaceUsageReport> {
  public constructor() {
    super(MarketplaceUsageReport);
  }
}

export default new Service();
