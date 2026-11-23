import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/DataSecurityIssueGroup";

/*
 * Data Security issues one mistake made (#10370): written by the grouping
 * after each evaluation (Utils/DataSecurity/DataSecurityIssueGrouper), as
 * OneUptime, and read through Data Security's own routes
 * (Utils/DataSecurity/DataSecurityIssueGroups) - never through the API.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Groups are written by OneUptime as issues are grouped, crediting
   * whoever last asked for the fix - someone who may have left the project
   * since. Refusing one of those would only lose the record.
   */
  protected override checksServerWrites(): boolean {
    return false;
  }
}

export default new Service();
