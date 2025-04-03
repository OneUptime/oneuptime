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
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import OnCallDutyPolicySchedule from "../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleService from "./OnCallDutyPolicyScheduleService";
import TeamService from "./TeamService";
import Team from "../../Models/DatabaseModels/Team";
import OnCallDutyPolicyEscalationRuleUser from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import OnCallDutyPolicyEscalationRuleUserService from "./OnCallDutyPolicyEscalationRuleUserService";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import OnCallDutyPolicyEscalationRuleTeam from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleTeamService from "./OnCallDutyPolicyEscalationRuleTeamService";
import QueryHelper from "../Types/Database/QueryHelper";
import OnCallDutyPolicyEscalationRuleSchedule from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleScheduleService from "./OnCallDutyPolicyEscalationRuleScheduleService";

export class Service extends DatabaseService<OnCallDutyPolicy> {
  public constructor() {
    super(OnCallDutyPolicy);
  }

  @CaptureSpan()
  public async getOnCallPolicyLinkInDashboard(
    projectId: ObjectID,
    onCallDutyPolicyId: ObjectID
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/on-call-duty/policies/${onCallDutyPolicyId.toString()}`
    );
  }

  @CaptureSpan()
  public async executePolicy(
    policyId: ObjectID,
    options: {
      triggeredByIncidentId?: ObjectID | undefined;
      triggeredByAlertId?: ObjectID | undefined;
      userNotificationEventType: UserNotificationEventType;
    }
  ): Promise<void> {
    // execute this policy

    if (
      UserNotificationEventType.IncidentCreated ===
        options.userNotificationEventType &&
      !options.triggeredByIncidentId
    ) {
      throw new BadDataException(
        "triggeredByIncidentId is required when userNotificationEventType is IncidentCreated"
      );
    }

    if (
      UserNotificationEventType.AlertCreated ===
        options.userNotificationEventType &&
      !options.triggeredByAlertId
    ) {
      throw new BadDataException(
        "triggeredByAlertId is required when userNotificationEventType is IncidentCreated"
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
        `On-Call Duty Policy with id ${policyId.toString()} not found`
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

  public async getOnCallPoliciesWhereUserIsOnCallDuty(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<{
    escalationRulesByUser: Array<OnCallDutyPolicyEscalationRuleUser>;
    escalationRulesByTeam: Array<OnCallDutyPolicyEscalationRuleTeam>;
    escalationRulesBySchedule: Array<OnCallDutyPolicyEscalationRuleSchedule>;
  }> {
    // get all schedules where user is on call duty.
    const onCallSchedules: Array<OnCallDutyPolicySchedule> =
      await OnCallDutyPolicyScheduleService.getOnCallSchedulesWhereUserIsOnCallDuty(
        data
      );

    const teams: Array<Team> = await TeamService.getTeamsUserIsAPartOf({
      userId: data.userId,
      projectId: data.projectId,
    });

    // get escalationPolicies by user, team and schedule.
    const escalationRulesByUser: Array<OnCallDutyPolicyEscalationRuleUser> =
      await OnCallDutyPolicyEscalationRuleUserService.findBy({
        query: {
          userId: data.userId!,
          projectId: data.projectId!,
        },
        select: {
          onCallDutyPolicyEscalationRule: {
            name: true,
            _id: true,
            order: true,
          },
          onCallDutyPolicy: {
            name: true,
            _id: true,
          },
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    // do the same for teams.
    const escalationRulesByTeam: Array<OnCallDutyPolicyEscalationRuleTeam> =
      await OnCallDutyPolicyEscalationRuleTeamService.findBy({
        query: {
          teamId: QueryHelper.any(teams.map((team) => team.id!)),
          projectId: data.projectId!,
        },
        select: {
          onCallDutyPolicy: {
            name: true,
            _id: true,
          },
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    // do the same for schedules.
    const escalationRulesBySchedule: Array<OnCallDutyPolicyEscalationRuleSchedule> =
      await OnCallDutyPolicyEscalationRuleScheduleService.findBy({
        query: {
          onCallDutyPolicyScheduleId: QueryHelper.any(
            onCallSchedules.map((schedule) => schedule.id!)
          ),
          projectId: data.projectId!,
        },
        select: {
          onCallDutyPolicy: {
            name: true,
            _id: true,
          },
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });


      return  {
        escalationRulesByUser: escalationRulesByUser,
        escalationRulesByTeam: escalationRulesByTeam,
        escalationRulesBySchedule: escalationRulesBySchedule,
      }
  }
}
export default new Service();
