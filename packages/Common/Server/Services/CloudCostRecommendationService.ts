import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/CloudCostRecommendation";

/*
 * The ways to spend less in the connected cloud accounts
 * (CloudCostRecommendation): written by the cloud connections' savings lane
 * only (CloudSavingsWriter), as root. Read through the API and the Cloud
 * pages; nobody creates, edits or deletes one.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }
}

export default new Service();
