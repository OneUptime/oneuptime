import LabelAndOwnerRuleBaseService from "./LabelAndOwnerRuleBaseService";
import Model from "../../Models/DatabaseModels/OnCallDutyPolicyLabelRule";

export class Service extends LabelAndOwnerRuleBaseService<Model> {
  public constructor() {
    super(Model);
  }
}

export default new Service();
