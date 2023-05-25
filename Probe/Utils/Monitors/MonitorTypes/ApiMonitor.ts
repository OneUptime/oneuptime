import URL from 'Common/Types/API/URL';
import Headers from 'Common/Types/API/Headers';
import PositiveNumber from 'Common/Types/PositiveNumber';
import API from 'Common/Utils/API';
import Protocol from 'Common/Types/API/Protocol';
import { JSONObject } from 'Common/Types/JSON';
import HTTPMethod from 'Common/Types/API/HTTPMethod';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';

export interface APIResponse {
    url: URL;
    requestHeaders: Headers;
    requestBody: JSONObject;
    isSecure: boolean;
    responseTimeInMS: PositiveNumber;
    statusCode: number;
    responseBody: string;
    responseHeaders: Headers;
    isOnline: boolean;
}

export default class ApiMonitor {
    public static async ping(
        url: URL,
        options: {
            requestHeaders?: Headers | undefined;
            requestBody?: JSONObject | undefined;
            requestType?: HTTPMethod | undefined;
        },
        retry?: number | undefined
    ): Promise<APIResponse> {
        try {
            const startTime: [number, number] = process.hrtime();
            const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
                await API.fetch(
                    options.requestType || HTTPMethod.GET,
                    url,
                    options.requestBody || undefined,
                    options.requestHeaders || undefined
                );
            const endTime: [number, number] = process.hrtime(startTime);
            const responseTimeInMS: PositiveNumber = new PositiveNumber(
                (endTime[0] * 1000000000 + endTime[1]) / 1000000
            );

            return {
                url: url,
                requestHeaders: options.requestHeaders || {},
                // if server is responding, it is online.
                isOnline: true,
                isSecure: url.protocol === Protocol.HTTPS,
                responseTimeInMS: responseTimeInMS,
                statusCode: result.statusCode,
                responseBody: JSON.stringify(result.data || {}),
                responseHeaders: result.headers,
                requestBody: options.requestBody || {},
            };
        } catch (err) {
            if (!retry) {
                retry = 0; // default value
            }

            if (retry < 5) {
                retry++;
                return await this.ping(url, options, retry);
            }

            return {
                url: url,
                isOnline: false,
                requestBody: options.requestBody || {},
                requestHeaders: options.requestHeaders || {},
                isSecure: url.protocol === Protocol.HTTPS,
                responseTimeInMS: new PositiveNumber(0),
                statusCode: 0,
                responseBody: '',
                responseHeaders: {},
            };
        }
    }
}
