import DatabaseService from "./DatabaseService";
import Model from "Common/Models/DatabaseModels/CallLog";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    this.hardDeleteItemsOlderThanInDays("createdAt", 3);
  }
}

export default new Service();
