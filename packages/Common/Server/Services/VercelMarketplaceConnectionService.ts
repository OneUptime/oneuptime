import DatabaseService from "./DatabaseService";
import VercelMarketplaceConnection from "../../Models/DatabaseModels/VercelMarketplaceConnection";

export class Service extends DatabaseService<VercelMarketplaceConnection> {
  public constructor() {
    super(VercelMarketplaceConnection);
  }
}

export default new Service();
