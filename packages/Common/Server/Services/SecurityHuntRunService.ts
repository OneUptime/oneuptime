import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/SecurityHuntRun";
import { SECURITY_HUNT_RUN_RETENTION_IN_DAYS } from "../../Types/SecurityEvent/SecurityHunt";

/*
 * A hunt's run history (Models/DatabaseModels/SecurityHuntRun): one row
 * for each scheduled run that read events, written by the scheduler as the
 * run is recorded (SecurityHuntScheduler) and by nobody else, and deleted
 * once it is SECURITY_HUNT_RUN_RETENTION_IN_DAYS old by the daily clean-up
 * every such table has (HardDelete:HardDeleteOlderItemsInDatabase), or
 * with its hunt.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    this.hardDeleteItemsOlderThanInDays(
      "createdAt",
      SECURITY_HUNT_RUN_RETENTION_IN_DAYS,
    );
  }
}

export default new Service();
