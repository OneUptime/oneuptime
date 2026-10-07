import LabelAndOwnerRuleBaseService from "./LabelAndOwnerRuleBaseService";
import Model from "../../Models/DatabaseModels/KubernetesClusterOwnerRule";
import { IsBillingEnabled } from "../EnvironmentConfig";

export class Service extends LabelAndOwnerRuleBaseService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365);
    }
  }
}

export default new Service();
