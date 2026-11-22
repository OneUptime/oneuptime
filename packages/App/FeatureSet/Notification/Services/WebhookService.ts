import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import WebhookStatus from "Common/Types/WebhookStatus";
import { JSONObject } from "Common/Types/JSON";
import WebhookLogService from "Common/Server/Services/WebhookLogService";
import { recordSendResult } from "Common/Server/Utils/OnCall/OnCallNotificationStatus";
import logger, { EXTERNAL_FAULT } from "Common/Server/Utils/Logger";
import WebhookLog from "Common/Models/DatabaseModels/WebhookLog";
import WebhookAddressMask from "Common/Utils/WebhookAddressMask";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import SafeWebhookRequest, {
  WEBHOOK_MAX_RESPONSE_BYTES,
  WebhookTarget,
} from "Common/Server/Utils/SafeWebhookRequest";
import { WebhookTargetValidationOptions } from "Common/Server/Utils/SSRFProtection";
import { TargetTlsOptions } from "Common/Server/Utils/OutboundProxyAgents";
import { getCaCertificateProblem } from "Common/Server/Utils/Runbook/HttpStepCaCertificate";
import {
  CaCertificateProblem,
  HTTP_STEP_CA_CERTIFICATE_PROBLEM_MESSAGES,
  HttpStepCertificateSettings,
  getHttpStepCertificateFailureMessage,
  getHttpStepCertificateSettings,
} from "Common/Types/Runbook/HttpStepCertificates";
import { WebhookCertificates } from "Common/Types/Webhook/WebhookMessage";
import { getRequestErrorCode } from "Common/Utils/RequestErrorCode";
import NotificationDeliveryMetrics, {
  NotificationDeliveryChannel,
  NotificationDeliveryProvider,
  NotificationDispatch,
  NotificationProviderConfig,
} from "Common/Server/Utils/Telemetry/NotificationDeliveryMetrics";
import crypto from "crypto";

export const WEBHOOK_REQUEST_TIMEOUT_MS: number = 10_000;
const MAX_LOGGED_BODY_LENGTH: number = 2_000;
const MAX_REQUEST_BODY_LENGTH: number = 200_000;

/*
 * Project webhook URLs are configured by members of the project, so a
 * self-hosted instance may allow them to reach internal services (issue
 * #3424). Off unless the operator configured it.
 */
export const WEBHOOK_TARGET_VALIDATION: WebhookTargetValidationOptions = {
  allowPrivateNetworkTargets: true,
};

export interface WebhookSendInput {
  url: string;
  eventType: string;
  payload: JSONObject;
  secret?: string | undefined;
  /*
   * How the receiver's certificate is checked, for a step that has the
   * settings (a playbook's Send Webhook, #10440): for this request alone.
   * Absent, it is checked as every request checks one.
   */
  certificates?: WebhookCertificates | undefined;
}

/*
 * The request's TLS options for a step's certificate settings: none, no
 * check at all, or its CA certificate alone, the host name and the dates
 * still checked.
 */
function getTlsOptions(
  settings: HttpStepCertificateSettings | null,
): TargetTlsOptions | undefined {
  if (!settings) {
    return undefined;
  }

  if (settings.skipsCertificateChecks) {
    return { rejectUnauthorized: false };
  }

  return settings.caCertificate ? { ca: settings.caCertificate } : undefined;
}

export interface WebhookSendOptions {
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
}

export default class WebhookService {
  public static async sendWebhook(
    message: WebhookSendInput,
    options: WebhookSendOptions = {},
  ): Promise<void> {
    // How it went, for the platform's operator (NotificationDeliveryMetrics).
    await NotificationDeliveryMetrics.measureDispatch(
      {
        channel: NotificationDeliveryChannel.Webhook,
        provider: NotificationDeliveryProvider.Webhook,
        // The endpoint is the person's or the project's own.
        providerConfig: NotificationProviderConfig.Project,
        isOnCallPage: Boolean(options.userOnCallLogTimelineId),
      },
      (dispatch: NotificationDispatch): Promise<void> => {
        return this.postWebhook(message, options, dispatch);
      },
    );
  }

