import axios, { AxiosError } from 'axios';
import URL from '../types/api/url';
import { JSONValue } from '../types/json';
import Headers from '../types/api/headers';
import HTTPRepsonse from '../types/api/response';
import HTTPErrorResponse from '../types/api/errorResponse';
import HTTPMethod from '../types/api/method';
import APIException from '../types/exception/apiException';

export default class API {
    static getHeaders(headers?: Headers): Headers {
        let defaultHeaders: Headers = {
            'Access-Control-Allow-Origin': '*',
            Accept: 'application/json',
            'Content-Type': 'application/json;charset=UTF-8',
        };

        if (headers) {
            defaultHeaders = {
                ...defaultHeaders,
                ...headers,
            };
        }

        return defaultHeaders;
    }

    public static async get(url: URL, data?: JSONValue, headers?: Headers): Promise<HTTPRepsonse> {
        return await this.fetch(HTTPMethod.GET, url, data, headers);
    }

    public static async delete(url: URL, data?: JSONValue, headers?: Headers): Promise<HTTPRepsonse> {
        return await this.fetch(HTTPMethod.DELETE, url, data, headers);
    }

    public static async put(url: URL, data?: JSONValue, headers?: Headers): Promise<HTTPRepsonse> {
        return await this.fetch(HTTPMethod.PUT, url, data, headers);
    }

    public static async post(url: URL, data?: JSONValue, headers?: Headers): Promise<HTTPRepsonse> {
        return await this.fetch(HTTPMethod.POST, url, data, headers);
    }

    private static async fetch(method: HTTPMethod, url: URL, data?: JSONValue, headers?: Headers): Promise<HTTPRepsonse> {
        const apiHeaders: Headers = this.getHeaders(headers);

        try {
            const result = await axios({
                method: method,
                url: url.toString(),
                headers: apiHeaders,
                data,
            });

            const response = new HTTPRepsonse(result.status, result.data);
            return response;
        } catch (e) {
            const error = e as Error | AxiosError;
            if (axios.isAxiosError(error)) {
                // do whatever you want with native error
                throw this.getErrorResponse(error);
            } else {
                throw new APIException(error.message)
            }
        }
    }

    private static getErrorResponse(error: AxiosError): HTTPErrorResponse {
        if (error.response) {
            return new HTTPErrorResponse(error.response.status, error.response.data);
        }

        throw new APIException("No error response body");
    }
}
