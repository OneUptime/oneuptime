import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/TeamComplianceSetting";

export class TeamComplianceSettingService extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }
}

export default new TeamComplianceSettingService();