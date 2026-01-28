import { AppApiHostname } from "../EnvironmentConfig";
import ClusterKeyAuthorization from "../Middleware/ClusterKeyAuthorization";
import BaseService from "./BaseService";
import EmptyResponseData from "../../Types/API/EmptyResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import Protocol from "../../Types/API/Protocol";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import WhatsAppMessage from "../../Types/WhatsApp/WhatsAppMessage";
import API from "../../Utils/API";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class WhatsAppService extends BaseService {
  public constructor() {
    super();
  }

  @CaptureSpan()
  public async sendWhatsAppMessage(
    message: WhatsAppMessage,
    options: {
      projectId?: ObjectID | undefined;
      isSensitive?: boolean | undefined;
      userOnCallLogTimelineId?: ObjectID | undefined;
      incidentId?: ObjectID | undefined;
      alertId?: ObjectID | undefined;
      alertEpisodeId?: ObjectID | undefined;
      incidentEpisodeId?: ObjectID | undefined;
      scheduledMaintenanceId?: ObjectID | undefined;
      statusPageId?: ObjectID | undefined;
      statusPageAnnouncementId?: ObjectID | undefined;
      userId?: ObjectID | undefined;
      onCallPolicyId?: ObjectID | undefined;
      onCallPolicyEscalationRuleId?: ObjectID | undefined;
      onCallDutyPolicyExecutionLogTimelineId?: ObjectID | undefined;
      onCallScheduleId?: ObjectID | undefined;
      teamId?: ObjectID | undefined;
    } = {},
  ): Promise<HTTPResponse<EmptyResponseData>> {
    const body: JSONObject = {
      to: message.to.toString(),
    };

    if (message.body) {
      body["body"] = message.body;
    }

    if (message.templateKey) {
      body["templateKey"] = message.templateKey;
    }

    if (message.templateVariables) {
      const templateVariables: JSONObject = {};

      for (const [key, value] of Object.entries(message.templateVariables)) {
        templateVariables[key] = value;
      }

      body["templateVariables"] = templateVariables;
    }

    if (message.templateLanguageCode) {
      body["templateLanguageCode"] = message.templateLanguageCode;
    }

    if (options.projectId) {
      body["projectId"] = options.projectId.toString();
    }

    if (options.isSensitive !== undefined) {
      body["isSensitive"] = options.isSensitive;
    }

    if (options.userOnCallLogTimelineId) {
      body["userOnCallLogTimelineId"] =
        options.userOnCallLogTimelineId.toString();
    }

    if (options.incidentId) {
      body["incidentId"] = options.incidentId.toString();
    }

    if (options.alertId) {
      body["alertId"] = options.alertId.toString();
    }

    if (options.alertEpisodeId) {
      body["alertEpisodeId"] = options.alertEpisodeId.toString();
    }

    if (options.scheduledMaintenanceId) {
      body["scheduledMaintenanceId"] =
        options.scheduledMaintenanceId.toString();
    }

    if (options.statusPageId) {
      body["statusPageId"] = options.statusPageId.toString();
    }

    if (options.statusPageAnnouncementId) {
      body["statusPageAnnouncementId"] =
        options.statusPageAnnouncementId.toString();
    }

    if (options.userId) {
      body["userId"] = options.userId.toString();
    }

    if (options.onCallPolicyId) {
      body["onCallPolicyId"] = options.onCallPolicyId.toString();
    }

    if (options.onCallPolicyEscalationRuleId) {
      body["onCallPolicyEscalationRuleId"] =
        options.onCallPolicyEscalationRuleId.toString();
    }

    if (options.onCallDutyPolicyExecutionLogTimelineId) {
      body["onCallDutyPolicyExecutionLogTimelineId"] =
        options.onCallDutyPolicyExecutionLogTimelineId.toString();
    }

    if (options.onCallScheduleId) {
      body["onCallScheduleId"] = options.onCallScheduleId.toString();
    }

    if (options.teamId) {
      body["teamId"] = options.teamId.toString();
    }

    return await API.post<EmptyResponseData>({
      url: new URL(
        Protocol.HTTP,
        AppApiHostname,
        new Route("/api/notification/whatsapp/send"),
      ),
      data: body,
      headers: {
        ...ClusterKeyAuthorization.getClusterKeyHeaders(),
      },
    });
  }
}

export default new WhatsAppService();
