import { AppApiHostname } from "../EnvironmentConfig";
import ClusterKeyAuthorization from "../Middleware/ClusterKeyAuthorization";
import BaseService from "./BaseService";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import Protocol from "../../Types/API/Protocol";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import API from "../../Utils/API";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import BlockedProjectNotifications from "../Utils/Notification/BlockedProjectNotifications";
import NotificationDeliveryMetrics, {
  NotificationDeliveryChannel,
  NotificationDeliveryOutcome,
  NotificationDeliveryProvider,
  NotificationDispatch,
} from "../Utils/Telemetry/NotificationDeliveryMetrics";
import CustomChannelEdition, {
  CUSTOM_CHANNEL_NOT_ACTIVE_MESSAGE,
} from "../Utils/Notification/CustomChannelEdition";
import UserOnCallLogTimelineService from "./UserOnCallLogTimelineService";
import {
  getAnsweredFailureStatusMessage,
  recordNotificationRequestAnswer,
} from "../Utils/OnCall/OnCallSendFailure";

// How a delivery to a custom channel went, in words fit for its sender.
export interface CustomChannelDeliveryResult {
  ok: boolean;
  /*
   * The HTTP status the channel's service answered with, when it answered -
   * or the platform's own, when it refused the send (a blocked project) or
   * the Notification service answered with an error: the message says which.
   */
  statusCode?: number | undefined;
  message: string;
}

// The channel name a blocked project's refusal names (BlockedProjectNotifications).
export const CUSTOM_CHANNEL_DELIVERY_LABEL: string = "Custom Channel";

/*
 * Hands a request for a custom channel to the Enterprise Edition's sender
 * (ee/Server/CustomNotificationChannels, at
 * /api/notification/custom-channel/send), which reads what is needed to
 * send it - the channel's URL and secret, by id - and records how it went on
 * the notification's on-call log row. The request names the channel, never
 * its URL: nothing of a channel's address travels further than it has to.
 * While the feature is not active - always, on the Community Edition - it is
 * refused here (CustomChannelEdition).
 */
export class CustomNotificationChannelDeliveryService extends BaseService {
  public constructor() {
    super();
  }

  @CaptureSpan()
  public async send(data: {
    customNotificationChannelId: ObjectID;
    eventType: string;
    payload: JSONObject;
    projectId?: ObjectID | undefined;
    userOnCallLogTimelineId?: ObjectID | undefined;
    // A test is sent to a channel that is off as well, for its admin to try.
    isTest?: boolean | undefined;
  }): Promise<CustomChannelDeliveryResult> {
    /*
     * An Enterprise feature: nothing reaches a channel while it is not
     * active (CustomChannelEdition), and the on-call log says why rather
     * than "Sending" for ever. The Enterprise Edition sends the request.
     */
    if (!CustomChannelEdition.isActive()) {
      await UserOnCallLogTimelineService.markNotSent({
        userOnCallLogTimelineId: data.userOnCallLogTimelineId,
        reason: CUSTOM_CHANNEL_NOT_ACTIVE_MESSAGE,
      });

      // Not sent, for the platform's operator (NotificationDeliveryMetrics).
      if (!data.isTest) {
        NotificationDeliveryMetrics.recordNotSent({
          channel: NotificationDeliveryChannel.CustomChannel,
          isOnCallPage: Boolean(data.userOnCallLogTimelineId),
          customChannel: {
            id: data.customNotificationChannelId.toString(),
          },
        });
      }

      return {
        ok: false,
        message: CUSTOM_CHANNEL_NOT_ACTIVE_MESSAGE,
      };
    }

    // A project a master admin blocked sends nothing (BlockedProjectNotifications).
    const blockedProjectRefusal: HTTPErrorResponse | null =
      await BlockedProjectNotifications.getRefusal({
        channel: CUSTOM_CHANNEL_DELIVERY_LABEL,
        deliveryChannel: NotificationDeliveryChannel.CustomChannel,
        projectId: data.projectId,
        userOnCallLogTimelineId: data.userOnCallLogTimelineId,
      });

    if (blockedProjectRefusal) {
      return {
        ok: false,
        statusCode: blockedProjectRefusal.statusCode,
        message: blockedProjectRefusal.message,
      };
    }

    const body: JSONObject = {
      customNotificationChannelId: data.customNotificationChannelId.toString(),
      eventType: data.eventType,
      payload: data.payload,
      isTest: Boolean(data.isTest),
    };

    if (data.projectId) {
      body["projectId"] = data.projectId.toString();
    }

    if (data.userOnCallLogTimelineId) {
      body["userOnCallLogTimelineId"] = data.userOnCallLogTimelineId.toString();
    }

    /*
     * The Enterprise Edition's sender records how the request went
     * (CustomChannelSender). One that never got an answer from it is
     * recorded here, as a failure; a test, as there, is not recorded at all.
     */
    const dispatch: NotificationDispatch =
      NotificationDeliveryMetrics.startDispatch({
        channel: NotificationDeliveryChannel.CustomChannel,
        provider: NotificationDeliveryProvider.CustomChannel,
        isOnCallPage: Boolean(data.userOnCallLogTimelineId),
        customChannel: {
          id: data.customNotificationChannelId.toString(),
        },
      });

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: new URL(
          Protocol.HTTP,
          AppApiHostname,
          new Route("/api/notification/custom-channel/send"),
        ),
        data: body,
        headers: {
          ...ClusterKeyAuthorization.getClusterKeyHeaders(),
        },
        options: {
          sameServerRedirectsOnly: true,
        },
      });

    /*
     * The Notification service answered with an error: the sender did not
     * record how it went - it answers how it went otherwise, error or not -
     * so the notification says so here (issue #7083), with the answer's own
     * words, instead of Sending until the stuck check. Over Sending only
     * (OnCallSendFailure). A test has no notification: its admin reads the
     * words in the answer.
     */
    if (response instanceof HTTPErrorResponse) {
      if (!data.isTest) {
        dispatch.end(NotificationDeliveryOutcome.Failure);
      }

      if (data.userOnCallLogTimelineId && !data.isTest) {
        await recordNotificationRequestAnswer({
          userOnCallLogTimelineId: data.userOnCallLogTimelineId,
          answer: response,
        });
      }

      return {
        ok: false,
        statusCode: response.statusCode,
        message: getAnsweredFailureStatusMessage({
          statusCode: response.statusCode,
          message: response.message,
        }),
      };
    }

    const result: JSONObject = (response.data || {}) as JSONObject;

    return {
      ok: Boolean(result["ok"]),
      statusCode:
        typeof result["statusCode"] === "number"
          ? (result["statusCode"] as number)
          : undefined,
      message:
        typeof result["message"] === "string"
          ? (result["message"] as string)
          : "",
    };
  }
}

export default new CustomNotificationChannelDeliveryService();
