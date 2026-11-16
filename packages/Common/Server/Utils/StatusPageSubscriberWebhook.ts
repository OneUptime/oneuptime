import URL from "../../Types/API/URL";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import { JSONObject } from "../../Types/JSON";
import logger from "./Logger";
import SafeWebhookRequest, { WebhookTarget } from "./SafeWebhookRequest";
import SSRFProtection, {
  WebhookTargetValidationOptions,
} from "./SSRFProtection";
import SubscriberNotificationTiming from "./StatusPage/SubscriberNotificationTiming";
import NotificationDeliveryMetrics, {
  NotificationDeliveryChannel,
  NotificationDeliveryProvider,
  NotificationDestination,
  NotificationDispatch,
  NotificationDispatchStart,
  NotificationProviderConfig,
} from "./Telemetry/NotificationDeliveryMetrics";

export interface StatusPageWebhookPayload extends JSONObject {
  eventType: string;
  statusPageId: string;
  statusPageName: string;
  statusPageUrl: string;
  unsubscribeUrl: string;
  data: JSONObject;
}

/*
 * What a refusal of a private address tells a visitor signing up on the
 * status page. Appended to the refusal's own sentence, so it starts with a
 * space. It names no setting: none of the instance's settings could let a
 * sign-up's webhook through, and the visitor is not the one who runs the
 * instance anyway.
 */
export const SIGN_UP_PRIVATE_NETWORK_HINT: string =
  " Use a webhook URL on the public internet.";

/*
 * The same refusal of a subscriber that signed up on the status page, read
 * by the team: when a teammate changes that subscriber's webhook, and in
 * the reason a send to it failed. It says why the instance's private
 * network setting, which the team may well have turned on, does not apply.
 */
export const SIGNED_UP_SUBSCRIBER_PRIVATE_NETWORK_HINT: string =
  " This subscriber signed up on the status page, so its webhook must be on the public internet.";

/*
 * How long a post to a subscriber's webhook may take (issue #6845).
 *
 * Without a limit, an endpoint that took the connection and never answered
 * held its request and socket open for as long as it liked, and the message
 * was never counted (notification.send.count records a send when it returns
 * or throws). The subscriber jobs stop waiting for a message after
 * SubscriberNotificationTiming.SEND_TIMEOUT_IN_MS and count it failed, but
 * that never cancelled the request.
 *
 *   - An attempt waits up to SUBSCRIBER_WEBHOOK_ATTEMPT_TIMEOUT_IN_MS for the
 *     endpoint to answer, then fails and is tried again, as any other
 *     failure is (three retries, backing off).
 *   - Every attempt and every wait together take at most
 *     SUBSCRIBER_WEBHOOK_TOTAL_TIMEOUT_IN_MS: no attempt starts that it
 *     cannot pay for, and one still in flight when it runs out is aborted
 *     (SafeWebhookRequest). The post then throws - a failure, counted once -
 *     and its socket is closed.
 *
 * The total is half the message timeout, so a post always gives up on its
 * own, well before the job stops waiting for it: the job's timeout only ever
 * cuts off a message whose sender hangs, never a webhook. Thirty seconds an
 * attempt is generous for an endpoint that answers at all - a person's own
 * webhook waits ten - so a slow endpoint is not posted to again only
 * because it took its time.
 */
export const SUBSCRIBER_WEBHOOK_ATTEMPT_TIMEOUT_IN_MS: number = 30 * 1000;

export const SUBSCRIBER_WEBHOOK_TOTAL_TIMEOUT_IN_MS: number =
  SubscriberNotificationTiming.SEND_TIMEOUT_IN_MS / 2;

// How often a post is tried again after the first, backing off each time.
export const SUBSCRIBER_WEBHOOK_RETRIES: number = 3;

/*
 * What every post to a subscriber's webhook is counted as, for the
 * platform's operator (NotificationDeliveryMetrics, issue #6685): a webhook
 * message, to the subscriber's own endpoint - which the project's status
 * page posts to, as a project's own webhook ("project") - told apart from a
 * person's webhook by its destination. Never an on-call page, and never the
 * subscriber, its URL or what it was sent: every value is a fixed one.
 */
const SUBSCRIBER_WEBHOOK_DISPATCH: Readonly<NotificationDispatchStart> = {
  channel: NotificationDeliveryChannel.Webhook,
  provider: NotificationDeliveryProvider.Webhook,
  providerConfig: NotificationProviderConfig.Project,
  isOnCallPage: false,
  destination: NotificationDestination.StatusPageSubscriber,
};

export default class StatusPageSubscriberWebhookUtil {
  /*
   * What a subscriber's webhook URL may reach, decided by who wrote it.
   *
   * A subscriber that signed up on the status page: anyone who can open a
   * public status page can sign one up, with any URL. Its webhook reaches
   * public addresses only, whatever the instance allows, so no setting can
   * hand a visitor a POST into the network OneUptime runs in. A refusal the
   * visitor reads also leaves out what DNS answered (SSRFProtection), so the
   * page cannot be used to find out which internal names exist.
   *
   * A subscriber the team added - from the dashboard, with an API key or by
   * a workflow (StatusPageSubscriber.isAddedByTeam, which only OneUptime
   * writes): its URL was written by a member of the project, as a project
   * webhook's or a workflow's is, so it is held to the same rule as those.
   * Private addresses are refused unless the instance allows them
   * (ALLOW_PRIVATE_NETWORK_WEBHOOKS, PRIVATE_NETWORK_WEBHOOK_ALLOWLIST), and
   * then they are allowed (issue #6589). Loopback, link-local and the cloud
   * metadata endpoint stay refused unless the allowlist names them exactly.
   *
   * Anything but a definite true for isAddedByTeam is a sign-up.
   */
  public static getTargetValidationOptions(data: {
    isAddedByTeam: boolean | undefined;
    // Whether the visitor signing up reads the refusal, rather than the team.
    isRefusalShownToVisitor?: boolean | undefined;
  }): WebhookTargetValidationOptions {
    if (data.isAddedByTeam === true) {
      return {
        allowPrivateNetworkTargets: true,
      };
    }

    if (data.isRefusalShownToVisitor) {
      return {
        privateNetworkHint: SIGN_UP_PRIVATE_NETWORK_HINT,
        includeResolutionDetailInError: false,
      };
    }

    return {
      privateNetworkHint: SIGNED_UP_SUBSCRIBER_PRIVATE_NETWORK_HINT,
    };
  }

