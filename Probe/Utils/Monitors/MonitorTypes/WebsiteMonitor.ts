import URL from 'Common/Types/API/URL';
import Headers from 'Common/Types/API/Headers';
import PositiveNumber from 'Common/Types/PositiveNumber';
import StatusCode from 'Common/Types/API/StatusCode';
import HTML from 'Common/Types/Html';
import API from 'Common/Utils/API';
import { HttpProtocol } from 'CommonServer/Config';
import Protocol from 'Common/Types/API/Protocol';

export interface WebsiteResponse {
    url: URL;
    requestHeaders: Headers;
    isSecure: boolean;
    responseTimeInMS: PositiveNumber;
    statusCode: number;
    responseBody: string;
    responseHeaders: Headers;
    isOnline: boolean;
}

export default class PingMonitor {
    public static async ping(
        url: URL
    ): Promise<WebsiteResponse> {
        try {
            const startTime: [number, number] = process.hrtime();
            const result = await API.get(url, {}, {});
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
                statusCode: result.statusCode,
                responseBody: result.data.toString(),
                responseHeaders: result.headers

            }
        } catch (err) {
            return {
                url: url,
                isOnline: false,
                requestHeaders: {},
                isSecure: url.protocol === Protocol.HTTPS,
                responseTimeInMS: new PositiveNumber(0),
                statusCode: 0,
                responseBody: '',
                responseHeaders: {}
            }
        }
    }
}

