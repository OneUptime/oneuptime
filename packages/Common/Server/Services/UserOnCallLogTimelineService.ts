import ProjectMilestoneService from "./ProjectMilestoneService";
import ActivationMilestone, {
  isNotificationDeliveredStatus,
} from "../../Types/Analytics/ActivationMilestone";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import UpdateBy from "../Types/Database/UpdateBy";
import OnCallPolicyRunMessage from "../Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
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
import logger from "../Utils/Logger";
import User from "../../Models/DatabaseModels/User";
import Model from "../../Models/DatabaseModels/UserOnCallLogTimeline";
import AlertService from "./AlertService";
import AlertEpisodeService from "./AlertEpisodeService";
import IncidentEpisodeService from "./IncidentEpisodeService";
import OnCallAcknowledgementTimeout from "../Utils/OnCall/OnCallAcknowledgementTimeout";
import OneUptimeDate from "../../Types/Date";
import {
  OnCallObserverPageRecordKind,
  getOnCallObserverPageSeenMessage,
  isOnCallObserverPage,
} from "../../Types/OnCallDutyPolicy/OnCallObserverPage";
import {
  OnCallPageChannel,
  OnCallPageNotificationEvent,
  getOnCallPageChannelsOf,
  isOnCallPageNotificationOut,
} from "../../Types/OnCallDutyPolicy/OnCallPageChannel";
import OnCallPageTiming, {
  OnCallPageStartMoment,
} from "../Utils/OnCall/OnCallPageTiming";
import OnCallSendLag, {
  OnCallScheduledSend,
} from "../Utils/OnCall/OnCallSendLag";
import NotificationDeliveryMetrics, {
  NotificationCustomChannelIdentity,
  NotificationDeliveryChannel,
} from "../Utils/Telemetry/NotificationDeliveryMetrics";
import CustomNotificationChannelService from "./CustomNotificationChannelService";
import CustomNotificationChannel from "../../Models/DatabaseModels/CustomNotificationChannel";
import UserNotificationEventType from "../../Types/UserNotification/UserNotificationEventType";
import { getOnCallTestPageAcknowledgedMessage } from "../../Types/OnCallDutyPolicy/OnCallTestPage";
import OnCallTestPageEvents from "../Utils/OnCall/OnCallTestPageEvents";
/*
 * Read when a send is refused (markNotSent), never as this module loads:
 * OnCallNotificationStatus writes through this service.
 */
import { recordSendResult } from "../Utils/OnCall/OnCallNotificationStatus";

/*
 * What the record's feed is told of a notification that an update gives
 * this status: one that could not be sent, or a call not answered. Null for
 * every other status - the feed hears of none of those from an update.
 */
