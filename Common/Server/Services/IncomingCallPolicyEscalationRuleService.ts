import DatabaseService from "./DatabaseService";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import BadDataException from "../../Types/Exception/BadDataException";
import IncomingCallPolicyEscalationRule from "../../Models/DatabaseModels/IncomingCallPolicyEscalationRule";

export class Service extends DatabaseService<IncomingCallPolicyEscalationRule> {
  public constructor() {
    super(IncomingCallPolicyEscalationRule);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<IncomingCallPolicyEscalationRule>,
  ): Promise<OnCreate<IncomingCallPolicyEscalationRule>> {
    // Validate mutual exclusivity: either userId OR onCallDutyPolicyScheduleId must be set
    const hasUser: boolean = Boolean(createBy.data.userId);
    const hasSchedule: boolean = Boolean(
      createBy.data.onCallDutyPolicyScheduleId,
    );

    if (!hasUser && !hasSchedule) {
      throw new BadDataException(
        "Either a User or an On-Call Schedule must be specified for the escalation rule",
      );
    }

    if (hasUser && hasSchedule) {
      throw new BadDataException(
        "Only one of User or On-Call Schedule can be specified, not both",
      );
    }

    return {
      createBy,
      carryForward: null,
    };
  }
}

export default new Service();
