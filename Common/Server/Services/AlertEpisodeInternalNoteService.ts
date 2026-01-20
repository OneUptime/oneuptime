import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/AlertEpisodeInternalNote";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }
}

export default new Service();
