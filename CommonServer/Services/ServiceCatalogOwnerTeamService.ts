import PostgresDatabase from "../Infrastructure/PostgresDatabase";
import DatabaseService from "./DatabaseService";
import Model from "Model/Models/ServiceCatalogOwnerTeam";

export class Service extends DatabaseService<Model> {
  public constructor(postgresDatabase?: PostgresDatabase) {
    super(Model, postgresDatabase);
  }
}

export default new Service();
