import UserOnCallLogTimelineService from "../../Services/UserOnCallLogTimelineService";
import OnCallPagePassOn from "./OnCallPagePassOn";
import CustomChannelActionToken from "./CustomChannelActionToken";
import WorkspaceActionAuthorization from "../Workspace/WorkspaceActionAuthorization";
import WorkspaceMemberActions, {
  WorkspaceEventRecord,
  WorkspaceEventType,
} from "../Workspace/WorkspaceMemberActions";
import CaptureSpan from "../Telemetry/CaptureSpan";
import { DatabaseBaseModelType } from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AlertEpisodeStateTimeline from "../../../Models/DatabaseModels/AlertEpisodeStateTimeline";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import IncidentEpisodeStateTimeline from "../../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  CustomChannelAction,
  CustomChannelActionResult,
  isCustomChannelAction,
} from "../../../Types/CustomNotificationChannel/CustomNotificationChannelPayload";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import {
  OnCallPassOnAnswer,
  getOnCallPassOnRefusalSentence,
  getOnCallPassOnSentence,
} from "../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";

// What an action came to: the answer to the service's POST.
export interface CustomChannelActionAnswer {
  action: CustomChannelAction;
  result: CustomChannelActionResult;
  // In English, for the company's app to show as it is.
  message: string;
}

export const CUSTOM_CHANNEL_INVALID_LINK_MESSAGE: string =
  "This link is not valid, or has expired. Act on this page in OneUptime instead.";

export const CUSTOM_CHANNEL_NOT_A_CHANNEL_PAGE_MESSAGE: string =
  "This notification was not sent on a custom channel.";

// The record a page is about, as the workspace actions name it.
interface PagedRecord {
  event: { type: WorkspaceEventType; id: ObjectID };
  // The state timeline a resolve writes to, which the person must be allowed to create.
  stateTimelineModelType: DatabaseBaseModelType;
  noun: string;
}

/*
 * WHAT A CUSTOM CHANNEL'S SERVICE CAN DO ABOUT A PAGE.
 *
 * Its POST to an action link (CustomChannelActionToken.getActionLinks) acts on
 * that one notification, as the person it paged - what pressing the same
 * button on the page's own link, in the Dashboard or in Slack would do:
 *
 *   acknowledge  acknowledges their page (UserOnCallLogTimelineService
 *                acknowledgePage), and with it the record and the run;
 *   escalate     passes their page on to the next level and stops paging
 *                them (OnCallPagePassOn) - the person cannot take it;
 *   resolve      resolves the record, as the person, refused where their
 *                own permissions would refuse it in the Dashboard
 *                (WorkspaceMemberActions).
 *
 * Only a notification that went out on a custom channel - or as an SMS or a
 * call through the server's own gateway, which carries the same links - with
 * a valid token for it.
 */
