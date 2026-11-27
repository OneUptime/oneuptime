import Model from "../../Models/DatabaseModels/CloudTagCoverageDay";
import ProjectReferencesService from "./ProjectReferencesService";

/*
 * How many of an account's resources carried its required tags, a row a
 * day (CloudTagCoverageDay, #11012). Written only by the watcher
 * (CloudTagWatcher), as OneUptime; people read the trend.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }
}

export default new Service();
