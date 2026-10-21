import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/FormSubmission";

/*
 * Form submissions are written by the form's submit route, as root (see
 * FormService.submitPublicForm); nothing here creates them, and the model
 * gives nobody else create or update.
 *
 * Unlike the incident form submissions they replaced, they are not narrowed
 * to the incidents a reader can see: a submission is read only by the
 * project's owners and admins - who see every incident - and by whoever is
 * given Read Form Submission on purpose (see the model). Everybody else
 * reads what a submission created on the record itself, under that record's
 * own access rules.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }
}

export default new Service();
