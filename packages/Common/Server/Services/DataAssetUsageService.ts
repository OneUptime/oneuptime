import ProjectReferencesService from "./ProjectReferencesService";
import DataAssetUsage from "../../Models/DatabaseModels/DataAssetUsage";

/*
 * The services seen reading and writing each table. OneUptime writes them
 * from database spans (Utils/DataObservability/TableUsageDiscovery); nobody
 * else creates, edits or deletes one.
 */
export class Service extends ProjectReferencesService<DataAssetUsage> {
  public constructor() {
    super(DataAssetUsage);
  }

  /*
   * Written by discovery alone, which reads the table, the store and the
   * service from the project it works on; checking each reference again on
   * every write would only slow it.
   */
  protected override checksServerWrites(): boolean {
    return false;
  }
}

export default new Service();