export default class CustomChannelActions {
  @CaptureSpan()
  public static async act(data: {
    notificationId: string;
    action: string;
    token: unknown;
  }): Promise<CustomChannelActionAnswer> {
    if (!isCustomChannelAction(data.action)) {
      throw new BadDataException(
        `Unknown action: ${data.action}. Use acknowledge, escalate or resolve.`,
      );
    }

    if (!data.notificationId || !ObjectID.isValidUUID(data.notificationId)) {
      throw new BadDataException("A notification id is required.");
    }

    const notificationId: ObjectID = new ObjectID(data.notificationId);

    if (
      !CustomChannelActionToken.isValid({
        token: data.token,
        userOnCallLogTimelineId: notificationId,
      })
    ) {
      throw new NotAuthorizedException(CUSTOM_CHANNEL_INVALID_LINK_MESSAGE);
    }

    const notification: UserOnCallLogTimeline | null =
      await UserOnCallLogTimelineService.findOneById({
        id: notificationId,
        select: {
          _id: true,
          projectId: true,
          userId: true,
          isAcknowledged: true,
          onCallDutyPolicyExecutionLogId: true,
          customNotificationChannelId: true,
          userSmsId: true,
          userCallId: true,
          triggeredByIncidentId: true,
          triggeredByAlertId: true,
          triggeredByAlertEpisodeId: true,
          triggeredByIncidentEpisodeId: true,
          user: {
            timezone: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

    if (!notification || !notification.userId || !notification.projectId) {
      throw new NotAuthorizedException(CUSTOM_CHANNEL_INVALID_LINK_MESSAGE);
    }

    /*
     * Only a notification that goes out with these links: one on a custom
     * channel, or an SMS or a call - which carry them when the server sends
     * through its own gateway (CallAndSmsGatewayPayload). The token is the
     * server's, for this one notification, so it is minted for no other.
     */
    if (
      !notification.customNotificationChannelId &&
      !notification.userSmsId &&
      !notification.userCallId
    ) {
      throw new NotAuthorizedException(
        CUSTOM_CHANNEL_NOT_A_CHANNEL_PAGE_MESSAGE,
      );
    }

    switch (data.action) {
      case CustomChannelAction.Acknowledge:
        return await this.acknowledge(notification);
      case CustomChannelAction.Escalate:
        return await this.escalate(notification);
      case CustomChannelAction.Resolve:
        return await this.resolve(notification);
    }
  }

  private static async acknowledge(
    notification: UserOnCallLogTimeline,
  ): Promise<CustomChannelActionAnswer> {
    if (notification.isAcknowledged) {
      return {
        action: CustomChannelAction.Acknowledge,
        result: CustomChannelActionResult.AlreadyAcknowledged,
        message: "This page was already acknowledged.",
      };
    }

    /*
     * As the page's own Acknowledge link does: the row's update hook
     * acknowledges the page, the run and the record, credited to the person
     * (UserOnCallLogTimelineService.acknowledgePage).
     */
    await UserOnCallLogTimelineService.updateOneById({
      id: notification.id!,
      data: {
        acknowledgedAt: OneUptimeDate.getCurrentDate(),
        isAcknowledged: true,
        status: UserNotificationStatus.Acknowledged,
        statusMessage: "Notification Acknowledged",
      },
      props: {
        isRoot: true,
      },
    });

    return {
      action: CustomChannelAction.Acknowledge,
      result: CustomChannelActionResult.Acknowledged,
      message: "Acknowledged.",
    };
  }

  private static async escalate(
    notification: UserOnCallLogTimeline,
  ): Promise<CustomChannelActionAnswer> {
    const timezone: string | undefined =
      notification.user?.timezone?.toString() || undefined;

    if (!notification.onCallDutyPolicyExecutionLogId) {
      return {
        action: CustomChannelAction.Escalate,
        result: CustomChannelActionResult.NotEscalated,
        message:
          "This page did not come from an on-call policy, so there is no next level to escalate it to.",
      };
    }

    const answer: OnCallPassOnAnswer = await OnCallPagePassOn.passOn({
      userId: notification.userId!,
      executionLogId: notification.onCallDutyPolicyExecutionLogId,
      viaUserOnCallLogTimelineId: notification.id!,
    });

    if (answer.passedOn && answer.result) {
      return {
        action: CustomChannelAction.Escalate,
        result: CustomChannelActionResult.Escalated,
        message: getOnCallPassOnSentence(answer.result, {
          timezone: timezone,
          keepTogether: true,
        }),
      };
    }

    return {
      action: CustomChannelAction.Escalate,
      result: CustomChannelActionResult.NotEscalated,
      message: getOnCallPassOnRefusalSentence(answer, {
        timezone: timezone,
      }),
    };
  }

  private static async resolve(
    notification: UserOnCallLogTimeline,
  ): Promise<CustomChannelActionAnswer> {
    const record: PagedRecord | null = this.getPagedRecord(notification);

    if (!record) {
      throw new BadDataException(
        "This page is not about a record that can be resolved.",
      );
    }

    // The person's own permissions in the project, as the Dashboard has them.
    const props: DatabaseCommonInteractionProps =
      await WorkspaceActionAuthorization.getProjectMemberProps({
        userId: notification.userId!,
        projectId: notification.projectId!,
      });

    const event: WorkspaceEventRecord = await WorkspaceMemberActions.authorize({
      props: props,
      modelType: record.stateTimelineModelType,
      action: `resolve this ${record.noun}`,
      event: record.event,
    });

    if ((await WorkspaceMemberActions.getStanding(event)).isResolved) {
      return {
        action: CustomChannelAction.Resolve,
        result: CustomChannelActionResult.AlreadyResolved,
        message: `This ${record.noun} was already resolved.`,
      };
    }

    await WorkspaceMemberActions.resolve({
      event: event,
      props: props,
    });

    return {
      action: CustomChannelAction.Resolve,
      result: CustomChannelActionResult.Resolved,
      message: "Resolved.",
    };
  }

  // The record the page is about. A page names exactly one.
  public static getPagedRecord(
    notification: UserOnCallLogTimeline,
  ): PagedRecord | null {
    if (notification.triggeredByIncidentId) {
      return {
        event: {
          type: WorkspaceEventType.Incident,
          id: notification.triggeredByIncidentId,
        },
        stateTimelineModelType: IncidentStateTimeline,
        noun: "incident",
      };
    }

    if (notification.triggeredByAlertId) {
      return {
        event: {
          type: WorkspaceEventType.Alert,
          id: notification.triggeredByAlertId,
        },
        stateTimelineModelType: AlertStateTimeline,
        noun: "alert",
      };
    }

    if (notification.triggeredByIncidentEpisodeId) {
      return {
        event: {
          type: WorkspaceEventType.IncidentEpisode,
          id: notification.triggeredByIncidentEpisodeId,
        },
        stateTimelineModelType: IncidentEpisodeStateTimeline,
        noun: "incident episode",
      };
    }

    if (notification.triggeredByAlertEpisodeId) {
      return {
        event: {
          type: WorkspaceEventType.AlertEpisode,
          id: notification.triggeredByAlertEpisodeId,
        },
        stateTimelineModelType: AlertEpisodeStateTimeline,
        noun: "alert episode",
      };
    }

    return null;
  }
}
