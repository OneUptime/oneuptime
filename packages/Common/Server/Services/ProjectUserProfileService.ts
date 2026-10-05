import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/ProjectUserProfile";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Anyone signed in may create a row of their own here, so their whole
   * create permission - the row must be theirs - comes before the project
   * check reads anything.
   */
  protected override checksCreatePermissionFirst(): boolean {
    return true;
  }
}
export default new Service();
