import axios, { AxiosError } from 'axios';
import URL from '../Types/API/URL';
import { JSONObjectOrArray } from '../Types/JSON';
import Headers from '../Types/API/Headers';
import HTTPResponse from '../Types/API/Response';
import HTTPErrorResponse from '../Types/API/ErrorResponse';
import HTTPMethod from '../Types/API/HTTPMethod';
import APIException from '../Types/Exception/ApiException';
import Protocol from '../Types/API/Protocol';
import Hostname from '../Types/API/Hostname';
import Route from '../Types/API/Route';

export default class API {
    private _protocol: Protocol = Protocol.HTTPS;
    public get protocol(): Protocol {
        return this._protocol;
    }
    public set protocol(v: Protocol) {
        this._protocol = v;
    }

    private _hostname: Hostname = new Hostname('localhost');
    public get hostname(): Hostname {
        return this._hostname;
    }
    public set hostname(v: Hostname) {
        this._hostname = v;
    }

    constructor(protocol: Protocol, hostname: Hostname) {
        this.protocol = protocol;
        this.hostname = hostname;
    }

    public async get(
        path: Route,
        data?: JSONObjectOrArray,
        headers?: Headers
    ): Promise<HTTPResponse> {
        return await API.get(
            new URL(this.protocol, this.hostname, path),
            data,
            headers
        );
    }

    public async delete(
        path: Route,
        data?: JSONObjectOrArray,
        headers?: Headers
    ): Promise<HTTPResponse> {
        return await API.delete(
            new URL(this.protocol, this.hostname, path),
            data,
            headers
        );
    }

    public async put(
        path: Route,
        data?: JSONObjectOrArray,
        headers?: Headers
    ): Promise<HTTPResponse> {
        return await API.put(
            new URL(this.protocol, this.hostname, path),
            data,
            headers
        );
    }

    public async post(
        path: Route,
        data?: JSONObjectOrArray,
        headers?: Headers
    ): Promise<HTTPResponse> {
        return await API.post(
            new URL(this.protocol, this.hostname, path),
            data,
            headers
        );
    }

    protected static handleError(
        error: HTTPErrorResponse | APIException
    ): HTTPErrorResponse | APIException {
        return error;
    }

    public static getDefaultHeaders(): Headers {
        const defaultHeaders: Headers: $TSFixMe = {
            'Access-Control-Allow-Origin': '*',
            Accept: 'application/json',
            'Content-Type': 'application/json;charset=UTF-8',
        };

        return defaultHeaders;
    }

    protected static getHeaders(headers?: Headers): Headers {
        let defaultHeaders: Headers = this.getDefaultHeaders();

        if (headers) {
            defaultHeaders = {
                ...defaultHeaders,
                ...headers,
            };
        }

        return defaultHeaders;
    }

    public static async get(
        url: URL,
        data?: JSONObjectOrArray,
        headers?: Headers
    ): Promise<HTTPResponse> {
        return await this.fetch(HTTPMethod.GET, url, data, headers);
    }

    public static async delete(
        url: URL,
        data?: JSONObjectOrArray,
        headers?: Headers
    ): Promise<HTTPResponse> {
        return await this.fetch(HTTPMethod.DELETE, url, data, headers);
    }

    public static async put(
        url: URL,
        data?: JSONObjectOrArray,
        headers?: Headers
    ): Promise<HTTPResponse> {
        return await this.fetch(HTTPMethod.PUT, url, data, headers);
    }

    public static async post(
        url: URL,
        data?: JSONObjectOrArray,
        headers?: Headers
    ): Promise<HTTPResponse> {
        return await this.fetch(HTTPMethod.POST, url, data, headers);
    }

    private static async fetch(
        method: HTTPMethod,
        url: URL,
        data?: JSONObjectOrArray,
        headers?: Headers
    ): Promise<HTTPResponse> {
        const apiHeaders: Headers = this.getHeaders(headers);

        try {
            const result = await axios({
                method: method,
                url: url.toString(),
                headers: apiHeaders,
                data,
            });

            const response = new HTTPResponse(result.status, result.data);
            return response;
        } catch (e) {
            const error = e as Error | AxiosError;
            let errorResponse: HTTPErrorResponse | APIException;
            if (axios.isAxiosError(error)) {
                // do whatever you want with native error
                errorResponse = this.getErrorResponse(error);
            } else {
                errorResponse = new APIException(error.message);
            }

            this.handleError(errorResponse);
            throw errorResponse;
        }
    }

    private static getErrorResponse(error: AxiosError): HTTPErrorResponse {
        if (error.response) {
            return new HTTPErrorResponse(
                error.response.status,
                error.response.data
            );
        }

        throw new APIException('No error response body');
    }
}
