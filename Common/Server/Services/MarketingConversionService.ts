import DatabaseService from "./DatabaseService";
import MarketingConversion from "../../Models/DatabaseModels/MarketingConversion";

export class Service extends DatabaseService<MarketingConversion> {
  public constructor() {
    super(MarketingConversion);
  }
}

export default new Service();
