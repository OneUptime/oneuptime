import LabelAndOwnerRuleBaseService from "./LabelAndOwnerRuleBaseService";
import Model from "../../Models/DatabaseModels/NetworkDeviceLabelRule";
import { IsBillingEnabled } from "../EnvironmentConfig";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import NetworkDeviceRulePatternValidator from "../Utils/NetworkDevice/RulePatternValidator";

export class Service extends LabelAndOwnerRuleBaseService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365);
    }
  }

  /*
   * A pattern that is neither a valid regex nor a wildcard can only ever
   * match nothing, and the rule engine has no way to say so - it just quietly
   * stops labelling. Reject it while the user is still looking at the form.
   * See Common/Utils/Rules/RulePatternMatchUtil for the accepted syntaxes.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    /*
     * A rule that adds something, naming the project's own records only,
     * before anything here reads one.
     */
    await super.onBeforeCreate(createBy);

    NetworkDeviceRulePatternValidator.validate({
      namePattern: createBy.data.networkDeviceNamePattern,
      descriptionPattern: createBy.data.networkDeviceDescriptionPattern,
    });

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    // The project's own records only, before anything here reads one.
    await super.onBeforeUpdate(updateBy);

    NetworkDeviceRulePatternValidator.validate({
      namePattern: (updateBy.data as any)["networkDeviceNamePattern"] as
        | string
        | undefined,
      descriptionPattern: (updateBy.data as any)[
        "networkDeviceDescriptionPattern"
      ] as string | undefined,
    });

    return { updateBy, carryForward: null };
  }
}

export default new Service();
