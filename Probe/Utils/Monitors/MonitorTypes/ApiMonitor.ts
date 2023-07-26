import URL from 'Common/Types/API/URL';
import Headers from 'Common/Types/API/Headers';
import PositiveNumber from 'Common/Types/PositiveNumber';
import API from 'Common/Utils/API';
import Protocol from 'Common/Types/API/Protocol';
import { JSONObject } from 'Common/Types/JSON';
import HTTPMethod from 'Common/Types/API/HTTPMethod';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import logger from 'CommonServer/Utils/Logger';

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
            isHeadRequest?: boolean | undefined;
            retry?: number | undefined;
        }
    ): Promise<APIResponse> {
        let requestType: HTTPMethod = options.requestType || HTTPMethod.GET;

        if (options.isHeadRequest) {
            requestType = HTTPMethod.HEAD;
        }

        try {
            logger.info(
                `API Monitor - Pinging ${requestType} ${url.toString()}`
            );

            const startTime: [number, number] = process.hrtime();
            const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
                await API.fetch(
                    requestType,
                    url,
                    options.requestBody || undefined,
                    options.requestHeaders || undefined
                );
            const endTime: [number, number] = process.hrtime(startTime);
            const responseTimeInMS: PositiveNumber = new PositiveNumber(
                (endTime[0] * 1000000000 + endTime[1]) / 1000000
            );

            const apiResponse: APIResponse = {
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

            logger.info(
                `API Monitor - Pinging ${requestType} ${url.toString()} Success - Response: ${JSON.stringify(
                    apiResponse
                )}`
            );

            return apiResponse;
        } catch (err) {
            if (!options.retry) {
                options.retry = 0; // default value
            }

            if (options.retry < 5) {
                options.retry++;
                return await this.ping(url, options);
            }

            const apiResponse: APIResponse = {
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

            logger.error(
                `API Monitor - Pinging ${requestType} ${url.toString()} - ERROR: ${err} Response: ${JSON.stringify(
                    apiResponse
                )}`
            );

            return apiResponse;
        }
    }
}
