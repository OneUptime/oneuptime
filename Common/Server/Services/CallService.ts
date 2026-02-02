import { AppApiHostname } from "../EnvironmentConfig";
import ClusterKeyAuthorization from "../Middleware/ClusterKeyAuthorization";
import BaseService from "./BaseService";
import EmptyResponseData from "../../Types/API/EmptyResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import Protocol from "../../Types/API/Protocol";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import CallRequest from "../../Types/Call/CallRequest";
import TwilioConfig from "../../Types/CallAndSMS/TwilioConfig";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import API from "../../Utils/API";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class CallService extends BaseService {
  public constructor() {
    super();
  }

  @CaptureSpan()
  public async makeCall(
    callRequest: CallRequest,
    options: {
      projectId?: ObjectID | undefined; // project id for sms log
      isSensitive?: boolean; // if true, message will not be logged
      userOnCallLogTimelineId?: ObjectID | undefined;
      customTwilioConfig?: TwilioConfig | undefined;
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
      teamId?: ObjectID | undefined;
      onCallDutyPolicyExecutionLogTimelineId?: ObjectID | undefined;
      onCallScheduleId?: ObjectID | undefined;
    },
  ): Promise<HTTPResponse<EmptyResponseData>> {
    const body: JSONObject = {
      callRequest: callRequest,
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
      monitorId: options.monitorId?.toString(),
      scheduledMaintenanceId: options.scheduledMaintenanceId?.toString(),
      statusPageId: options.statusPageId?.toString(),
      statusPageAnnouncementId: options.statusPageAnnouncementId?.toString(),
      userId: options.userId?.toString(),
      onCallPolicyId: options.onCallPolicyId?.toString(),
      onCallPolicyEscalationRuleId:
        options.onCallPolicyEscalationRuleId?.toString(),
      teamId: options.teamId?.toString(),
      onCallDutyPolicyExecutionLogTimelineId:
        options.onCallDutyPolicyExecutionLogTimelineId?.toString(),
      onCallScheduleId: options.onCallScheduleId?.toString(),
    };

    return await API.post<EmptyResponseData>({
      url: new URL(
        Protocol.HTTP,
        AppApiHostname,
        new Route("/api/notification/call/make-call"),
      ),
      data: body,
      headers: {
        ...ClusterKeyAuthorization.getClusterKeyHeaders(),
      },
    });
  }
}

export default new CallService();
