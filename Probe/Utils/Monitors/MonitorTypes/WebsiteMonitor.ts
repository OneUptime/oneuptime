import URL from 'Common/Types/API/URL';
import Headers from 'Common/Types/API/Headers';
import PositiveNumber from 'Common/Types/PositiveNumber';
import Protocol from 'Common/Types/API/Protocol';
import WebsiteRequest, { WebsiteResponse } from 'Common/Types/WebsiteRequest';
import HTML from 'Common/Types/Html';
import { AxiosError } from 'axios';

export interface ProbeWebsiteResponse {
    url: URL;
    requestHeaders: Headers;
    isSecure: boolean;
    responseTimeInMS: PositiveNumber;
    statusCode: number | undefined;
    responseBody: HTML | undefined;
    responseHeaders: Headers | undefined;
    isOnline: boolean;
}

export default class WebsiteMonitor {
    public static async ping(url: URL): Promise<ProbeWebsiteResponse> {
        try {
            const startTime: [number, number] = process.hrtime();
            const result: WebsiteResponse = await WebsiteRequest.get(url, {});
            const endTime: [number, number] = process.hrtime(startTime);
            const responseTimeInMS: PositiveNumber = new PositiveNumber(
                (endTime[0] * 1000000000 + endTime[1]) / 1000000
            );

            return {
                url: url,
                requestHeaders: {},
                isOnline: true,
                isSecure: url.protocol === Protocol.HTTPS,
                responseTimeInMS: responseTimeInMS,
                statusCode: result.responseStatusCode,
                responseBody: result.responseBody,
                responseHeaders: result.responseHeaders,
            };
        } catch (err) {
            if (err instanceof AxiosError) {
                return {
                    url: url,
                    isOnline: Boolean(err.response),
                    requestHeaders: {},
                    isSecure: url.protocol === Protocol.HTTPS,
                    responseTimeInMS: new PositiveNumber(0),
                    statusCode: err.response?.status,
                    responseBody: err.response?.data,
                    responseHeaders: (err.response?.headers as Headers) || {},
                };
            }

            return {
                url: url,
                isOnline: false,
                requestHeaders: {},
                isSecure: url.protocol === Protocol.HTTPS,
                responseTimeInMS: new PositiveNumber(0),
                statusCode: undefined,
                responseBody: undefined,
                responseHeaders: undefined,
            };
        }
    }
}
