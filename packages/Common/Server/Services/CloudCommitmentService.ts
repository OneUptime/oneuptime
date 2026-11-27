import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/CloudCommitment";

/*
 * The commitments of the connected clouds (CloudCommitment): written by
 * the cloud connections' savings lane only (CloudCommitmentWriter), as
 * root, and their alerts kept by CloudCommitmentAlertEvaluator. Read
 * through the API and Cloud > Spend > Commitments; nobody creates, edits or
 * deletes one.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }
}

export default new Service();
