import SecurityCaseAiAction from "../../Models/DatabaseModels/SecurityCaseAiAction";
import ProjectReferencesService from "./ProjectReferencesService";

/*
 * OneUptime AI's log of a security case it works (SecurityCaseAiAction,
 * #10352): written only by the responder (Server/Utils/AI/Security/
 * Response), and read like the case. A person approves, declines or undoes
 * an action through the case's routes, which write the row as OneUptime.
 * An action goes with its case.
 */
export class Service extends ProjectReferencesService<SecurityCaseAiAction> {
  public constructor() {
    super(SecurityCaseAiAction);
  }
}

export default new Service();
