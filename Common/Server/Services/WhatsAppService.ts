import { AppApiHostname } from "../EnvironmentConfig";
import ClusterKeyAuthorization from "../Middleware/ClusterKeyAuthorization";
import BaseService from "./BaseService";
import EmptyResponseData from "../../Types/API/EmptyResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import Protocol from "../../Types/API/Protocol";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import MetaWhatsAppConfig from "../../Types/WhatsApp/MetaWhatsAppConfig";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Phone from "../../Types/Phone";
import API from "../../Utils/API";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export interface WhatsAppMessage {
  to: Phone;
  message: string;
}

export class WhatsAppService extends BaseService {
  public constructor() {
    super();
  }

  @CaptureSpan()
  public async sendWhatsApp(
    whatsapp: WhatsAppMessage,
    options: {
      projectId?: ObjectID | undefined; // project id for whatsapp log
      isSensitive?: boolean; // if true, message will not be logged
      userOnCallLogTimelineId?: ObjectID;
      customMetaWhatsAppConfig?: MetaWhatsAppConfig | undefined;
      incidentId?: ObjectID | undefined;
      alertId?: ObjectID | undefined;
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
      to: whatsapp.to.toString(),
      message: whatsapp.message,
      projectId: options.projectId?.toString(),
      isSensitive: options.isSensitive,
      userOnCallLogTimelineId: options.userOnCallLogTimelineId?.toString(),
      customMetaWhatsAppConfig: options.customMetaWhatsAppConfig
        ? {
            accessToken: options.customMetaWhatsAppConfig.accessToken!,
            phoneNumberId: options.customMetaWhatsAppConfig.phoneNumberId!,
            businessAccountId: options.customMetaWhatsAppConfig.businessAccountId!,
            appId: options.customMetaWhatsAppConfig.appId!,
            appSecret: options.customMetaWhatsAppConfig.appSecret!,
            webhookVerifyToken: options.customMetaWhatsAppConfig.webhookVerifyToken!,
          }
        : undefined,
      incidentId: options.incidentId?.toString(),
      alertId: options.alertId?.toString(),
      scheduledMaintenanceId: options.scheduledMaintenanceId?.toString(),
      statusPageId: options.statusPageId?.toString(),
      statusPageAnnouncementId: options.statusPageAnnouncementId?.toString(),
      userId: options.userId?.toString(),
      onCallPolicyId: options.onCallPolicyId?.toString(),
      onCallPolicyEscalationRuleId:
        options.onCallPolicyEscalationRuleId?.toString(),
      onCallDutyPolicyExecutionLogTimelineId:
        options.onCallDutyPolicyExecutionLogTimelineId?.toString(),
      onCallScheduleId: options.onCallScheduleId?.toString(),
      teamId: options.teamId?.toString(),
    };

    return await API.post<EmptyResponseData>(
      new URL(
        Protocol.HTTP,
        AppApiHostname,
        new Route("/api/notification/whatsapp/send"),
      ),
      body,
      {
        ...ClusterKeyAuthorization.getClusterKeyHeaders(),
      },
    );
  }
}

export default new WhatsAppService();