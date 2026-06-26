import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import WebhookStatus from "Common/Types/WebhookStatus";
import { JSONObject } from "Common/Types/JSON";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import WebhookLogService from "Common/Server/Services/WebhookLogService";
import logger from "Common/Server/Utils/Logger";
import WebhookLog from "Common/Models/DatabaseModels/WebhookLog";
import API from "Common/Utils/API";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import crypto from "crypto";
import dns from "dns";

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

      await validateWebhookTargetIsSafe(message.url);

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
      logger.error("Failed to send webhook.");
      logger.error(error);
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

async function validateWebhookTargetIsSafe(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = URL.fromString(rawUrl);
  } catch {
    throw new BadDataException("Webhook URL is not a valid URL");
  }

  const protocolValue: string = parsed.protocol.toString().toLowerCase();
  if (protocolValue !== "http://" && protocolValue !== "https://") {
    throw new BadDataException("Webhook URL must use http or https protocol.");
  }

  const hostname: string = parsed.hostname.hostname.toLowerCase();

  if (!hostname) {
    throw new BadDataException("Webhook URL must include a host.");
  }

  if (isBlockedHostnameLiteral(hostname)) {
    throw new BadDataException(
      "Webhook URL points to a private, loopback, or link-local address and is not allowed.",
    );
  }

  if (!isIpLiteral(hostname)) {
    let resolved: Array<{ address: string }> = [];
    try {
      resolved = await dns.promises.lookup(hostname, { all: true });
    } catch {
      throw new BadDataException(
        "Webhook URL hostname could not be resolved via DNS.",
      );
    }

    for (const entry of resolved) {
      if (isBlockedHostnameLiteral(entry.address.toLowerCase())) {
        throw new BadDataException(
          "Webhook URL resolves to a private, loopback, or link-local address and is not allowed.",
        );
      }
    }
  }
}

const IPV4_LITERAL_REGEX: RegExp = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_UNIQUE_LOCAL_REGEX: RegExp = /^f[cd][0-9a-f]{2}:/;

function isIpLiteral(hostname: string): boolean {
  return IPV4_LITERAL_REGEX.test(hostname) || hostname.includes(":");
}

function isBlockedHostnameLiteral(hostname: string): boolean {
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "metadata.google.internal"
  ) {
    return true;
  }

  const ipv4Match: RegExpMatchArray | null = hostname.match(
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
  );
  if (ipv4Match) {
    const octets: Array<number> = [
      Number(ipv4Match[1]),
      Number(ipv4Match[2]),
      Number(ipv4Match[3]),
      Number(ipv4Match[4]),
    ];

    if (
      octets.some((o: number) => {
        return o < 0 || o > 255;
      })
    ) {
      return true;
    }
    if (octets[0] === 0) {
      return true;
    }
    if (octets[0] === 127) {
      return true;
    }
    if (octets[0] === 10) {
      return true;
    }
    if (octets[0] === 172 && (octets[1]! & 0xf0) === 16) {
      return true;
    }
    if (octets[0] === 192 && octets[1] === 168) {
      return true;
    }
    if (octets[0] === 169 && octets[1] === 254) {
      return true;
    }
    if (octets[0] === 100 && (octets[1]! & 0xc0) === 64) {
      return true;
    }
    return false;
  }

  if (hostname.includes(":")) {
    const stripped: string = hostname.replace(/^\[|\]$/g, "");
    if (stripped === "::1" || stripped === "::") {
      return true;
    }
    if (stripped.startsWith("fe80:") || stripped.startsWith("fe80::")) {
      return true;
    }
    if (IPV6_UNIQUE_LOCAL_REGEX.test(stripped)) {
      return true;
    }
  }

  return false;
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
