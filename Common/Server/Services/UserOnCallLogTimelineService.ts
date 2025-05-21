import { OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import IncidentService from "./IncidentService";
import OnCallDutyPolicyExecutionLogService from "./OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "./OnCallDutyPolicyExecutionLogTimelineService";
import UserOnCallLogService from "./UserOnCallLogService";
import UserService from "./UserService";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import OnCallDutyExecutionLogTimelineStatus from "../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import OnCallDutyPolicyStatus from "../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import UserNotificationExecutionStatus from "../../Types/UserNotification/UserNotificationExecutionStatus";
import User from "../../Models/DatabaseModels/User";
import Model from "../../Models/DatabaseModels/UserOnCallLogTimeline";
import AlertService from "./AlertService";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: ObjectID[],
  ): Promise<OnUpdate<Model>> {
    if (
      onUpdate.updateBy.data.acknowledgedAt &&
      onUpdate.updateBy.data.isAcknowledged
    ) {
      const items: Array<Model> = await this.findBy({
        query: onUpdate.updateBy.query,
        select: {
          _id: true,
          projectId: true,
          userId: true,
          userNotificationLogId: true,
          onCallDutyPolicyExecutionLogId: true,
          triggeredByIncidentId: true,
          triggeredByAlertId: true,
          onCallDutyPolicyExecutionLogTimelineId: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

      for (const item of items) {
        const isIncident: boolean = Boolean(item.triggeredByIncidentId);
        const isAlert: boolean = Boolean(item.triggeredByAlertId);

        // this incident is acknowledged.

        // now we need to ack the parent log.

        const user: User | null = await UserService.findOneById({
          id: item.userId!,
          select: {
            _id: true,
            name: true,
            email: true,
          },
          props: {
            isRoot: true,
          },
        });

        if (!user) {
          throw new BadDataException("User not found.");
        }

        const statusMessage: string = `${isIncident ? "Incident" : "Alert"} acknowledged by ${user.name} (${user.email})`;

        await UserOnCallLogService.updateOneById({
          id: item.userNotificationLogId!,
          data: {
            acknowledgedAt: onUpdate.updateBy.data.acknowledgedAt,
            acknowledgedByUserId: item.userId!,
            status: UserNotificationExecutionStatus.Completed,
            statusMessage: statusMessage,
          },
          props: {
            isRoot: true,
          },
        });

        //  and then oncall log.

        await OnCallDutyPolicyExecutionLogService.updateOneById({
          id: item.onCallDutyPolicyExecutionLogId!,
          data: {
            acknowledgedAt: onUpdate.updateBy.data.acknowledgedAt,
            acknowledgedByUserId: item.userId!,
            status: OnCallDutyPolicyStatus.Completed,
            statusMessage: statusMessage,
          },
          props: {
            isRoot: true,
          },
        });

        // and then oncall log timeline.
        await OnCallDutyPolicyExecutionLogTimelineService.updateOneById({
          id: item.onCallDutyPolicyExecutionLogTimelineId!,
          data: {
            acknowledgedAt: onUpdate.updateBy.data.acknowledgedAt,
            isAcknowledged: true,
            status:
              OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
            statusMessage: statusMessage,
          },
          props: {
            isRoot: true,
          },
        });

        if (isIncident) {
          // incident.
          await IncidentService.acknowledgeIncident(
            item.triggeredByIncidentId!,
            item.userId!,
          );
        }

        if (isAlert) {
          // alert.
          await AlertService.acknowledgeAlert(
            item.triggeredByAlertId!,
            item.userId!,
          );
        }
      }
    }

    return onUpdate;
  }
}

export default new Service();
