import EmptyResponseData from 'Common/Types/API/EmptyResponse';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import Dictionary from 'Common/Types/Dictionary';
import Email from 'Common/Types/Email';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import { JSONObject } from 'Common/Types/JSON';
import ObjectID from 'Common/Types/ObjectID';
import API from 'Common/Utils/API';
import { ClusterKey, HttpProtocol, MailHostname } from '../Config';

export default class MailService {
    public static async sendMail(
        to: Email,
        subject: string,
        template: EmailTemplateType,
        vars: Dictionary<string>,
        options?: {
            projectId?: ObjectID;
            forceSendFromGlobalMailServer?: boolean;
        }
    ): Promise<HTTPResponse<EmptyResponseData>> {
        const body: JSONObject = {
            toEmail: to.toString(),
            subject,
            vars: vars,
        };

        if (options?.projectId) {
            body['projectId'] = options.projectId;
        }

        if (options?.forceSendFromGlobalMailServer) {
            body['forceSendFromGlobalMailServer'] =
                options.forceSendFromGlobalMailServer;
        }

        return await API.post<EmptyResponseData>(
            new URL(
                HttpProtocol,
                MailHostname,
                new Route('/email/' + template)
            ),
            body,
            {
                clusterkey: ClusterKey.toString(),
            }
        );
    }
}
