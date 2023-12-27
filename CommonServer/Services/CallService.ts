import EmptyResponseData from 'Common/Types/API/EmptyResponse';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import { JSONObject } from 'Common/Types/JSON';
import API from 'Common/Utils/API';
import { DashboardApiHostname } from '../EnvironmentConfig';
import Protocol from 'Common/Types/API/Protocol';
import ClusterKeyAuthorization from '../Middleware/ClusterKeyAuthorization';
import Phone from 'Common/Types/Phone';
import ObjectID from 'Common/Types/ObjectID';
import CallRequest from 'Common/Types/Call/CallRequest';
import BaseService from './BaseService';
import TwilioConfig from 'Common/Types/CallAndSMS/TwilioConfig';

export class CallService extends BaseService {
    public constructor() {
        super();
    }

    public async makeCall(
        callRequest: CallRequest,
        options: {
            projectId?: ObjectID | undefined; // project id for sms log
            isSensitive?: boolean; // if true, message will not be logged
            userOnCallLogTimelineId?: ObjectID;
            customTwilioConfig?: TwilioConfig | undefined;
        }
    ): Promise<HTTPResponse<EmptyResponseData>> {
        const body: JSONObject = {
            callRequest: callRequest,
            projectId: options.projectId?.toString(),
            isSensitive: options.isSensitive,
            userOnCallLogTimelineId:
                options.userOnCallLogTimelineId?.toString(),
            customTwilioConfig: options.customTwilioConfig ? {
                twilioAccountSID: options.customTwilioConfig?.accountSid!,
                twilioAuthToken: options.customTwilioConfig?.authToken!,
                twilioPhoneNumber: options.customTwilioConfig?.phoneNumber.toString(),
            } : undefined,
        };

        return await API.post<EmptyResponseData>(
            new URL(
                Protocol.HTTP,
                DashboardApiHostname,
                new Route('/api/notification/call/make-call')
            ),
            body,
            {
                ...ClusterKeyAuthorization.getClusterKeyHeaders(),
            }
        );
    }
}

export default new CallService();
