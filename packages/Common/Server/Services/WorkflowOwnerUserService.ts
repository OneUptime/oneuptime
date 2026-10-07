import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/WorkflowOwnerUser";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }
}
export default new Service();
