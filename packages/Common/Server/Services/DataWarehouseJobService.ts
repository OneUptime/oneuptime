import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/DataWarehouseJob";

/*
 * Each warehouse's jobs and what they spent over the last day. OneUptime
 * writes them, from each hourly collection (DataWarehouseSpendIngest).
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  // Written from a collection, under the store's own project.
  protected override checksServerWrites(): boolean {
    return false;
  }
}

export default new Service();
