import { AppApiHostname } from '../EnvironmentConfig';
import ClusterKeyAuthorization from '../Middleware/ClusterKeyAuthorization';
import BaseService from './BaseService';
import EmptyResponseData from 'Common/Types/API/EmptyResponse';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import Protocol from 'Common/Types/API/Protocol';
import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import CallRequest from 'Common/Types/Call/CallRequest';
import TwilioConfig from 'Common/Types/CallAndSMS/TwilioConfig';
import { JSONObject } from 'Common/Types/JSON';
import ObjectID from 'Common/Types/ObjectID';
import API from 'Common/Utils/API';

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
            customTwilioConfig: options.customTwilioConfig
                ? {
                      accountSid: options.customTwilioConfig.accountSid!,
                      authToken: options.customTwilioConfig.authToken!,
                      phoneNumber:
                          options.customTwilioConfig.phoneNumber.toString(),
                  }
                : undefined,
        };

        return await API.post<EmptyResponseData>(
            new URL(
                Protocol.HTTP,
                AppApiHostname,
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
