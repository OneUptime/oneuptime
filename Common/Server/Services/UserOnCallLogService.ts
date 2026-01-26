import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import IncidentService from "./IncidentService";
import OnCallDutyPolicyExecutionLogTimelineService from "./OnCallDutyPolicyExecutionLogTimelineService";
import UserNotificationRuleService from "./UserNotificationRuleService";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import NotificationRuleType from "../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import OnCallDutyExecutionLogTimelineStatus from "../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import PositiveNumber from "../../Types/PositiveNumber";
import UserNotificationEventType from "../../Types/UserNotification/UserNotificationEventType";
import UserNotificationExecutionStatus from "../../Types/UserNotification/UserNotificationExecutionStatus";
import Incident from "../../Models/DatabaseModels/Incident";
import UserNotificationRule from "../../Models/DatabaseModels/UserNotificationRule";
import Model from "../../Models/DatabaseModels/UserOnCallLog";
import { IsBillingEnabled } from "../EnvironmentConfig";
import Alert from "../../Models/DatabaseModels/Alert";
import AlertService from "./AlertService";
import AlertEpisode from "../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeService from "./AlertEpisodeService";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 30);
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    createBy.data.status = UserNotificationExecutionStatus.Scheduled;

    return {
      createBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: ObjectID[],
  ): Promise<OnUpdate<Model>> {
    if (onUpdate.updateBy.data.status) {
      //update the corresponding oncallTimeline.
      const items: Array<Model> = await this.findBy({
        query: onUpdate.updateBy.query,
        select: {
          onCallDutyPolicyExecutionLogTimelineId: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

      let status: OnCallDutyExecutionLogTimelineStatus | undefined = undefined;

      switch (onUpdate.updateBy.data.status) {
        case UserNotificationExecutionStatus.Completed:
          status = OnCallDutyExecutionLogTimelineStatus.NotificationSent;
          break;
        case UserNotificationExecutionStatus.Error:
          status = OnCallDutyExecutionLogTimelineStatus.Error;
          break;
        case UserNotificationExecutionStatus.Executing:
          status = OnCallDutyExecutionLogTimelineStatus.Executing;
          break;
        case UserNotificationExecutionStatus.Scheduled:
          status = OnCallDutyExecutionLogTimelineStatus.Started;
          break;
        case UserNotificationExecutionStatus.Started:
          status = OnCallDutyExecutionLogTimelineStatus.Started;
          break;
        default:
          throw new BadDataException("Invalid status");
      }

      for (const item of items) {
        await OnCallDutyPolicyExecutionLogTimelineService.updateOneById({
          id: item.onCallDutyPolicyExecutionLogTimelineId!,
          data: {
            status: status!,
            statusMessage: onUpdate.updateBy.data.statusMessage!,
          },
          props: {
            isRoot: true,
          },
        });
      }
    }

    return onUpdate;
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    // update this item to be processed.
    await this.updateOneById({
      id: createdItem.id!,
      data: {
        status: UserNotificationExecutionStatus.Started,
      },
      props: {
        isRoot: true,
      },
    });

    const notificationRuleType: NotificationRuleType =
      this.getNotificationRuleType(createdItem.userNotificationEventType!);

    let ruleCount: PositiveNumber = new PositiveNumber(0);

    let incident: Incident | null = null;
    let alert: Alert | null = null;
    let alertEpisode: AlertEpisode | null = null;

    if (createdItem.triggeredByIncidentId) {
      incident = await IncidentService.findOneById({
        id: createdItem.triggeredByIncidentId,
        props: {
          isRoot: true,
        },
        select: {
          incidentSeverityId: true,
        },
      });

      // Check if there are any rules .
      ruleCount = await UserNotificationRuleService.countBy({
        query: {
          userId: createdItem.userId!,
          projectId: createdItem.projectId!,
          ruleType: notificationRuleType,
          incidentSeverityId: incident?.incidentSeverityId as ObjectID,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });
    }

    // get rule count for alerts.
    if (createdItem.triggeredByAlertId) {
      alert = await AlertService.findOneById({
        id: createdItem.triggeredByAlertId,
        props: {
          isRoot: true,
        },
        select: {
          alertSeverityId: true,
        },
      });

      ruleCount = await UserNotificationRuleService.countBy({
        query: {
          userId: createdItem.userId!,
          projectId: createdItem.projectId!,
          ruleType: notificationRuleType,
          alertSeverityId: alert?.alertSeverityId as ObjectID,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });
    }

    // get rule count for alert episodes.
    if (createdItem.triggeredByAlertEpisodeId) {
      alertEpisode = await AlertEpisodeService.findOneById({
        id: createdItem.triggeredByAlertEpisodeId,
        props: {
          isRoot: true,
        },
        select: {
          alertSeverityId: true,
        },
      });

      ruleCount = await UserNotificationRuleService.countBy({
        query: {
          userId: createdItem.userId!,
          projectId: createdItem.projectId!,
          ruleType: notificationRuleType,
          alertSeverityId: alertEpisode?.alertSeverityId as ObjectID,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });
    }

    if (ruleCount.toNumber() === 0) {
      // update this item to be processed.
      await this.updateOneById({
        id: createdItem.id!,
        data: {
          status: UserNotificationExecutionStatus.Error, // now the worker will pick this up and complete this or mark this as failed.
          statusMessage:
            "No notification rules found for this user. User should add the rules in User Settings > On-Call Rules.",
        },
        props: {
          isRoot: true,
        },
      });

      // update oncall timeline item as well.
      await OnCallDutyPolicyExecutionLogTimelineService.updateOneById({
        id: createdItem.onCallDutyPolicyExecutionLogTimelineId!,
        data: {
          status: OnCallDutyExecutionLogTimelineStatus.Error,
          statusMessage:
            "No notification rules found for this user. User should add the rules in User Settings > On-Call Rules.",
        },
        props: {
          isRoot: true,
        },
      });

      return createdItem;
    }

    // find immediate notification rule and alert the user.
    // Determine the alertSeverityId - can come from alert or alertEpisode
    const alertSeverityIdForQuery: ObjectID | undefined =
      alert && alert.alertSeverityId
        ? (alert.alertSeverityId as ObjectID)
        : alertEpisode && alertEpisode.alertSeverityId
          ? (alertEpisode.alertSeverityId as ObjectID)
          : undefined;

    const immediateNotificationRule: Array<UserNotificationRule> =
      await UserNotificationRuleService.findBy({
        query: {
          userId: createdItem.userId!,
          projectId: createdItem.projectId!,
          notifyAfterMinutes: 0,
          ruleType: notificationRuleType,
          incidentSeverityId:
            incident && incident.incidentSeverityId
              ? (incident?.incidentSeverityId as ObjectID)
              : undefined,
          alertSeverityId: alertSeverityIdForQuery,
        },
        select: {
          _id: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    for (const immediateNotificationRuleItem of immediateNotificationRule) {
      await UserNotificationRuleService.executeNotificationRuleItem(
        immediateNotificationRuleItem.id!,
        {
          userNotificationLogId: createdItem.id!,
          projectId: createdItem.projectId!,
          triggeredByIncidentId: createdItem.triggeredByIncidentId,
          triggeredByAlertId: createdItem.triggeredByAlertId,
          triggeredByAlertEpisodeId: createdItem.triggeredByAlertEpisodeId,
          userNotificationEventType: createdItem.userNotificationEventType!,
          onCallPolicyExecutionLogId:
            createdItem.onCallDutyPolicyExecutionLogId,
          onCallPolicyId: createdItem.onCallDutyPolicyId,
          onCallPolicyEscalationRuleId:
            createdItem.onCallDutyPolicyEscalationRuleId,
          userBelongsToTeamId: createdItem.userBelongsToTeamId,
          onCallDutyPolicyExecutionLogTimelineId:
            createdItem.onCallDutyPolicyExecutionLogTimelineId,
          onCallScheduleId: createdItem.onCallDutyScheduleId,
        },
      );
    }

    // update this item to be processed.
    await this.updateOneById({
      id: createdItem.id!,
      data: {
        status: UserNotificationExecutionStatus.Executing, // now the worker will pick this up and complete this or mark this as failed.
      },
      props: {
        isRoot: true,
      },
    });

    // update oncall timeline item as well.
    await OnCallDutyPolicyExecutionLogTimelineService.updateOneById({
      id: createdItem.onCallDutyPolicyExecutionLogTimelineId!,
      data: {
        status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
        statusMessage: "Alert Sent",
      },
      props: {
        isRoot: true,
      },
    });

    return createdItem;
  }

  public getNotificationRuleType(
    userNotificationEventType: UserNotificationEventType,
  ): NotificationRuleType {
    let notificationRuleType: NotificationRuleType =
      NotificationRuleType.ON_CALL_EXECUTED;

    if (
      userNotificationEventType === UserNotificationEventType.IncidentCreated ||
      userNotificationEventType === UserNotificationEventType.AlertCreated ||
      userNotificationEventType === UserNotificationEventType.AlertEpisodeCreated
    ) {
      notificationRuleType = NotificationRuleType.ON_CALL_EXECUTED;
    } else {
      // Invalid user notification event type.
      throw new BadDataException("Invalid user notification event type.");
    }
    return notificationRuleType;
  }
}
export default new Service();
