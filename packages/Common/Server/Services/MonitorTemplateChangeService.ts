import Model from "../../Models/DatabaseModels/MonitorTemplateChange";
import DatabaseService from "./DatabaseService";

/*
 * Changes of many monitors' template (issues #11260, #11266). Written and
 * read only by the change itself (Utils/Monitor/MonitorTemplateChangeRunner)
 * and its API (API/MonitorTemplateChangeAPI), as root: the API decides who
 * may see a change and act on it, and the runner changes every monitor as
 * the person who asked for the change.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }
}

export default new Service();
