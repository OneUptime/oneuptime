import axios, { AxiosError } from "axios";
import Headers from "./API/Headers";
import URL from "./API/URL";
import HTML from "./Html";
import WebsiteRequestException from "./Exception/WebsiteRequestException";

export interface WebsiteResponse {
    url: URL,
    requestHeaders: Headers,
    responseHeaders: Headers,
    responseStatusCode: number,
    responseBody: HTML,
    isOnline: boolean,
}


export default class WebsiteRequest {
    public static async get(url: URL, options: {
        headers?: Headers | undefined,
        timeout?: number | undefined,
    }): Promise<WebsiteResponse> {
        try {
            // use axios to fetch an HTML page
            const response = await axios.get(url.toString(), {
                headers: options.headers || {},
                timeout: options.timeout || 5000,
            });


            // return the response
            return {
                url: url,
                requestHeaders: options.headers || {},
                responseHeaders: response.headers,
                responseStatusCode: response.status,
                responseBody: new HTML(response.data),
                isOnline: true,
            };
        } catch (err) {
            throw new WebsiteRequestException((err as Error | AxiosError).message);
        }

    }
}