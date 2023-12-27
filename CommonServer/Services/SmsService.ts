import EmptyResponseData from 'Common/Types/API/EmptyResponse';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import { JSONObject } from 'Common/Types/JSON';
import API from 'Common/Utils/API';
import { DashboardApiHostname } from '../EnvironmentConfig';
import Protocol from 'Common/Types/API/Protocol';
import ClusterKeyAuthorization from '../Middleware/ClusterKeyAuthorization';
import ObjectID from 'Common/Types/ObjectID';
import SMS from 'Common/Types/SMS/SMS';
import BaseService from './BaseService';
import TwilioConfig from 'Common/Types/CallAndSMS/TwilioConfig';

export class SmsService extends BaseService {
    public constructor() {
        super();
    }

    public async sendSms(
        sms: SMS,
        options: {
            projectId?: ObjectID | undefined; // project id for sms log
            isSensitive?: boolean; // if true, message will not be logged
            userOnCallLogTimelineId?: ObjectID;
            customTwilioConfig?: TwilioConfig | undefined;
        }
    ): Promise<HTTPResponse<EmptyResponseData>> {
        const body: JSONObject = {
            to: sms.to.toString(),
            message: sms.message,
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
                DashboardApiHostname,
                new Route('/api/notification/sms/send')
            ),
            body,
            {
                ...ClusterKeyAuthorization.getClusterKeyHeaders(),
            }
        );
    }
}

export default new SmsService();
