import { IsBillingEnabled } from "../EnvironmentConfig";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/WorkflowLog";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 30);
    }
  }
}
export default new Service();
