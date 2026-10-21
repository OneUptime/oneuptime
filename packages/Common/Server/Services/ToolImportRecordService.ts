import Model from "../../Models/DatabaseModels/ToolImportRecord";
import DatabaseService from "./DatabaseService";

/*
 * What imports from another tool brought over, by the tool's id. Written and
 * read only by the import itself (Utils/ToolImport/ToolImportApplier), as
 * root.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }
}

export default new Service();
