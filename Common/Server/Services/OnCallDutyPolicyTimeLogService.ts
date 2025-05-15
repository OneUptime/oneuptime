import DatabaseService from "./DatabaseService";
import Model from "Common/Models/DatabaseModels/OnCallDutyPolicyTimeLog";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    this.hardDeleteItemsOlderThanInDays("createdAt", 180);
  }
}

export default new Service();
