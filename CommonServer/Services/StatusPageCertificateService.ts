import EmptyResponseData from 'Common/Types/API/EmptyResponse';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import { JSONObject } from 'Common/Types/JSON';
import API from 'Common/Utils/API';
import { HttpProtocol, WorkerHostname } from '../Config';

export default class StatusPageCertificateService {

    public static async add(
        domain: string
    ): Promise<HTTPResponse<EmptyResponseData>> {
        const body: JSONObject = {
            domain: domain
        };

        return await API.post<EmptyResponseData>(
            new URL(HttpProtocol, WorkerHostname, new Route('/cert')),
            body
        );
    }

    public static async remove(
        domain: string
    ): Promise<HTTPResponse<EmptyResponseData>> {
        const body: JSONObject = {
            domain: domain
        };

        return await API.delete<EmptyResponseData>(
            new URL(HttpProtocol, WorkerHostname, new Route('/cert')),
            body
        );
    }

    public static async get(
        domain: string
    ): Promise<HTTPResponse<JSONObject>> {
        const body: JSONObject = {
            domain: domain
        };

        return await API.get<JSONObject>(
            new URL(HttpProtocol, WorkerHostname, new Route('/cert')),
            body
        );
    }
}
