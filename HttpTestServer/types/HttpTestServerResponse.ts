import PositiveNumber from 'Common/Types/PositiveNumber';
import Headers from 'Common/Types/api/Headers';
import { JSONObject, JSONObjectOrArray } from 'Common/Types/JSON';
import HTML from 'Common/Types/html';
import ResponseType from 'Common/Types/api/ResponseType';

class HTTPTestServerResponse {
    private _statusCode: PositiveNumber = new PositiveNumber(200);
    public get statusCode(): PositiveNumber {
        return this._statusCode;
    }
    public set statusCode(v: PositiveNumber) {
        this._statusCode = v;
    }

    private _responseType: ResponseType = ResponseType.JSON;
    public get responseType(): ResponseType {
        return this._responseType;
    }
    public set responseType(v: ResponseType) {
        this._responseType = v;
    }

    private _responseTime: PositiveNumber = new PositiveNumber(0);
    public get responseTime(): PositiveNumber {
        return this._responseTime;
    }
    public set responseTime(v: PositiveNumber) {
        this._responseTime = v;
    }

    private _headers: Headers = {};

    public get headers(): Headers {
        return this._headers;
    }

    public set headers(v: Headers) {
        this._headers = v;
    }

    private _jsonBody: JSONObjectOrArray = {
        status: 'ok',
    };

    public get jsonBody(): JSONObjectOrArray {
        return this._jsonBody;
    }
    public set jsonBody(v: JSONObjectOrArray) {
        this._jsonBody = v;
    }

    private _htmlBody: HTML = new HTML('');
    public get htmlBody(): HTML {
        return this._htmlBody;
    }
    public set htmlBody(v: HTML) {
        this._htmlBody = v;
    }

    public toJSON(): JSONObject {
        return {
            statusCode: this.statusCode.toNumber(),
            responseType: {
                values: [
                    ResponseType.JSON.toString(),
                    ResponseType.HTML.toString(),
                ],
                currentType: this.responseType.toString(),
            },
            responseTime: this.responseTime.toNumber(),
            header: this.headers,
            jsonBody: this.jsonBody,
            htmlBody: this.htmlBody.toString(),
        };
    }
}

export default new HTTPTestServerResponse();
