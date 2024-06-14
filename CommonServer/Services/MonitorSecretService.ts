import PostgresDatabase from "../Infrastructure/PostgresDatabase";
import DatabaseService from "./DatabaseService";
import MonitorSecret from "Model/Models/MonitorSecret";

export class Service extends DatabaseService<MonitorSecret> {
  public constructor(postgresDatabase?: PostgresDatabase) {
    super(MonitorSecret, postgresDatabase);
  }
}

export default new Service();
