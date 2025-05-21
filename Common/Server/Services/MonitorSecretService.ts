import DatabaseService from "./DatabaseService";
import MonitorSecret from "../../Models/DatabaseModels/MonitorSecret";

export class Service extends DatabaseService<MonitorSecret> {
  public constructor() {
    super(MonitorSecret);
  }
}

export default new Service();
