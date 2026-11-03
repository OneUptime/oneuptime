import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/SecurityCaseNoteTemplate";

/*
 * A project's ready-made text for its security cases' notes, picked from a
 * case's note composer (Security Events > Settings > Note Templates).
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }
}
export default new Service();
