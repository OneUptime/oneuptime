import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/ServiceLabelRule";
import { IsBillingEnabled } from "../EnvironmentConfig";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365);
    }
  }
}

export default new Service();
