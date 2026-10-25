import Model from "../../Models/DatabaseModels/SecurityEntityRisk";
import DatabaseService from "./DatabaseService";

/*
 * Each user's, host's and address's risk. Written by OneUptime alone, as
 * findings arrive and as sources stop counting
 * (Utils/SecurityEvent/EntityRisk/SecurityEntityRiskRecorder); the Security
 * tiers read it, and who may delete security data may reset an entity's
 * risk by deleting its row.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }
}

export default new Service();
