import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/DataDashboard";

/*
 * The dashboards of connected BI tools, and the watched tables behind each.
 * OneUptime writes them, from each tool (DataBiSync).
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  // Written from what the tool says, under the tool's own project.
  protected override checksServerWrites(): boolean {
    return false;
  }
}

export default new Service();
