import Model from "../../Models/DatabaseModels/ToolImportRun";
import DatabaseService from "./DatabaseService";

/*
 * Imports from another tool. Written and read only by the import itself
 * (Utils/ToolImport/ToolImportRunExecutor) and its API, as root.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }
}

export default new Service();
