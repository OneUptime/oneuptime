import type URL from 'Common/Types/API/URL';
import type Headers from 'Common/Types/API/Headers';
import NotImplementedException from 'Common/Types/Exception/NotImplementedException';
import type PositiveNumber from 'Common/Types/PositiveNumber';
import type StatusCode from 'Common/Types/API/StatusCode';
import type HTML from 'Common/Types/Html';
import type { SslResponse } from './SslMonitor';

export interface WebsiteResponse {
    url: URL;
    requestHeaders: Headers;
    isSecure: boolean;
    reponseTimeInMS: PositiveNumber;
    statusCode: StatusCode;
    responseBody: HTML;
    responseHeaders: Headers;
    isOnline: boolean;
    SSL: SslResponse;
}

export default class Website {
    public static async fetch(
        _url: URL,
        _requestHeaders: Headers
    ): Promise<WebsiteResponse> {
        throw new NotImplementedException();
    }
}
