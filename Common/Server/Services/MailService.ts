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
import API from "../../Utils/API";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

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
    },
  ): Promise<HTTPResponse<EmptyResponseData>> {
    const body: JSONObject = {
      ...mail,
      toEmail: mail.toEmail.toString(),
    };

    if (options && options.mailServer) {
      body["SMTP_ID"] = options.mailServer.id?.toString();
      body["SMTP_USERNAME"] = options.mailServer.username || undefined;
      body["SMTP_EMAIL"] = options.mailServer.fromEmail.toString();
      body["SMTP_FROM_NAME"] = options.mailServer.fromName;
      body["SMTP_IS_SECURE"] = options.mailServer.secure;
      body["SMTP_PORT"] = options.mailServer.port.toNumber();
      body["SMTP_HOST"] = options.mailServer.host.toString();
      body["SMTP_PASSWORD"] = options.mailServer.password || undefined;
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
    });
  }
}

export default new MailService();
