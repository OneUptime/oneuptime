import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/NetworkSiteOwnerTeam";

/*
 * The teams who own a network site (#10188): made owners of the alert the
 * site raises when its health rolls up unhealthy, and the sites a role
 * limited to what its holder owns may change (OwnerTableRegistry). A site
 * keeps no timeline of its own, so adding or removing one is written to the
 * audit log, as every change through the API is.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }
}

export default new Service();
