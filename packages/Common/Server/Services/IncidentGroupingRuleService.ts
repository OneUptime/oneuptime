import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/IncidentGroupingRule";
import { IsBillingEnabled } from "../EnvironmentConfig";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import GroupingRuleEpisodeOwners from "../Utils/Rules/GroupingRuleEpisodeOwners";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

const SUBJECT: string = "incident grouping rule";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365); // 3 years
    }
  }

  /*
   * The rule's Episode Owners become owners of every episode it opens, and
   * the engine opens those as root: who they may be is decided here, where
   * the rule is written (see GroupingRuleEpisodeOwners).
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await GroupingRuleEpisodeOwners.validateOwnersOnCreate({
      projectId: createBy.props.tenantId || createBy.data.projectId,
      rule: createBy.data,
      subject: SUBJECT,
    });

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await GroupingRuleEpisodeOwners.validateOwnersOnUpdate({
      service: this,
      updateBy: updateBy,
      subject: SUBJECT,
    });

    return { updateBy, carryForward: null };
  }
}

export default new Service();
