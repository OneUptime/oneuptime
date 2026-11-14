import { AppApiHostname } from "../EnvironmentConfig";
import ClusterKeyAuthorization from "../Middleware/ClusterKeyAuthorization";
import BaseService from "./BaseService";
import EmptyResponseData from "../../Types/API/EmptyResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import Protocol from "../../Types/API/Protocol";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import Email from "../../Types/Email/EmailMessage";
import EmailServer from "../../Types/Email/EmailServer";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import API from "../../Utils/API";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import BlockedProjectNotifications from "../Utils/Notification/BlockedProjectNotifications";
import logger from "../Utils/Logger";
import UserOnCallLogTimelineService from "./UserOnCallLogTimelineService";
import {
  SAMPLE_PERSON_NOT_SENT_REASON,
  isSamplePersonEmail,
} from "../../Types/SampleProject/SampleProject";
import { NotificationDeliveryChannel } from "../Utils/Telemetry/NotificationDeliveryMetrics";

export class MailService extends BaseService {
  @CaptureSpan()
  public async sendMail(
    mail: Email,
    options?: {
      mailServer?: EmailServer | undefined;
      userOnCallLogTimelineId?: ObjectID;
      projectId?: ObjectID | undefined;
      incidentId?: ObjectID | undefined;
      alertId?: ObjectID | undefined;
      alertEpisodeId?: ObjectID | undefined;
      incidentEpisodeId?: ObjectID | undefined;
      monitorId?: ObjectID | undefined;
      scheduledMaintenanceId?: ObjectID | undefined;
      statusPageId?: ObjectID | undefined;
      statusPageAnnouncementId?: ObjectID | undefined;
      userId?: ObjectID | undefined;
      // On-call policy related fields
      onCallPolicyId?: ObjectID | undefined;
      onCallPolicyEscalationRuleId?: ObjectID | undefined;
      onCallDutyPolicyExecutionLogTimelineId?: ObjectID | undefined;
      onCallScheduleId?: ObjectID | undefined;
      teamId?: ObjectID | undefined;
      /*
       * How long to wait for the mail service to take the email. None by
       * default; a caller that must not hang - a run that waits for each
       * email in turn - sets one.
       */
      timeoutInMs?: number | undefined;
    },
  ): Promise<HTTPResponse<EmptyResponseData>> {
    // A project a master admin blocked sends nothing (BlockedProjectNotifications).
    const blockedProjectRefusal: HTTPErrorResponse | null =
      await BlockedProjectNotifications.getRefusal({
        channel: "Email",
        deliveryChannel: NotificationDeliveryChannel.Email,
        projectId: options?.projectId,
        userOnCallLogTimelineId: options?.userOnCallLogTimelineId,
      });

    if (blockedProjectRefusal) {
      return blockedProjectRefusal;
    }

    /*
     * A sample person (issue #6808) is not real, and their address is on
     * the reserved .invalid domain: nothing is sent to one, whatever sends
     * it - a project's notification, an invitation, an account email - and
     * whichever project it names.
     */
    if (isSamplePersonEmail(mail.toEmail)) {
      logger.debug(SAMPLE_PERSON_NOT_SENT_REASON);

      await UserOnCallLogTimelineService.markNotSent({
        userOnCallLogTimelineId: options?.userOnCallLogTimelineId,
        reason: SAMPLE_PERSON_NOT_SENT_REASON,
      });

      return new HTTPErrorResponse(
        403,
        { message: SAMPLE_PERSON_NOT_SENT_REASON },
        {},
      );
    }

    const body: JSONObject = {
      ...mail,
      toEmail: mail.toEmail.toString(),
    };

    if (options && options.mailServer) {
      body["SMTP_ID"] = options.mailServer.id?.toString();
      /*
       * host/port/secure are optional on EmailServer because HTTP-API
       * transports (e.g. Microsoft Graph) don't use them. Only serialize the
       * SMTP-only fields when they're actually present.
       */
      body["SMTP_TRANSPORT_TYPE"] =
        options.mailServer.transportType || undefined;
      body["SMTP_USERNAME"] = options.mailServer.username || undefined;
      body["SMTP_EMAIL"] = options.mailServer.fromEmail.toString();
      body["SMTP_FROM_NAME"] = options.mailServer.fromName;
      body["SMTP_IS_SECURE"] =
        options.mailServer.secure === undefined
          ? undefined
          : options.mailServer.secure;
      body["SMTP_PORT"] = options.mailServer.port
        ? options.mailServer.port.toNumber()
        : undefined;
      body["SMTP_HOST"] = options.mailServer.host
        ? options.mailServer.host.toString()
        : undefined;
      body["SMTP_PASSWORD"] = options.mailServer.password || undefined;
      body["SMTP_AUTH_TYPE"] = options.mailServer.authType || undefined;
      body["SMTP_CLIENT_ID"] = options.mailServer.clientId || undefined;
      body["SMTP_CLIENT_SECRET"] = options.mailServer.clientSecret || undefined;
      body["SMTP_TOKEN_URL"] = options.mailServer.tokenUrl
        ? options.mailServer.tokenUrl.toString()
        : undefined;
      body["SMTP_SCOPE"] = options.mailServer.scope || undefined;
      body["SMTP_OAUTH_PROVIDER_TYPE"] =
        options.mailServer.oauthProviderType || undefined;
      /*
       * The keys of a provider with an HTTP API of its own (Amazon SES,
       * SendGrid, Mailgun, Postmark, Resend). Only the transport's own are
       * set on the EmailServer (ProjectSmtpConfigService.toEmailServer), and
       * the notification service reads them back the same way
       * (MailService.getEmailServer).
       */
      body["SMTP_API_KEY"] = options.mailServer.apiKey || undefined;
      body["SMTP_AWS_ACCESS_KEY_ID"] =
        options.mailServer.awsAccessKeyId || undefined;
      body["SMTP_AWS_SECRET_ACCESS_KEY"] =
        options.mailServer.awsSecretAccessKey || undefined;
      body["SMTP_AWS_REGION"] = options.mailServer.awsRegion || undefined;
      body["SMTP_MAILGUN_DOMAIN"] =
        options.mailServer.mailgunDomain || undefined;
      body["SMTP_MAILGUN_REGION"] =
        options.mailServer.mailgunRegion || undefined;
    }

    if (options?.userOnCallLogTimelineId) {
      body["userOnCallLogTimelineId"] =
        options.userOnCallLogTimelineId.toString();
    }

    if (options?.projectId) {
      body["projectId"] = options.projectId.toString();
    }

    if (options?.incidentId) {
      body["incidentId"] = options.incidentId.toString();
    }

    if (options?.alertId) {
      body["alertId"] = options.alertId.toString();
    }

    if (options?.alertEpisodeId) {
      body["alertEpisodeId"] = options.alertEpisodeId.toString();
    }

    if (options?.monitorId) {
      body["monitorId"] = options.monitorId.toString();
    }

    if (options?.scheduledMaintenanceId) {
      body["scheduledMaintenanceId"] =
        options.scheduledMaintenanceId.toString();
    }

    if (options?.statusPageId) {
      body["statusPageId"] = options.statusPageId.toString();
    }

    if (options?.statusPageAnnouncementId) {
      body["statusPageAnnouncementId"] =
        options.statusPageAnnouncementId.toString();
    }

    if (options?.userId) {
      body["userId"] = options.userId.toString();
    }

    if (options?.onCallPolicyId) {
      body["onCallPolicyId"] = options.onCallPolicyId.toString();
    }

    if (options?.onCallPolicyEscalationRuleId) {
      body["onCallPolicyEscalationRuleId"] =
        options.onCallPolicyEscalationRuleId.toString();
    }

    if (options?.onCallDutyPolicyExecutionLogTimelineId) {
      body["onCallDutyPolicyExecutionLogTimelineId"] =
        options.onCallDutyPolicyExecutionLogTimelineId.toString();
    }

    if (options?.onCallScheduleId) {
      body["onCallScheduleId"] = options.onCallScheduleId.toString();
    }

    if (options?.teamId) {
      body["teamId"] = options.teamId.toString();
    }

    return await API.post<EmptyResponseData>({
      url: new URL(
        Protocol.HTTP,
        AppApiHostname,
        new Route("/api/notification/email/send"),
      ),
      data: body,
      headers: {
        ...ClusterKeyAuthorization.getClusterKeyHeaders(),
      },
      options: {
        ...(options?.timeoutInMs ? { timeout: options.timeoutInMs } : {}),
        sameServerRedirectsOnly: true,
      },
    });
  }
}

export default new MailService();
