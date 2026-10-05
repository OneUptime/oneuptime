import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/DashboardLabelRule";
import { IsBillingEnabled } from "../EnvironmentConfig";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365);
    }
  }
}

export default new Service();
