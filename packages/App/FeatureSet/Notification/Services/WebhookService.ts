import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import WebhookStatus from "Common/Types/WebhookStatus";
import { JSONObject } from "Common/Types/JSON";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import WebhookLogService from "Common/Server/Services/WebhookLogService";
import logger, { EXTERNAL_FAULT } from "Common/Server/Utils/Logger";
import WebhookLog from "Common/Models/DatabaseModels/WebhookLog";
import API from "Common/Utils/API";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import SSRFProtection from "Common/Server/Utils/SSRFProtection";
import crypto from "crypto";

const WEBHOOK_REQUEST_TIMEOUT_MS: number = 10_000;
const MAX_LOGGED_BODY_LENGTH: number = 2_000;
const MAX_REQUEST_BODY_LENGTH: number = 200_000;

export interface WebhookSendInput {
  url: string;
  eventType: string;
  payload: JSONObject;
  secret?: string | undefined;
}

export default class WebhookService {
  public static async sendWebhook(
    message: WebhookSendInput,
    options: {
      projectId?: ObjectID | undefined;
      userOnCallLogTimelineId?: ObjectID | undefined;
      incidentId?: ObjectID | undefined;
      alertId?: ObjectID | undefined;
      monitorId?: ObjectID | undefined;
      scheduledMaintenanceId?: ObjectID | undefined;
      statusPageId?: ObjectID | undefined;
      statusPageAnnouncementId?: ObjectID | undefined;
      userId?: ObjectID | undefined;
      onCallPolicyId?: ObjectID | undefined;
      onCallPolicyEscalationRuleId?: ObjectID | undefined;
      onCallScheduleId?: ObjectID | undefined;
      teamId?: ObjectID | undefined;
    } = {},
  ): Promise<void> {
    let sendError: Error | null = null;
    const webhookLog: WebhookLog = new WebhookLog();
    webhookLog.webhookUrl = message.url;

    if (options.projectId) {
      webhookLog.projectId = options.projectId;
    }
    if (options.incidentId) {
      webhookLog.incidentId = options.incidentId;
    }
    if (options.alertId) {
      webhookLog.alertId = options.alertId;
    }
    if (options.monitorId) {
      webhookLog.monitorId = options.monitorId;
    }
    if (options.scheduledMaintenanceId) {
      webhookLog.scheduledMaintenanceId = options.scheduledMaintenanceId;
    }
    if (options.statusPageId) {
      webhookLog.statusPageId = options.statusPageId;
    }
    if (options.statusPageAnnouncementId) {
      webhookLog.statusPageAnnouncementId = options.statusPageAnnouncementId;
    }
    if (options.userId) {
      webhookLog.userId = options.userId;
    }
    if (options.teamId) {
      webhookLog.teamId = options.teamId;
    }
    if (options.onCallPolicyId) {
      webhookLog.onCallDutyPolicyId = options.onCallPolicyId;
    }
    if (options.onCallPolicyEscalationRuleId) {
      webhookLog.onCallDutyPolicyEscalationRuleId =
        options.onCallPolicyEscalationRuleId;
    }
    if (options.onCallScheduleId) {
      webhookLog.onCallDutyPolicyScheduleId = options.onCallScheduleId;
    }

    try {
      if (!message.url) {
        throw new BadDataException("Webhook URL is required");
      }

      if (!message.eventType) {
        throw new BadDataException("Webhook eventType is required");
      }

      /*
       * Project webhook URLs are configured by members of the project, so a
       * self-hosted instance may allow them to reach internal services
       * (issue #3424). Off unless the operator configured it.
       */
      await SSRFProtection.validateWebhookTargetIsSafe(message.url, {
        allowPrivateNetworkTargets: true,
      });

      const bodyString: string = JSON.stringify(message.payload || {});

      if (bodyString.length > MAX_REQUEST_BODY_LENGTH) {
        throw new BadDataException(
          `Webhook payload exceeds maximum allowed size of ${MAX_REQUEST_BODY_LENGTH} bytes.`,
        );
      }

      webhookLog.requestBody = truncate(bodyString, MAX_LOGGED_BODY_LENGTH);

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent": "OneUptime-Webhook/1.0",
        "X-OneUptime-Event": message.eventType,
      };

      if (message.secret) {
        const signature: string = crypto
          .createHmac("sha256", message.secret)
          .update(bodyString)
          .digest("hex");
        headers["X-OneUptime-Signature"] = `sha256=${signature}`;
      }

      const targetUrl: URL = URL.fromString(message.url);

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: targetUrl,
          data: message.payload || {},
          headers,
          options: {
            timeout: WEBHOOK_REQUEST_TIMEOUT_MS,
            doNotFollowRedirects: true,
          },
        });

      const statusCode: number =
        response instanceof HTTPErrorResponse
          ? response.statusCode || 0
          : response.statusCode;

      webhookLog.responseStatusCode = statusCode;

      const responseBodyText: string = serializeResponseBody(
        response instanceof HTTPErrorResponse
          ? response.data
          : response.jsonData,
      );
      webhookLog.responseBody = truncate(
        responseBodyText,
        MAX_LOGGED_BODY_LENGTH,
      );

      if (response instanceof HTTPErrorResponse) {
        webhookLog.status = WebhookStatus.Error;
        webhookLog.statusMessage = `Webhook endpoint returned status ${statusCode}.`;
      } else if (statusCode >= 200 && statusCode < 300) {
        webhookLog.status = WebhookStatus.Success;
        webhookLog.statusMessage = `Webhook delivered successfully (HTTP ${statusCode}).`;
      } else {
        webhookLog.status = WebhookStatus.Error;
        webhookLog.statusMessage = `Webhook endpoint returned non-success status ${statusCode}.`;
      }
    } catch (error: unknown) {
      /*
       * Everything reachable from this try is the tenant's endpoint: a URL they
       * typed that will not parse, a host that will not resolve, a target the
       * SSRF guard refuses, a connection that times out, a 5xx they returned.
       * Recording the failed delivery in the WebhookLog is the product working.
       */
      logger.error("Failed to send webhook.", EXTERNAL_FAULT);
      logger.error(error, EXTERNAL_FAULT);
      webhookLog.status = WebhookStatus.Error;
      const errorMessage: string =
        error instanceof Error && error.message
          ? error.message
          : `${error as string}`;
      webhookLog.statusMessage = errorMessage;

      sendError = error instanceof Error ? error : new Error(errorMessage);
    }

    if (options.projectId) {
      await WebhookLogService.create({
        data: webhookLog,
        props: {
          isRoot: true,
        },
      });
    }

    if (options.userOnCallLogTimelineId) {
      await UserOnCallLogTimelineService.updateOneById({
        id: options.userOnCallLogTimelineId,
        data: {
          status:
            webhookLog.status === WebhookStatus.Success
              ? UserNotificationStatus.Sent
              : UserNotificationStatus.Error,
          statusMessage: webhookLog.statusMessage,
        },
        props: {
          isRoot: true,
        },
      });
    }

    if (sendError) {
      throw sendError;
    }
  }
}

function truncate(value: string, maxLength: number): string {
  if (!value) {
    return value;
  }
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}…[truncated]`;
}

function serializeResponseBody(data: unknown): string {
  if (data === undefined || data === null) {
    return "";
  }
  if (typeof data === "string") {
    return data;
  }
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}
