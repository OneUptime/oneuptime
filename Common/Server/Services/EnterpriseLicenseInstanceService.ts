import DatabaseService from "./DatabaseService";
import EnterpriseLicenseInstance from "../../Models/DatabaseModels/EnterpriseLicenseInstance";

export class Service extends DatabaseService<EnterpriseLicenseInstance> {
  public constructor() {
    super(EnterpriseLicenseInstance);
  }
}

export default new Service();
