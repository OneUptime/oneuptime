import DataSecurityAiDecision from "../../Models/DatabaseModels/DataSecurityAiDecision";
import { IsBillingEnabled } from "../EnvironmentConfig";
import ProjectReferencesService from "./ProjectReferencesService";

/*
 * Why OneUptime AI did, or did not, act on a Data Security issue (#10364):
 * one record per evaluation, written by the engine (DataSecurityAiEngine)
 * and never changed.
 */
export class Service extends ProjectReferencesService<DataSecurityAiDecision> {
  public constructor() {
    super(DataSecurityAiDecision);

    if (IsBillingEnabled) {
      // Only the newest record of an issue says anything; a year is plenty.
      this.hardDeleteItemsOlderThanInDays("createdAt", 365);
    }
  }

  /*
   * Written by OneUptime as it evaluates an issue, about records it found
   * itself; refusing one would only lose why it did what it did.
   */
  protected override checksServerWrites(): boolean {
    return false;
  }
}

export default new Service();
