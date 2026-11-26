import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/SecurityAutomaticResponseAction";

/*
 * What each automatic response policy did about an address (#10350): one
 * row each time a policy decides about an address of a case. Written by
 * OneUptime alone (SecurityAutomaticResponse) - the model gives no role a
 * write - and read by whoever reads playbooks.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }
}

export default new Service();
