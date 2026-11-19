import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/ManagedDevice";

/*
 * Devices a device management connection imports (ManagedDevice). Written
 * only by the connection's reads (DeviceManagementReadRunner), as root:
 * the API serves them read-only.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }
}

export default new Service();
