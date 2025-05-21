import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/StatusPageCustomField";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }
}
export default new Service();
