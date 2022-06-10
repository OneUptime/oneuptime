import axios, { AxiosError } from 'axios';
import URL from '../Types/API/URL';
import { JSONObject, JSONArray } from '../Types/JSON';
import Headers from '../Types/API/Headers';
import HTTPResponse from '../Types/API/HTTPResponse';
import HTTPErrorResponse from '../Types/API/HTTPErrorResponse';
import HTTPMethod from '../Types/API/HTTPMethod';
import APIException from '../Types/Exception/ApiException';
import Protocol from '../Types/API/Protocol';
import Hostname from '../Types/API/Hostname';
import Route from '../Types/API/Route';
import BaseModel from '../Models/BaseModel';

export default class API {
    private _protocol: Protocol = Protocol.HTTPS;
    public get protocol(): Protocol {
        return this._protocol;
    }
    public set protocol(v: Protocol) {
        this._protocol = v;
    }

    private _hostname!: Hostname;
    public get hostname(): Hostname {
        return this._hostname;
    }
    public set hostname(v: Hostname) {
        this._hostname = v;
    }

    private _baseRoute!: Route;
    public get baseRoute(): Route {
        return this._baseRoute;
    }
    public set baseRoute(v: Route) {
        this._baseRoute = v;
    }

    public constructor(
        protocol: Protocol,
        hostname: Hostname,
        baseRoute?: Route
    ) {
        this.protocol = protocol;
        this.hostname = hostname;

        if (baseRoute) {
            this.baseRoute = baseRoute;
        } else {
            this.baseRoute = new Route('/');
        }
    }

    public async get<
        T extends JSONObject | JSONArray | BaseModel | Array<BaseModel>
    >(
        path: Route,
        data?: JSONObject | JSONArray,
        headers?: Headers
    ): Promise<HTTPResponse<T>> {
        return await API.get<T>(
            new URL(
                this.protocol,
                this.hostname,
                this.baseRoute.addRoute(path)
            ),
            data,
            headers
        );
    }

    public async delete<
        T extends JSONObject | JSONArray | BaseModel | Array<BaseModel>
    >(
        path: Route,
        data?: JSONObject | JSONArray,
        headers?: Headers
    ): Promise<HTTPResponse<T>> {
        return await API.delete<T>(
            new URL(
                this.protocol,
                this.hostname,
                this.baseRoute.addRoute(path)
            ),
            data,
            headers
        );
    }

    public async put<
        T extends JSONObject | JSONArray | BaseModel | Array<BaseModel>
    >(
        path: Route,
        data?: JSONObject | JSONArray,
        headers?: Headers
    ): Promise<HTTPResponse<T>> {
        return await API.put<T>(
            new URL(
                this.protocol,
                this.hostname,
                this.baseRoute.addRoute(path)
            ),
            data,
            headers
        );
    }

    public async post<
        T extends JSONObject | JSONArray | BaseModel | Array<BaseModel>
    >(
        path: Route,
        data?: JSONObject | JSONArray,
        headers?: Headers
    ): Promise<HTTPResponse<T>> {
        return await API.post<T>(
            new URL(
                this.protocol,
                this.hostname,
                this.baseRoute.addRoute(path)
            ),
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
        const defaultHeaders: Headers = {
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

    public static async get<
        T extends JSONObject | JSONArray | BaseModel | Array<BaseModel>
    >(
        url: URL,
        data?: JSONObject | JSONArray,
        headers?: Headers
    ): Promise<HTTPResponse<T>> {
        return await this.fetch<T>(HTTPMethod.GET, url, data, headers);
    }

    public static async delete<
        T extends JSONObject | JSONArray | BaseModel | Array<BaseModel>
    >(
        url: URL,
        data?: JSONObject | JSONArray,
        headers?: Headers
    ): Promise<HTTPResponse<T>> {
        return await this.fetch(HTTPMethod.DELETE, url, data, headers);
    }

    public static async put<
        T extends JSONObject | JSONArray | BaseModel | Array<BaseModel>
    >(
        url: URL,
        data?: JSONObject | JSONArray,
        headers?: Headers
    ): Promise<HTTPResponse<T>> {
        return await this.fetch(HTTPMethod.PUT, url, data, headers);
    }

    public static async post<
        T extends JSONObject | JSONArray | BaseModel | Array<BaseModel>
    >(
        url: URL,
        data?: JSONObject | JSONArray,
        headers?: Headers
    ): Promise<HTTPResponse<T>> {
        return await this.fetch(HTTPMethod.POST, url, data, headers);
    }

    private static async fetch<
        T extends JSONObject | JSONArray | BaseModel | Array<BaseModel>
    >(
        method: HTTPMethod,
        url: URL,
        data?: JSONObject | JSONArray,
        headers?: Headers
    ): Promise<HTTPResponse<T>> {
        const apiHeaders: Headers = this.getHeaders(headers);

        try {
            const result: {
                data: JSONObject | JSONArray;
                status: number;
            } = await axios({
                method: method,
                url: url.toString(),
                headers: apiHeaders,
                data,
            });

            const response: HTTPResponse<T> = new HTTPResponse<T>(
                result.status,
                result.data
            );

            return response;
        } catch (e) {
            const error: Error | AxiosError = e as Error | AxiosError;
            let errorResponse: HTTPErrorResponse | APIException;
            if (axios.isAxiosError(error)) {
                // Do whatever you want with native error
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
