import LabelAndOwnerRuleBaseService from "./LabelAndOwnerRuleBaseService";
import Model from "../../Models/DatabaseModels/CloudResourceLabelRule";
import { IsBillingEnabled } from "../EnvironmentConfig";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { assertCloudRuleKind } from "../../Types/Cloud/CloudResourceKind";

export class Service extends LabelAndOwnerRuleBaseService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365);
    }
  }

  // The kind a rule is for is one of the two, or none (assertCloudRuleKind).
  protected override async checkCreateBeforeReferences(
    createBy: CreateBy<Model>,
  ): Promise<void> {
    assertCloudRuleKind(createBy.data.cloudResourceKind);
  }

  protected override async checkUpdateBeforeReferences(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    assertCloudRuleKind(
      (updateBy.data as { cloudResourceKind?: unknown }).cloudResourceKind,
    );
  }
}

export default new Service();
