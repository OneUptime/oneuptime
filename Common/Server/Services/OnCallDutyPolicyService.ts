import DatabaseService from "./DatabaseService";
import OnCallDutyPolicyExecutionLogService from "./OnCallDutyPolicyExecutionLogService";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import OnCallDutyPolicyStatus from "../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import UserNotificationEventType from "../../Types/UserNotification/UserNotificationEventType";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import DatabaseConfig from "../DatabaseConfig";
import URL from "../../Types/API/URL";

export class Service extends DatabaseService<OnCallDutyPolicy> {
  public constructor() {
    super(OnCallDutyPolicy);
  }


    public async getOnCallPolicyLinkInDashboard(
      projectId: ObjectID,
      onCallDutyPolicyId: ObjectID,
    ): Promise<URL> {
      const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();
  
      return URL.fromString(dashboardUrl.toString()).addRoute(
        `/${projectId.toString()}/on-call-duty/policies/${onCallDutyPolicyId.toString()}`,
      );
    }
  

  public async executePolicy(
    policyId: ObjectID,
    options: {
      triggeredByIncidentId?: ObjectID | undefined;
      triggeredByAlertId?: ObjectID | undefined;
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

    if (
      UserNotificationEventType.AlertCreated ===
        options.userNotificationEventType &&
      !options.triggeredByAlertId
    ) {
      throw new BadDataException(
        "triggeredByAlertId is required when userNotificationEventType is IncidentCreated",
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

    if (options.triggeredByAlertId) {
      log.triggeredByAlertId = options.triggeredByAlertId;
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
