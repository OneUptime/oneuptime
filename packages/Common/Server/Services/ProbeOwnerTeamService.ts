import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/ProbeOwnerTeam";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }
}

export default new Service();
