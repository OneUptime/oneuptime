import Model from "../../Models/DatabaseModels/OpenStackProjectStatusPage";
import ProjectReferencesService from "./ProjectReferencesService";

// Which private status page is one OpenStack project's: see the model, and OpenStackProjectPages.
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }
}

export default new Service();
