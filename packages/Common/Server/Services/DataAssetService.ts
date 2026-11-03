import ProjectReferencesService from "./ProjectReferencesService";
import DataAsset from "../../Models/DatabaseModels/DataAsset";

/*
 * The tables and views of connected data stores. OneUptime writes them as
 * it collects each store (Utils/DataObservability/TableHealthIngest); people
 * add a description, or delete one with its history.
 */
export class Service extends ProjectReferencesService<DataAsset> {
  public constructor() {
    super(DataAsset);
  }
}

export default new Service();
