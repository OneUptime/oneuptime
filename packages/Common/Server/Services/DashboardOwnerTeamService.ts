import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/DashboardOwnerTeam";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }
}
export default new Service();
