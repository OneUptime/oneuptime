import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/ServiceLevelObjectiveLabelRule";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import SloRulePatternValidator from "../Utils/Slo/SloRulePatternValidator";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * No hard-delete retention: a rule is configuration, not an event log, so it
 * stays until somebody deletes it.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A pattern that is neither a valid regex nor a wildcard can only ever match
   * nothing, and the rule engine has no way to say so - it just quietly stops
   * labelling. Reject it while the user is still looking at the form.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    SloRulePatternValidator.validate({
      namePattern: createBy.data.serviceLevelObjectiveNamePattern,
      descriptionPattern: createBy.data.serviceLevelObjectiveDescriptionPattern,
    });

    return { createBy: createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    SloRulePatternValidator.validate({
      namePattern: updateBy.data.serviceLevelObjectiveNamePattern as
        | string
        | undefined,
      descriptionPattern: updateBy.data
        .serviceLevelObjectiveDescriptionPattern as string | undefined,
    });

    return { updateBy: updateBy, carryForward: null };
  }
}

export default new Service();
