import Model from "../../Models/DatabaseModels/NetworkDeviceDiscoveryImport";
import DatabaseService from "./DatabaseService";

/*
 * Imports of discovered hosts as network devices. Written and read only by
 * the import itself (Utils/NetworkDiscovery/DiscoveryImportRunner) and its
 * API (API/NetworkDeviceDiscoveryImportAPI), as root: the API decides who
 * may see an import and act on it, and the runner creates every device and
 * monitor as the person who asked for the import.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }
}

export default new Service();
