import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/HostCollectorConfigVersion";

/*
 * The versions of a Collector Config. Only HostCollectorConfigService writes
 * them, as root, from the config it has just saved: every column's create,
 * update and delete list is empty, so no caller can add, change or remove a
 * line of a config's history.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Its writes name only the config the service has just saved and the
   * person who saved it, so they are not checked again.
   */
  protected override checksServerWrites(): boolean {
    return false;
  }
}

export default new Service();
