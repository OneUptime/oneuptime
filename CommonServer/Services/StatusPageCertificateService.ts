import EmptyResponseData from 'Common/Types/API/EmptyResponse';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import { JSONObject } from 'Common/Types/JSON';
import API from 'Common/Utils/API';
import { HttpProtocol, WorkerHostname } from '../Config';
import BaseService from './BaseService';

export class StatusPageCertificateService extends BaseService {
    public constructor() {
        super();
    }
    
    public async add(
        domain: string
    ): Promise<HTTPResponse<EmptyResponseData>> {
        const body: JSONObject = {
            domain: domain,
        };

        return await API.post<EmptyResponseData>(
            new URL(HttpProtocol, WorkerHostname, new Route('/cert')),
            body
        );
    }

    public async remove(
        domain: string
    ): Promise<HTTPResponse<EmptyResponseData>> {
        const body: JSONObject = {
            domain: domain,
        };

        return await API.delete<EmptyResponseData>(
            new URL(HttpProtocol, WorkerHostname, new Route('/cert')),
            body
        );
    }

    public async get(domain: string): Promise<HTTPResponse<JSONObject>> {
        const body: JSONObject = {
            domain: domain,
        };

        return await API.get<JSONObject>(
            new URL(HttpProtocol, WorkerHostname, new Route('/cert')),
            body
        );
    }
}

export default new StatusPageCertificateService();
