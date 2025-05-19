import DatabaseService from "./DatabaseService";
import MonitorTest from "Common/Models/DatabaseModels/MonitorTest";
import ObjectID from "Common/Types/ObjectID";

export class Service extends DatabaseService<MonitorTest> {
  public constructor() {
    super(MonitorTest);
    this.hardDeleteItemsOlderThanInDays("createdAt", 2); // this is temporary data. Clear it after 2 days.
  }

  public async findByWithSecrets(options: any): Promise<Array<any>> {
    const monitorTests = await this.findBy(options);
    const MonitorSecretService = (await import("./MonitorSecretService")).default;
    for (const test of monitorTests) {
      if (test.monitorId) {
        test.secrets = await MonitorSecretService.findBy({
          query: { monitorId: test.monitorId },
          limit: 100,
          skip: 0,
          props: { isRoot: true },
        });
      } else {
        test.secrets = [];
      }
    }
    return monitorTests;
  }
}

export default new Service();