  private static async postWebhook(
    message: WebhookSendInput,
    options: WebhookSendOptions,
    dispatch: NotificationDispatch,
  ): Promise<void> {
    let sendError: Error | null = null;
    const webhookLog: WebhookLog = new WebhookLog();
    /*
     * The address by its scheme and host alone: the rest is the webhook's
     * credential - a Slack, Teams or Discord webhook's secret is in its path -
     * and the log is read by everyone who reads the project's notification
     * logs (WebhookAddressMask).
     */
    webhookLog.webhookUrl = WebhookAddressMask.mask(message.url);

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

    /*
     * A step's certificate settings, read as a Runbook HTTP step reads its
     * own (Types/Runbook/HttpStepCertificates): null for a webhook that has
     * none, whose certificate is checked as every request's.
     */
    const certificates: HttpStepCertificateSettings | null =
      message.certificates
        ? getHttpStepCertificateSettings({
            allowSelfSignedCertificates:
              message.certificates.allowSelfSignedCertificates === true,
            ...(message.certificates.caCertificate
              ? { caCertificate: message.certificates.caCertificate }
              : {}),
          })
        : null;
    let receiverHost: string = "";

    try {
      if (!message.url) {
        throw new BadDataException("Webhook URL is required");
      }

      if (!message.eventType) {
        throw new BadDataException("Webhook eventType is required");
      }

      /*
       * The post below dials an address this check approved and no other
       * (SafeWebhookRequest), so the name cannot resolve somewhere else in
       * between, and no redirect is followed.
       */
      const target: WebhookTarget = await SafeWebhookRequest.resolveTarget(
        message.url,
        WEBHOOK_TARGET_VALIDATION,
      );

      receiverHost = target.url.hostname;

      /*
       * A CA certificate that is not one is refused before anything is sent:
       * Node takes text that is not a certificate without a word. A save
       * checks it already; this is for a step stored before that check.
       */
      if (certificates?.caCertificate) {
        const problem: CaCertificateProblem | null = getCaCertificateProblem(
          certificates.caCertificate,
        );

        if (problem) {
          throw new BadDataException(
            HTTP_STEP_CA_CERTIFICATE_PROBLEM_MESSAGES[problem],
          );
        }
      }

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

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await SafeWebhookRequest.send<JSONObject>(target, {
          data: message.payload || {},
          headers,
          timeout: WEBHOOK_REQUEST_TIMEOUT_MS,
          // The status, and the first 2,000 characters for the log, are all that is read.
          maxContentLength: WEBHOOK_MAX_RESPONSE_BYTES,
          // This request's alone: never the proxy's connection, nor another's.
          tls: getTlsOptions(certificates),
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

      // The endpoint's answer, which is not thrown when it refused.
      if (webhookLog.status === WebhookStatus.Success) {
        dispatch.markSucceeded();
      } else {
        dispatch.markFailed();
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

      /*
       * For a step that has the certificate settings, a certificate it
       * refused says why and which of them would let it through, the safer
       * first, as a Runbook HTTP step's does.
       */
      const certificateMessage: string | null =
        certificates && receiverHost
          ? getHttpStepCertificateFailureMessage({
              code: getRequestErrorCode(error),
              host: receiverHost,
              settings: certificates,
            })
          : null;

      const errorMessage: string = certificateMessage
        ? certificateMessage
        : error instanceof Error && error.message
          ? error.message
          : `${error as string}`;
      // Kept, with the address it may quote masked as the log's address is.
      webhookLog.statusMessage = WebhookAddressMask.maskIn(
        errorMessage,
        message.url,
      );

      sendError = certificateMessage
        ? new BadDataException(certificateMessage)
        : error instanceof Error
          ? error
          : new Error(errorMessage);
    }

    if (options.projectId) {
      await WebhookLogService.create({
        data: webhookLog,
        props: {
          isRoot: true,
        },
      });
    }

    /*
     * Written only while the page's timeline entry still says Sending
     * (OnCallNotificationStatus): the person may have acknowledged the page,
     * or escalated it, meanwhile - from another of its messages.
     */
    if (options.userOnCallLogTimelineId) {
      const isSent: boolean = webhookLog.status === WebhookStatus.Success;

      await recordSendResult({
        userOnCallLogTimelineId: options.userOnCallLogTimelineId,
        isSent: isSent,
        statusMessage:
          webhookLog.statusMessage ||
          (isSent ? "Webhook delivered." : "Failed to send webhook."),
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
