import DatabaseService from "./DatabaseService";
import MonitorTest from "Common/Models/DatabaseModels/MonitorTest";

export class MonitorTestService extends DatabaseService<MonitorTest> {
  public constructor() {
    super(MonitorTest);
  }
}

export default new MonitorTestService();
