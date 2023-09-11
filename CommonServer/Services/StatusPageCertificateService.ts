import EmptyResponseData from 'Common/Types/API/EmptyResponse';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import { JSONObject } from 'Common/Types/JSON';
import API from 'Common/Utils/API';
import { WorkerHostname } from '../EnvironmentConfig';
import DatabaseConfig from '../DatabaseConfig';
import BaseService from './BaseService';
import Protocol from 'Common/Types/API/Protocol';

export class StatusPageCertificateService extends BaseService {
    public constructor() {
        super();
    }

    public async add(domain: string): Promise<HTTPResponse<EmptyResponseData>> {
        const body: JSONObject = {
            domain: domain,
        };

        const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

        return await API.post<EmptyResponseData>(
            new URL(httpProtocol, WorkerHostname, new Route('/cert')),
            body
        );
    }

    public async remove(
        domain: string
    ): Promise<HTTPResponse<EmptyResponseData>> {
        const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

        const body: JSONObject = {
            domain: domain,
        };

        return await API.delete<EmptyResponseData>(
            new URL(httpProtocol, WorkerHostname, new Route('/cert')),
            body
        );
    }

    public async get(domain: string): Promise<HTTPResponse<JSONObject>> {
        const body: JSONObject = {
            domain: domain,
        };

        const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

        return await API.get<JSONObject>(
            new URL(httpProtocol, WorkerHostname, new Route('/cert')),
            body
        );
    }
}

export default new StatusPageCertificateService();
