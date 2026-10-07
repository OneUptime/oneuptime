import LabelAndOwnerRuleBaseService from "./LabelAndOwnerRuleBaseService";
import Model from "../../Models/DatabaseModels/IncomingCallPolicyLabelRule";

export class Service extends LabelAndOwnerRuleBaseService<Model> {
  public constructor() {
    super(Model);
  }
}

export default new Service();
