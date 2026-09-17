import DatabaseService from "./DatabaseService";
import OpenSourceDeployment from "../../Models/DatabaseModels/OpenSourceDeployment";

export class Service extends DatabaseService<OpenSourceDeployment> {
  public constructor() {
    super(OpenSourceDeployment);
  }
}

export default new Service();
