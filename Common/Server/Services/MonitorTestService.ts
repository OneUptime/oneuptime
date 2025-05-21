import DatabaseService from "./DatabaseService";
import MonitorTest from "../../Models/DatabaseModels/MonitorTest";

export class Service extends DatabaseService<MonitorTest> {
  public constructor() {
    super(MonitorTest);
    this.hardDeleteItemsOlderThanInDays("createdAt", 2); // this is temporary data. Clear it after 2 days.
  }
}

export default new Service();