  /*
   * Refuses a subscriber's webhook URL that it may not reach (see
   * getTargetValidationOptions), with a BadDataException that says why.
   */
  public static async assertWebhookUrlAllowed(data: {
    webhookUrl: string | URL;
    isAddedByTeam: boolean | undefined;
    isRefusalShownToVisitor?: boolean | undefined;
  }): Promise<void> {
    await SSRFProtection.validateWebhookTargetIsSafe(
      data.webhookUrl,
      StatusPageSubscriberWebhookUtil.getTargetValidationOptions({
        isAddedByTeam: data.isAddedByTeam,
        isRefusalShownToVisitor: data.isRefusalShownToVisitor,
      }),
    );
  }

  /*
   * Posts one message to a subscriber's webhook, and counts it once for the
   * platform's operator (notification.send.count and .duration, issue
   * #6685), whoever sends it - every subscriber job, a scheduled event, the
   * message a new subscriber is sent:
   *
   *   - success: the endpoint answered with a 2xx status;
   *   - failure: it answered with anything else, the post threw (once
   *     API.post's own retries are spent, or when the endpoint did not
   *     answer in time: SUBSCRIBER_WEBHOOK_ATTEMPT_TIMEOUT_IN_MS and
   *     SUBSCRIBER_WEBHOOK_TOTAL_TIMEOUT_IN_MS), or its address was refused
   *     before any request (getTargetValidationOptions) - the subscriber
   *     got nothing, as when its endpoint is down, so its webhook shows in
   *     the success rate however long it fails.
   *
   * What it answers or throws is passed on as it always was.
   */
  public static async sendWebhookNotification(data: {
    webhookUrl: URL;
    /*
     * The subscriber's Is Added By Team, as stored. Required, so that every
     * sender says which subscriber it sends to: the rule its URL is held to
     * depends on it (getTargetValidationOptions).
     */
    isAddedByTeam: boolean | undefined;
    payload: StatusPageWebhookPayload;
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> {
    return await NotificationDeliveryMetrics.measureDispatch(
      SUBSCRIBER_WEBHOOK_DISPATCH,
      async (
        dispatch: NotificationDispatch,
      ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await StatusPageSubscriberWebhookUtil.postWebhookNotification(data);

        if (!StatusPageSubscriberWebhookUtil.isDelivered(response)) {
          dispatch.markFailed();
        }

        return response;
      },
    );
  }

  /*
   * Whether a subscriber's endpoint took a post: it answered, with a 2xx
   * status. An error answer - a refused address, a 4xx, a 5xx, a redirect
   * that is not followed - or no answer at all, is no delivery.
   */
  public static isDelivered(
    response: HTTPResponse<JSONObject> | HTTPErrorResponse | null | undefined,
  ): boolean {
    if (!response || response instanceof HTTPErrorResponse) {
      return false;
    }

    return response.statusCode >= 200 && response.statusCode < 300;
  }

  private static async postWebhookNotification(data: {
    webhookUrl: URL;
    isAddedByTeam: boolean | undefined;
    payload: StatusPageWebhookPayload;
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> {
    logger.debug("Sending status page subscriber webhook notification.");

    /*
     * Checked before every send, not just when the subscriber was saved, so
     * a URL stored before a check existed, or a host whose DNS has changed
     * since, cannot make the server reach somewhere it may not. The post
     * then dials an address this check approved and no other
     * (SafeWebhookRequest), so the name cannot resolve somewhere else in
     * between.
     */
    let target: WebhookTarget;

    try {
      target = await SafeWebhookRequest.resolveTarget(
        data.webhookUrl,
        StatusPageSubscriberWebhookUtil.getTargetValidationOptions({
          isAddedByTeam: data.isAddedByTeam,
        }),
      );
    } catch (err) {
      logger.warn(
        "Refusing to send status page subscriber webhook: unsafe URL.",
      );
      logger.warn(err);
      return new HTTPErrorResponse(
        400,
        {
          message:
            err instanceof Error ? err.message : "Webhook URL is not allowed.",
        },
        {},
      );
    }

    /*
     * No redirect is followed (SafeWebhookRequest): a validated public host
     * could otherwise 3xx-redirect the server to an internal address.
     */
    const apiResult: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await SafeWebhookRequest.send<JSONObject>(target, {
        data: data.payload,
        retries: SUBSCRIBER_WEBHOOK_RETRIES,
        exponentialBackoff: true,
        timeout: SUBSCRIBER_WEBHOOK_ATTEMPT_TIMEOUT_IN_MS,
        totalTimeoutInMs: SUBSCRIBER_WEBHOOK_TOTAL_TIMEOUT_IN_MS,
      });

    logger.debug("Status page subscriber webhook response:");
    logger.debug(apiResult);

    return apiResult;
  }
}
