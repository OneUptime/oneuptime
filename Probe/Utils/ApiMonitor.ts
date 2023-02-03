import type URL from 'Common/Types/API/URL';
import type HTTPMethod from 'Common/Types/API/HTTPMethod';
import type Headers from 'Common/Types/API/Headers';
import NotImplementedException from 'Common/Types/Exception/NotImplementedException';
import type PositiveNumber from 'Common/Types/PositiveNumber';
import type StatusCode from 'Common/Types/API/StatusCode';
import type { SslResponse } from './SslMonitor';

export interface APIResponse {
    isSecure: boolean;
    reponseTimeInMS: PositiveNumber;
    statusCode: StatusCode;
    responseBody: string;
    responseHeaders: Headers;
    isOnline: boolean;
    SSL: SslResponse;
    url: URL;
    requestHeaders: Headers;
    requestBody: string;
    method: HTTPMethod;
}

export default class API {
    public static async fetch(
        _method: HTTPMethod,
        _url: URL,
        _requestHeaders: Headers,
        _requestBody: string
    ): Promise<APIResponse> {
        throw new NotImplementedException();
    }
}