export const getFeedEventOfStatus: (
  status: unknown,
) => OnCallPageNotificationEvent | null = (
  status: unknown,
): OnCallPageNotificationEvent | null => {
  switch (status) {
    case UserNotificationStatus.Error:
      return OnCallPageNotificationEvent.Failed;
    case UserNotificationStatus.NotAnswered:
      return OnCallPageNotificationEvent.NotAnswered;
    default:
      return null;
  }
};

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
   * out. Written as the send's result is, over Sending only
   * (OnCallNotificationStatus.recordSendResult): the person may have
   * answered the page meanwhile, from another of its messages.
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
      await recordSendResult({
        userOnCallLogTimelineId: data.userOnCallLogTimelineId,
        isSent: false,
        statusMessage: data.reason,
      });
    } catch (err) {
      logger.error(
        `On-call timeline ${data.userOnCallLogTimelineId.toString()}: could not record that a notification was not sent (${data.reason}): ${err}`,
      );
    }
  }

  /*
   * Records how long each notification just written as sent took to reach
   * its provider, for the platform's operator:
   *
   *   - one written as its page started, whose start was kept
   *     (OnCallPageTiming): how long after its page's trigger
   *     (notification.time_to_send);
   *   - one a worker sent once a wait of the on-call configuration ran out -
   *     a rule that waits, a repeat, a later escalation level, a policy
   *     repeat - whose due time was kept (OnCallSendLag): how long after it
   *     was due (notification.send.lag).
   *
   * Each is taken back here so it is recorded once. A notification that
   * names two channels - a rule written through the API can - is not timed:
   * which of them was accepted first cannot be told. Never throws.
   */
  private async recordTimeToSend(deliveries: Array<Model>): Promise<void> {
    for (const delivery of deliveries) {
      try {
        if (delivery.status !== UserNotificationStatus.Sent) {
          continue;
        }

        const pageStart: OnCallPageStartMoment | null =
          await OnCallPageTiming.takePageStartOf(delivery.id);

        // A page's start wins: nothing else was kept for one written in it.
        const scheduledSend: OnCallScheduledSend | null = pageStart
          ? null
          : await OnCallSendLag.takeDueTimeOf(delivery.id);

        if (!pageStart && !scheduledSend) {
          continue;
        }

        const sentAt: Date = OneUptimeDate.getCurrentDate();
        const channels: Array<OnCallPageChannel> =
          getOnCallPageChannelsOf(delivery);

        if (channels.length !== 1) {
          continue;
        }

        const channel: NotificationDeliveryChannel | null =
          NotificationDeliveryMetrics.getChannelOfOnCallPage(channels[0]!);

        if (!channel) {
          continue;
        }

        const customChannel: NotificationCustomChannelIdentity | undefined =
          channel === NotificationDeliveryChannel.CustomChannel &&
          delivery.customNotificationChannelId
            ? await this.readCustomChannelIdentity(
                delivery.customNotificationChannelId,
              )
            : undefined;

        if (pageStart) {
          NotificationDeliveryMetrics.recordTimeToSend({
            channel: channel,
            customChannel: customChannel,
            triggerType: NotificationDeliveryMetrics.getTriggerTypeOf(delivery),
            pageStart: pageStart.start,
            timeToSendInMs: sentAt.getTime() - pageStart.startedAt.getTime(),
          });
        } else if (scheduledSend) {
          NotificationDeliveryMetrics.recordSendLag({
            channel: channel,
            customChannel: customChannel,
            triggerType: NotificationDeliveryMetrics.getTriggerTypeOf(delivery),
            schedule: scheduledSend.schedule,
            lagInMs: sentAt.getTime() - scheduledSend.dueAt.getTime(),
          });
        }
      } catch (err) {
        logger.error(
          `Could not record the time to send of on-call notification ${delivery.id?.toString()}: ${err}`,
        );
      }
    }
  }

  // A custom channel's id and name, as the metrics name it; its id alone when it cannot be read.
  private async readCustomChannelIdentity(
    customNotificationChannelId: ObjectID,
  ): Promise<NotificationCustomChannelIdentity> {
    const identity: NotificationCustomChannelIdentity = {
      id: customNotificationChannelId.toString(),
    };

    try {
      const customChannel: CustomNotificationChannel | null =
        await CustomNotificationChannelService.findOneById({
          id: customNotificationChannelId,
          select: {
            name: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (customChannel?.name) {
        identity.name = customChannel.name;
      }
    } catch (err) {
      logger.debug(
        `Could not read the name of custom channel ${customNotificationChannelId.toString()}: ${err}`,
      );
    }

    return identity;
  }

  /*
   * Tells the record's feed of one notification of a page, after the page's
   * own entry (OnCallDutyPolicyExecutionLogTimelineService
   * .addNotificationToFeed, which decides whether it is news): only one that
   * belongs to a page, and names the channel it went out by. Never throws.
   */
  private async addNotificationToFeed(
    notification: Model,
    event: OnCallPageNotificationEvent,
  ): Promise<void> {
    if (
      !notification.id ||
      !notification.onCallDutyPolicyExecutionLogTimelineId ||
      getOnCallPageChannelsOf(notification).length === 0
    ) {
      return;
    }

    await OnCallDutyPolicyExecutionLogTimelineService.addNotificationToFeed({
      onCallDutyPolicyExecutionLogTimelineId:
        notification.onCallDutyPolicyExecutionLogTimelineId,
      userOnCallLogTimelineId: notification.id,
      event: event,
    });
  }

  /*
   * The step of a page keeps the channels its page went out by, for the
   * run's Execution Timeline - which anybody who can read the run can read,
   * where these notifications are their person's own
   * (OnCallDutyPolicyExecutionLogTimelineService.refreshNotificationChannels).
   * Asked for once a step, of notifications written or given a status:
   * only of ones that belong to a page and name a channel. Never throws.
   */
  private async refreshStepNotificationChannels(
    notifications: Array<Model>,
  ): Promise<void> {
    const stepIds: Array<string> = [];

    for (const notification of notifications) {
      const stepId: string | undefined =
        notification.onCallDutyPolicyExecutionLogTimelineId?.toString();

      if (
        stepId &&
        !stepIds.includes(stepId) &&
        getOnCallPageChannelsOf(notification).length > 0
      ) {
        stepIds.push(stepId);
      }
    }

    for (const stepId of stepIds) {
      await OnCallDutyPolicyExecutionLogTimelineService.refreshNotificationChannels(
        new ObjectID(stepId),
      );
    }
  }

  /*
   * How a page reached somebody - a call, an SMS, an email - is named in the
   * on-call run's Slack / Microsoft Teams message (OnCallPolicyRunMessage):
   * each delivery that is written, or changes status, asks for it to be
   * brought up to date. Never waits on Slack or Teams.
   *
   * The record's feed names it too: the page's own entry names the
   * notifications that went out with it, and one that goes out later - a
   * call ten minutes on, by the person's own On-Call Rules - or that could
   * not be sent at all is an entry of its own. So does the run's Execution
   * Timeline, on the page's step ("Notified Via").
   */
  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    /*
     * A notification on its way out, written as its page starts: its page's
     * start is kept for whichever server writes that it was sent, before it
     * is handed to its sender (OnCallPageTiming). Written by a worker once a
     * wait ran out - a rule that waits, a repeat, a later level - its due
     * time is (OnCallSendLag). Nothing for any other.
     */
    if (createdItem.status === UserNotificationStatus.Sending) {
      await OnCallPageTiming.rememberPageStartOf(createdItem.id);
      await OnCallSendLag.rememberDueTimeOf(createdItem.id);
    }

    OnCallPolicyRunMessage.refresh(createdItem.onCallDutyPolicyExecutionLogId);

    this.noteDelivered(createdItem.status, [createdItem]);

    await this.refreshStepNotificationChannels([createdItem]);

    if (createdItem.status === UserNotificationStatus.Error) {
      await this.addNotificationToFeed(
        createdItem,
        OnCallPageNotificationEvent.Failed,
      );
    } else if (isOnCallPageNotificationOut(createdItem.status)) {
      await this.addNotificationToFeed(
        createdItem,
        OnCallPageNotificationEvent.SentLater,
      );
    }

    return createdItem;
  }

  /*
   * The project's first on-call page that reached a person (issue #6830):
   * its provider accepted it - a status that says it went out to them, not
   * one still on its way (isNotificationDeliveredStatus). Any channel.
   */
  private noteDelivered(status: unknown, deliveries: Array<Model>): void {
    if (typeof status !== "string" || !isNotificationDeliveredStatus(status)) {
      return;
    }

    for (const delivery of deliveries) {
      ProjectMilestoneService.reachInBackground({
        projectId: delivery.projectId,
        milestone: ActivationMilestone.FirstNotificationDelivered,
      });
    }
  }

  /*
   * The status each notification had before an update that marks it as not
   * sent, or as a call not answered, so the record's feed hears of it once -
   * not again when a second write says the same (onUpdateSuccess).
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const statusBeforeUpdate: Record<
      string,
      UserNotificationStatus | undefined
    > = {};

    if (getFeedEventOfStatus(updateBy.data.status)) {
      const itemsBeforeUpdate: Array<Model> =
        await this.findRowsAndHoldUpdateToThem(updateBy, {
          _id: true,
          status: true,
        });

      for (const item of itemsBeforeUpdate) {
        if (item.id) {
          statusBeforeUpdate[item.id.toString()] = item.status;
        }
      }
    }

    return {
      updateBy: updateBy,
      carryForward: {
        statusBeforeUpdate: statusBeforeUpdate,
      },
    };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: ObjectID[],
  ): Promise<OnUpdate<Model>> {
    if (onUpdate.updateBy.data.status && updatedItemIds.length > 0) {
      let deliveries: Array<Model> = [];

      try {
        deliveries = await this.findBy({
          query: {
            _id: QueryHelper.any(updatedItemIds),
          },
          select: {
            _id: true,
            status: true,
            onCallDutyPolicyExecutionLogId: true,
            onCallDutyPolicyExecutionLogTimelineId: true,
            userCallId: true,
            userSmsId: true,
            userWhatsAppId: true,
            userTelegramId: true,
            userPushId: true,
            userEmailId: true,
            userSlackId: true,
            userMicrosoftTeamsId: true,
            userMattermostId: true,
            userWebhookId: true,
            customNotificationChannelId: true,
            // The record it pages about, for its time to send (recordTimeToSend).
            triggeredByIncidentId: true,
            triggeredByAlertId: true,
            triggeredByIncidentEpisodeId: true,
            triggeredByAlertEpisodeId: true,
            // Whose first on-call page reached somebody (noteDelivered).
            projectId: true,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: {
            isRoot: true,
          },
        });

        for (const delivery of deliveries) {
          OnCallPolicyRunMessage.refresh(
            delivery.onCallDutyPolicyExecutionLogId,
          );
        }
      } catch (err) {
        logger.error(
          `Could not ask for the on-call run's chat message to be updated: ${err}`,
        );
      }

      /*
       * A notification its provider accepted: how long after its page's
       * trigger (notification.time_to_send), or after it was due
       * (notification.send.lag), for the platform's operator.
       */
      if (onUpdate.updateBy.data.status === UserNotificationStatus.Sent) {
        await this.recordTimeToSend(deliveries);
      }

      this.noteDelivered(onUpdate.updateBy.data.status, deliveries);

      /*
       * A status can take a channel off its step's list - one that could
       * not be sent after all - or put it back.
       */
      await this.refreshStepNotificationChannels(deliveries);

      /*
       * A notification that could not be sent after all - its provider
       * refused it, its push token is gone - or a call that rang and was
       * not picked up is told of in the record's feed, once: a second write
       * saying the same is no news. A status not read before the update
       * counts as a change.
       */
      const event: OnCallPageNotificationEvent | null = getFeedEventOfStatus(
        onUpdate.updateBy.data.status,
      );

      if (event) {
        const status: UserNotificationStatus = onUpdate.updateBy.data
          .status as UserNotificationStatus;

        const statusBeforeUpdate:
          | Record<string, UserNotificationStatus | undefined>
          | undefined = (
          onUpdate.carryForward as {
            statusBeforeUpdate?: Record<
              string,
              UserNotificationStatus | undefined
            >;
          } | null
        )?.statusBeforeUpdate;

        for (const delivery of deliveries) {
          const id: string = delivery.id?.toString() || "";

          const wasSoBefore: boolean = Boolean(
            statusBeforeUpdate &&
              id in statusBeforeUpdate &&
              statusBeforeUpdate[id] === status,
          );

          if (delivery.status === status && !wasSoBefore) {
            await this.addNotificationToFeed(delivery, event);
          }
        }
      }
    }

    /*
     * The notifications the update wrote, read by id: an acknowledgement is
     * written at the status and the version it was read at
     * (OnCallNotificationStatus.recordAcknowledgement), which the row no
     * longer has once it is written - read by the update's own query, it
     * found nothing, and the page was never acknowledged.
     */
    if (
      onUpdate.updateBy.data.acknowledgedAt &&
      onUpdate.updateBy.data.isAcknowledged &&
      updatedItemIds.length > 0
    ) {
      const items: Array<Model> = await this.findBy({
        query: {
          _id: QueryHelper.any(updatedItemIds),
        },
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
          /*
           * A test page (OnCallTestPage) says which message it was
           * acknowledged from, and how long after that message went out.
           */
          userNotificationEventType: true,
          createdAt: true,
          userCallId: true,
          userSmsId: true,
          userWhatsAppId: true,
          userTelegramId: true,
          userPushId: true,
          userEmailId: true,
          userSlackId: true,
          userMicrosoftTeamsId: true,
          userMattermostId: true,
          userWebhookId: true,
          customNotificationChannelId: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

      const acknowledgedAt: Date = OneUptimeDate.fromString(
        onUpdate.updateBy.data.acknowledgedAt as Date,
      );

      for (const item of items) {
        await this.acknowledgePage({
          userOnCallLogId: item.userNotificationLogId!,
          userId: item.userId!,
          onCallDutyPolicyExecutionLogId: item.onCallDutyPolicyExecutionLogId,
          onCallDutyPolicyExecutionLogTimelineId:
            item.onCallDutyPolicyExecutionLogTimelineId,
          triggeredByIncidentId: item.triggeredByIncidentId,
          triggeredByAlertId: item.triggeredByAlertId,
          triggeredByAlertEpisodeId: item.triggeredByAlertEpisodeId,
          triggeredByIncidentEpisodeId: item.triggeredByIncidentEpisodeId,
          acknowledgedAt: acknowledgedAt,
          userNotificationEventType: item.userNotificationEventType,
          acknowledgedFrom: {
            channel: getOnCallPageChannelsOf(item)[0],
            sentAt: item.createdAt,
          },
          projectId: item.projectId,
        });
      }
    }

    return onUpdate;
  }

  /*
   * ACKNOWLEDGES ONE PERSON'S PAGE: their notification log, the run it is a
   * page of, the run's line for them, the record it is about (when it is
   * not acknowledged already), and the acknowledgement timeout's clock
   * (OnCallAcknowledgementTimeout). What answering a page does - its link,
   * a call's 1, a text - and what the Dashboard's Acknowledge does for a
   * page again, whose record was acknowledged all along. As OneUptime,
   * credited to the person.
   */
  @CaptureSpan()
  public async acknowledgePage(page: {
    userOnCallLogId: ObjectID;
    userId: ObjectID;
    onCallDutyPolicyExecutionLogId?: ObjectID | undefined;
    onCallDutyPolicyExecutionLogTimelineId?: ObjectID | undefined;
    triggeredByIncidentId?: ObjectID | undefined;
    triggeredByAlertId?: ObjectID | undefined;
    triggeredByAlertEpisodeId?: ObjectID | undefined;
    triggeredByIncidentEpisodeId?: ObjectID | undefined;
    acknowledgedAt: Date;
    // The page's event type: a test page (OnCallTestPage) is acknowledged in its own words.
    userNotificationEventType?: UserNotificationEventType | undefined;
    // The message it was acknowledged from, when one was: by what, and when it went out.
    acknowledgedFrom?:
      | {
          channel?: OnCallPageChannel | undefined;
          sentAt?: Date | undefined;
        }
      | undefined;
    // The page's project, for what a test page's acknowledgement records.
    projectId?: ObjectID | undefined;
  }): Promise<void> {
    if (page.userNotificationEventType === UserNotificationEventType.TestPage) {
      await this.acknowledgeTestPage(page);
      return;
    }

    const isIncident: boolean = Boolean(page.triggeredByIncidentId);
    const isAlert: boolean = Boolean(page.triggeredByAlertId);
    /*
     * Alert-episode and incident-episode pages were never handled here, so
     * acknowledging one via call/SMS/email/push marked only this user's log
     * done but never acknowledged the EPISODE. ExecutePendingExecutions gates
     * every co-notified user's continuation solely on isEpisodeAcknowledged,
     * so the other responders kept escalating and the episode stayed
     * unacknowledged in its own state (audit F15). Handle both episode kinds
     * the same way incident/alert are handled below.
     */
    const isAlertEpisode: boolean = Boolean(page.triggeredByAlertEpisodeId);
    const isIncidentEpisode: boolean = Boolean(
      page.triggeredByIncidentEpisodeId,
    );

    // this incident is acknowledged.

    // now we need to ack the parent log.

    const user: User | null = await UserService.findOneById({
      id: page.userId,
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

    /*
     * An observer's page (OnCallObserverPage) is answered by saying they
     * have seen it, and that is all it does: the record is not
     * acknowledged, nobody else's page stops, nobody becomes its Incident
     * Commander, and no acknowledgement timeout starts. Read from the run,
     * whoever asks: every way of answering a page reaches here.
     */
    const isObserverPage: boolean = page.onCallDutyPolicyExecutionLogId
      ? isOnCallObserverPage(
          await OnCallDutyPolicyExecutionLogService.findOneById({
            id: page.onCallDutyPolicyExecutionLogId,
            select: {
              _id: true,
              isObserverPage: true,
            },
            props: {
              isRoot: true,
            },
          }),
        )
      : false;

    const statusMessage: string = isObserverPage
      ? getOnCallObserverPageSeenMessage({
          kind: entityLabel.toLowerCase() as OnCallObserverPageRecordKind,
          userName: user.name?.toString() || "",
          userEmail: user.email?.toString() || "",
        })
      : `${entityLabel} acknowledged by ${user.name} (${user.email})`;

    await UserOnCallLogService.updateOneById({
      id: page.userOnCallLogId,
      data: {
        acknowledgedAt: page.acknowledgedAt,
        acknowledgedByUserId: page.userId,
        status: UserNotificationExecutionStatus.Completed,
        statusMessage: statusMessage,
      },
      props: {
        isRoot: true,
      },
    });

    //  and then oncall log.

    await OnCallDutyPolicyExecutionLogService.updateOneById({
      id: page.onCallDutyPolicyExecutionLogId!,
      data: {
        acknowledgedAt: page.acknowledgedAt,
        acknowledgedByUserId: page.userId,
        status: OnCallDutyPolicyStatus.Completed,
        statusMessage: statusMessage,
      },
      props: {
        isRoot: true,
      },
    });

    // and then oncall log timeline.
    await OnCallDutyPolicyExecutionLogTimelineService.updateOneById({
      id: page.onCallDutyPolicyExecutionLogTimelineId!,
      data: {
        acknowledgedAt: page.acknowledgedAt,
        isAcknowledged: true,
        status: OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
        statusMessage: statusMessage,
      },
      props: {
        isRoot: true,
      },
    });

    // An observer saw it: nothing else moves (see above).
    if (isObserverPage) {
      return;
    }

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
        incidentId: page.triggeredByIncidentId!,
      }))
    ) {
      await IncidentService.acknowledgeIncident({
        incidentId: page.triggeredByIncidentId!,
        acknowledgedByUserId: page.userId,
        props: {
          isRoot: true,
        },
      });
    }

    if (
      isAlert &&
      !(await AlertService.isAlertAcknowledged({
        alertId: page.triggeredByAlertId!,
      }))
    ) {
      await AlertService.acknowledgeAlert({
        alertId: page.triggeredByAlertId!,
        acknowledgedByUserId: page.userId,
        props: {
          isRoot: true,
        },
      });
    }

    // An episode's - which also stops co-notified responders escalating.
    if (
      isAlertEpisode &&
      !(await AlertEpisodeService.isEpisodeAcknowledged({
        episodeId: page.triggeredByAlertEpisodeId!,
      }))
    ) {
      await AlertEpisodeService.acknowledgeEpisode(
        page.triggeredByAlertEpisodeId!,
        page.userId,
      );
    }

    if (
      isIncidentEpisode &&
      !(await IncidentEpisodeService.isEpisodeAcknowledged({
        episodeId: page.triggeredByIncidentEpisodeId!,
      }))
    ) {
      await IncidentEpisodeService.acknowledgeEpisode(
        page.triggeredByIncidentEpisodeId!,
        page.userId,
      );
    }

    /*
     * A new acknowledgement: when the run's policy pages again after an
     * acknowledgement, its clock starts again from now - how a page
     * again is answered, since its record was acknowledged all along
     * (OnCallAcknowledgementTimeout). Never throws.
     */
    if (page.onCallDutyPolicyExecutionLogId) {
      await OnCallAcknowledgementTimeout.onPageAcknowledged({
        executionLogId: page.onCallDutyPolicyExecutionLogId,
        acknowledgedAt: page.acknowledgedAt,
      });
    }
  }

  /*
   * ACKNOWLEDGES A TEST PAGE (OnCallTestPage): the person's log, the run and
   * the run's line for them, in a test's words - who, by what, and how long
   * after their message went out ("Test page acknowledged by Ana Lopez by
   * SMS after 14 seconds."). There is no record to acknowledge, no clock to
   * start, and nobody else to page: the run is over. Whoever sent it sees it
   * in its result, and the first one acknowledged in a project is the
   * milestone its activation counts (OnCallTestPageEvents).
   */
  private async acknowledgeTestPage(page: {
    userOnCallLogId: ObjectID;
    userId: ObjectID;
    onCallDutyPolicyExecutionLogId?: ObjectID | undefined;
    onCallDutyPolicyExecutionLogTimelineId?: ObjectID | undefined;
    acknowledgedAt: Date;
    acknowledgedFrom?:
      | {
          channel?: OnCallPageChannel | undefined;
          sentAt?: Date | undefined;
        }
      | undefined;
    projectId?: ObjectID | undefined;
  }): Promise<void> {
    const user: User | null = await UserService.findOneById({
      id: page.userId,
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

    const sentAt: Date | undefined = page.acknowledgedFrom?.sentAt
      ? OneUptimeDate.fromString(page.acknowledgedFrom.sentAt)
      : undefined;

    const statusMessage: string = getOnCallTestPageAcknowledgedMessage({
      userName: user.name?.toString(),
      userEmail: user.email?.toString(),
      channel: page.acknowledgedFrom?.channel,
      afterSeconds: sentAt
        ? Math.max(0, (page.acknowledgedAt.getTime() - sentAt.getTime()) / 1000)
        : undefined,
    });

    await UserOnCallLogService.updateOneById({
      id: page.userOnCallLogId,
      data: {
        acknowledgedAt: page.acknowledgedAt,
        acknowledgedByUserId: page.userId,
        status: UserNotificationExecutionStatus.Completed,
        statusMessage: statusMessage,
      },
      props: {
        isRoot: true,
      },
    });

    /*
     * The run says who acknowledged it first: a colleague who answers the
     * same test afterwards has their own line acknowledged, and leaves the
     * run's answer as it is.
     */
    if (page.onCallDutyPolicyExecutionLogId) {
      await OnCallDutyPolicyExecutionLogService.updateOneBy({
        query: {
          _id: page.onCallDutyPolicyExecutionLogId.toString(),
          acknowledgedAt: QueryHelper.isNull(),
        },
        data: {
          acknowledgedAt: page.acknowledgedAt,
          acknowledgedByUserId: page.userId,
          status: OnCallDutyPolicyStatus.Completed,
          statusMessage: statusMessage,
        },
        props: {
          isRoot: true,
        },
      });
    }

    if (page.onCallDutyPolicyExecutionLogTimelineId) {
      await OnCallDutyPolicyExecutionLogTimelineService.updateOneById({
        id: page.onCallDutyPolicyExecutionLogTimelineId,
        data: {
          acknowledgedAt: page.acknowledgedAt,
          isAcknowledged: true,
          status: OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
          statusMessage: statusMessage,
        },
        props: {
          isRoot: true,
        },
      });
    }

    if (page.onCallDutyPolicyExecutionLogId) {
      OnCallTestPageEvents.onTestPageAcknowledged({
        projectId: page.projectId,
        executionLogId: page.onCallDutyPolicyExecutionLogId,
        acknowledgedByUserId: page.userId,
        channel: page.acknowledgedFrom?.channel,
      });
    }
  }
}

export default new Service();
