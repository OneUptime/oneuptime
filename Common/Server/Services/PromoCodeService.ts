import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/PromoCode";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }
}
export default new Service();
