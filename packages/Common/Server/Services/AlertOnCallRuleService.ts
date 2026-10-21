import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/AlertOnCallRule";
import { IsBillingEnabled } from "../EnvironmentConfig";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import OnCallRuleWhenToPageCheck from "../Utils/Rules/OnCallRuleWhenToPageCheck";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365); // 3 years
    }
  }

  /*
   * A rule that pages only during working hours has hours that open, in a
   * time zone OneUptime knows (OnCallRuleWhenToPageCheck): refused before
   * anything the rule names is looked up, the same for every caller.
   */
  protected override async checkCreateBeforeReferences(
    createBy: CreateBy<Model>,
  ): Promise<void> {
    OnCallRuleWhenToPageCheck.checkCreate(createBy);
  }

  protected override async checkUpdateBeforeReferences(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    await OnCallRuleWhenToPageCheck.checkUpdate({
      service: this,
      updateBy: updateBy,
    });
  }
}

export default new Service();
