import LabelAndOwnerRuleBaseService from "./LabelAndOwnerRuleBaseService";
import Model from "../../Models/DatabaseModels/NetworkDeviceOwnerRule";
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
   * Same contract as NetworkDeviceLabelRuleService: a pattern that can never
   * match is caught at write time rather than silently never adding owners.
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
