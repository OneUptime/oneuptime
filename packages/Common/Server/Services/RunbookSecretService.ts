import DatabaseService from "./DatabaseService";
import RunbookSecret from "../../Models/DatabaseModels/RunbookSecret";

export class Service extends DatabaseService<RunbookSecret> {
  public constructor() {
    super(RunbookSecret);
  }
}

export default new Service();
