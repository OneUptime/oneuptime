import { AppApiHostname } from "../EnvironmentConfig";
import ClusterKeyAuthorization from "../Middleware/ClusterKeyAuthorization";
import BaseService from "./BaseService";
import EmptyResponseData from "../../Types/API/EmptyResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import Protocol from "../../Types/API/Protocol";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import WebhookMessage from "../../Types/Webhook/WebhookMessage";
import API from "../../Utils/API";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class WebhookService extends BaseService {
  public constructor() {
    super();
  }

  @CaptureSpan()
  public async sendWebhook(
    message: WebhookMessage,
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
      onCallDutyPolicyExecutionLogTimelineId?: ObjectID | undefined;
      onCallScheduleId?: ObjectID | undefined;
      teamId?: ObjectID | undefined;
    } = {},
  ): Promise<HTTPResponse<EmptyResponseData> | HTTPErrorResponse> {
    const body: JSONObject = {
      url: message.url,
      eventType: message.eventType,
      payload: message.payload,
    };

    if (message.secret) {
      body["secret"] = message.secret;
    }

    if (options.projectId) {
      body["projectId"] = options.projectId.toString();
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

    if (options.monitorId) {
      body["monitorId"] = options.monitorId.toString();
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
        new Route("/api/notification/webhook/send"),
      ),
      data: body,
      headers: {
        ...ClusterKeyAuthorization.getClusterKeyHeaders(),
      },
    });
  }
}

export default new WebhookService();
