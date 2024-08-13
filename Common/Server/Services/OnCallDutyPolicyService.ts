import DatabaseService from "./DatabaseService";
import OnCallDutyPolicyExecutionLogService from "./OnCallDutyPolicyExecutionLogService";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import UserNotificationEventType from "Common/Types/UserNotification/UserNotificationEventType";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";

export class Service extends DatabaseService<OnCallDutyPolicy> {
  public constructor() {
    super(OnCallDutyPolicy);
  }

  public async executePolicy(
    policyId: ObjectID,
    options: {
      triggeredByIncidentId?: ObjectID | undefined;
      userNotificationEventType: UserNotificationEventType;
    },
  ): Promise<void> {
    // execute this policy

    if (
      UserNotificationEventType.IncidentCreated ===
        options.userNotificationEventType &&
      !options.triggeredByIncidentId
    ) {
      throw new BadDataException(
        "triggeredByIncidentId is required when userNotificationEventType is IncidentCreated",
      );
    }

    const policy: OnCallDutyPolicy | null = await this.findOneById({
      id: policyId,
      select: {
        _id: true,
        projectId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!policy) {
      throw new BadDataException(
        `On-Call Duty Policy with id ${policyId.toString()} not found`,
      );
    }

    // add policy log.
    const log: OnCallDutyPolicyExecutionLog =
      new OnCallDutyPolicyExecutionLog();

    log.projectId = policy.projectId!;
    log.onCallDutyPolicyId = policyId;
    log.userNotificationEventType = options.userNotificationEventType;
    log.statusMessage = "Scheduled.";
    log.status = OnCallDutyPolicyStatus.Scheduled;

    if (options.triggeredByIncidentId) {
      log.triggeredByIncidentId = options.triggeredByIncidentId;
    }

    await OnCallDutyPolicyExecutionLogService.create({
      data: log,
      props: {
        isRoot: true,
      },
    });
  }
}
export default new Service();
