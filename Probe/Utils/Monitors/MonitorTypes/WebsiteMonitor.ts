import URL from 'Common/Types/API/URL';
import Headers from 'Common/Types/API/Headers';
import PositiveNumber from 'Common/Types/PositiveNumber';
import Protocol from 'Common/Types/API/Protocol';
import WebsiteRequest, { WebsiteResponse } from 'Common/Types/WebsiteRequest';
import HTML from 'Common/Types/Html';
import { AxiosError } from 'axios';
import logger from 'CommonServer/Utils/Logger';
import HTTPMethod from 'Common/Types/API/HTTPMethod';

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
    public static async ping(
        url: URL,
        options: {
            retry?: number | undefined;
            isHeadRequest?: boolean | undefined;
        }
    ): Promise<ProbeWebsiteResponse> {
        let requestType: HTTPMethod = HTTPMethod.GET;

        if (options.isHeadRequest) {
            requestType = HTTPMethod.HEAD;
        }

        try {
            logger.info(
                `Website Monitor - Pinging ${requestType} ${url.toString()}`
            );

            const startTime: [number, number] = process.hrtime();
            const result: WebsiteResponse = await WebsiteRequest.fetch(url, {
                isHeadRequest: options.isHeadRequest,
            });

            const endTime: [number, number] = process.hrtime(startTime);
            const responseTimeInMS: PositiveNumber = new PositiveNumber(
                (endTime[0] * 1000000000 + endTime[1]) / 1000000
            );

            const probeWebsiteResponse: ProbeWebsiteResponse = {
                url: url,
                requestHeaders: {},
                isOnline: true,
                isSecure: url.protocol === Protocol.HTTPS,
                responseTimeInMS: responseTimeInMS,
                statusCode: result.responseStatusCode,
                responseBody: result.responseBody,
                responseHeaders: result.responseHeaders,
            };

            logger.info(
                `Website Monitor - Pinging ${requestType} ${url.toString()} Success - Response: ${JSON.stringify(
                    probeWebsiteResponse
                )}`
            );

            return probeWebsiteResponse;
        } catch (err) {
            if (!options) {
                options = {};
            }

            if (!options.retry) {
                options.retry = 0; // default value
            }

            if (options.retry < 5) {
                options.retry++;
                return await this.ping(url, options);
            }

            let probeWebisteResponse: ProbeWebsiteResponse | undefined =
                undefined;

            if (err instanceof AxiosError) {
                probeWebisteResponse = {
                    url: url,
                    isOnline: Boolean(err.response),
                    requestHeaders: {},
                    isSecure: url.protocol === Protocol.HTTPS,
                    responseTimeInMS: new PositiveNumber(0),
                    statusCode: err.response?.status,
                    responseBody: err.response?.data,
                    responseHeaders: (err.response?.headers as Headers) || {},
                };
            } else {
                probeWebisteResponse = {
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

            logger.error(
                `Website Monitor - Pinging ${requestType} ${url.toString()} - ERROR: ${err} Response: ${JSON.stringify(
                    probeWebisteResponse
                )}`
            );

            return probeWebisteResponse;
        }
    }
}
