import Model from "../../Models/DatabaseModels/CloudTagFinding";
import ProjectReferencesService from "./ProjectReferencesService";

/*
 * New cloud resources found without a required tag (CloudTagFinding,
 * #11012). Written only by the watcher (CloudTagWatcher), as OneUptime;
 * people read them.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }
}

export default new Service();
