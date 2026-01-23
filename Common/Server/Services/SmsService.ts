import { AppApiHostname } from "../EnvironmentConfig";
import ClusterKeyAuthorization from "../Middleware/ClusterKeyAuthorization";
import BaseService from "./BaseService";
import EmptyResponseData from "../../Types/API/EmptyResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import Protocol from "../../Types/API/Protocol";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import TwilioConfig from "../../Types/CallAndSMS/TwilioConfig";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import SMS from "../../Types/SMS/SMS";
import API from "../../Utils/API";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class SmsService extends BaseService {
  public constructor() {
    super();
  }

  @CaptureSpan()
  public async sendSms(
    sms: SMS,
    options: {
      projectId?: ObjectID | undefined; // project id for sms log
      isSensitive?: boolean; // if true, message will not be logged
      userOnCallLogTimelineId?: ObjectID;
      customTwilioConfig?: TwilioConfig | undefined;
      incidentId?: ObjectID | undefined;
      alertId?: ObjectID | undefined;
      alertEpisodeId?: ObjectID | undefined;
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
      to: sms.to.toString(),
      message: sms.message,
      projectId: options.projectId?.toString(),
      isSensitive: options.isSensitive,
      userOnCallLogTimelineId: options.userOnCallLogTimelineId?.toString(),
      customTwilioConfig: options.customTwilioConfig
        ? {
            accountSid: options.customTwilioConfig.accountSid!,
            authToken: options.customTwilioConfig.authToken!,
            primaryPhoneNumber:
              options.customTwilioConfig.primaryPhoneNumber.toString(),
            secondaryPhoneNumbers:
              options.customTwilioConfig.secondaryPhoneNumbers?.toString(),
          }
        : undefined,
      incidentId: options.incidentId?.toString(),
      alertId: options.alertId?.toString(),
      alertEpisodeId: options.alertEpisodeId?.toString(),
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

    return await API.post<EmptyResponseData>({
      url: new URL(
        Protocol.HTTP,
        AppApiHostname,
        new Route("/api/notification/sms/send"),
      ),
      data: body,
      headers: {
        ...ClusterKeyAuthorization.getClusterKeyHeaders(),
      },
    });
  }
}

export default new SmsService();
