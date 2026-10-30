import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/DataSecurityScan";

/*
 * Scan history: what each scan read and found, kept 90 days - long enough
 * to answer "what did Data Security look at last month", short enough that
 * a project scanning every store daily does not grow it without bound.
 */
export const DATA_SECURITY_SCAN_RETENTION_IN_DAYS: number = 90;

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    this.hardDeleteItemsOlderThanInDays(
      "createdAt",
      DATA_SECURITY_SCAN_RETENTION_IN_DAYS,
    );
  }
}

export default new Service();
