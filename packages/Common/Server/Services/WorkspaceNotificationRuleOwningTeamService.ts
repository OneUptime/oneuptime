import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/WorkspaceNotificationRuleOwningTeam";

/*
 * The teams that own a workspace notification rule. Only those teams, and the project's
 * owners and admins, add or remove one once the rule has any
 * (TeamOwnedRulePermission); the team and the rule must be the project's
 * (ProjectReferencesService).
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }
}

export default new Service();
