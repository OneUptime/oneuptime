import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/FormSubmissionMessage";

/*
 * The follow-up conversations of form submissions
 * (Common/Types/Form/FormFollowUp). Written and read only by the follow-up
 * routes, as root (Utils/Form/FormFollowUp). The team reads each message
 * as the private note it is also written as, on the record the submission
 * created, under that record's own access rules.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }
}

export default new Service();
