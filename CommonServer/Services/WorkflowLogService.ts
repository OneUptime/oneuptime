import PostgresDatabase from "../Infrastructure/PostgresDatabase";
import DatabaseService from "./DatabaseService";
import Model from "Common/AppModels/Models/WorkflowLog";

export class Service extends DatabaseService<Model> {
  public constructor(postgresDatabase?: PostgresDatabase) {
    super(Model, postgresDatabase);
    this.hardDeleteItemsOlderThanInDays("createdAt", 3);
  }
}
export default new Service();
