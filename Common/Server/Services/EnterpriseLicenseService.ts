import DatabaseService from "./DatabaseService";
import EnterpriseLicense from "../../Models/DatabaseModels/EnterpriseLicense";

export class Service extends DatabaseService<EnterpriseLicense> {
  public constructor() {
    super(EnterpriseLicense);
  }
}

export default new Service();
