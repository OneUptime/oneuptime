import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/ProjectSCIMLog";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    this.hardDeleteItemsOlderThanInDays("createdAt", 3);
  }
}

export default new Service();
