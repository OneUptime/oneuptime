import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/FormSubmissionFollower";

/*
 * The people following form submissions (Common/Types/Form/FormFollowUp).
 * Written and read only by the follow-up routes, as root
 * (Utils/Form/FormFollowUp): the model gives nobody API access, since a row
 * holds a stranger's address and the secret of their link.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }
}

export default new Service();
