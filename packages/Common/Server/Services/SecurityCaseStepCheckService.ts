import SecurityCaseStepCheck from "../../Models/DatabaseModels/SecurityCaseStepCheck";
import ProjectReferencesService from "./ProjectReferencesService";

/*
 * What OneUptime found when it checked the steps of a security case's
 * Response Plan itself (SecurityCaseStepCheck, #10340): written only by the
 * step checks (Server/Utils/SecurityCase/StepChecks/
 * SecurityCaseStepCheckRunner), each change compare-and-set on when the
 * step was last checked, and read like the case. A check goes with its case.
 */
export class Service extends ProjectReferencesService<SecurityCaseStepCheck> {
  public constructor() {
    super(SecurityCaseStepCheck);
  }
}

export default new Service();
