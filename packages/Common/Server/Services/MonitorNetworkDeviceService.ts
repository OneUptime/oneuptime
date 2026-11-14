import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/MonitorNetworkDevice";

/*
 * Reads which Network Device monitors watch which devices. Postgres writes
 * the rows (see the model); nothing here does.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }
}

export default new Service();
