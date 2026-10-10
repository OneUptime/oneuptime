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
import UserNotificationStatus from "../../Types/UserNotification/UserNotificationStatus";
import ColumnLength from "../../Types/Database/ColumnLength";
import logger from "../Utils/Logger";
import User from "../../Models/DatabaseModels/User";
import Model from "../../Models/DatabaseModels/UserOnCallLogTimeline";
import AlertService from "./AlertService";
import AlertEpisodeService from "./AlertEpisodeService";
import IncidentEpisodeService from "./IncidentEpisodeService";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A page the Notification service deliberately did not send - the
   * project's balance could not pay for it, the project has the channel
   * turned off, the project is gone - says so on the person's on-call
   * timeline, with the reason the message's own log gives, instead of
   * staying at "Sending" for ever. Like the timeline's other skips (an
   * unverified number, say), it is recorded as Error: the page did not go
   * out.
   *
   * Never throws: the skip is already in the message's log, and a timeline
   * row that could not be written must not turn it into a failed send for
   * whoever asked for it.
   */
  @CaptureSpan()
  public async markNotSent(data: {
    userOnCallLogTimelineId?: ObjectID | undefined;
    reason: string;
  }): Promise<void> {
    if (!data.userOnCallLogTimelineId) {
      return;
    }

    try {
      await this.updateOneById({
        id: data.userOnCallLogTimelineId,
        data: {
          status: UserNotificationStatus.Error,
          statusMessage: data.reason.substring(0, ColumnLength.LongText),
        },
        props: {
          isRoot: true,
        },
      });
    } catch (err) {
      logger.error(
        `On-call timeline ${data.userOnCallLogTimelineId.toString()}: could not record that a notification was not sent (${data.reason}): ${err}`,
      );
    }
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
          triggeredByAlertEpisodeId: true,
          triggeredByIncidentEpisodeId: true,
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
        /*
         * Alert-episode and incident-episode pages were never handled here, so
         * acknowledging one via call/SMS/email/push marked only this user's log
         * done but never acknowledged the EPISODE. ExecutePendingExecutions gates
         * every co-notified user's continuation solely on isEpisodeAcknowledged,
         * so the other responders kept escalating and the episode stayed
         * unacknowledged in its own state (audit F15). Handle both episode kinds
         * the same way incident/alert are handled below.
         */
        const isAlertEpisode: boolean = Boolean(item.triggeredByAlertEpisodeId);
        const isIncidentEpisode: boolean = Boolean(
          item.triggeredByIncidentEpisodeId,
        );

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

        const entityLabel: string =
          isIncident || isIncidentEpisode
            ? isIncidentEpisode
              ? "Incident Episode"
              : "Incident"
            : isAlertEpisode
              ? "Alert Episode"
              : "Alert";

        const statusMessage: string = `${entityLabel} acknowledged by ${user.name} (${user.email})`;

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

        /*
         * The record itself is acknowledged only when it is not already -
         * by the one rule (Common/Utils/AcknowledgedState): a colleague may
         * have acknowledged it first, or moved it on to a state after
         * Acknowledged, or resolved it. Their page is acknowledged above
         * either way; acknowledging the record again would be a move back
         * up its list, refused, and an error page for the responder who
         * only answered their page.
         *
         * It is OneUptime's acknowledge, credited to the responder: the
         * on-call policy paged them about this record, and answering the
         * page is what acknowledging it means.
         */
        if (
          isIncident &&
          !(await IncidentService.isIncidentAcknowledged({
            incidentId: item.triggeredByIncidentId!,
          }))
        ) {
          await IncidentService.acknowledgeIncident({
            incidentId: item.triggeredByIncidentId!,
            acknowledgedByUserId: item.userId!,
            props: {
              isRoot: true,
            },
          });
        }

        if (
          isAlert &&
          !(await AlertService.isAlertAcknowledged({
            alertId: item.triggeredByAlertId!,
          }))
        ) {
          await AlertService.acknowledgeAlert({
            alertId: item.triggeredByAlertId!,
            acknowledgedByUserId: item.userId!,
            props: {
              isRoot: true,
            },
          });
        }

        // An episode's - which also stops co-notified responders escalating.
        if (
          isAlertEpisode &&
          !(await AlertEpisodeService.isEpisodeAcknowledged({
            episodeId: item.triggeredByAlertEpisodeId!,
          }))
        ) {
          await AlertEpisodeService.acknowledgeEpisode(
            item.triggeredByAlertEpisodeId!,
            item.userId!,
          );
        }

        if (
          isIncidentEpisode &&
          !(await IncidentEpisodeService.isEpisodeAcknowledged({
            episodeId: item.triggeredByIncidentEpisodeId!,
          }))
        ) {
          await IncidentEpisodeService.acknowledgeEpisode(
            item.triggeredByIncidentEpisodeId!,
            item.userId!,
          );
        }
      }
    }

    return onUpdate;
  }
}

export default new Service();
