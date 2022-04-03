import PositiveNumber from 'common/types/positive-number';
import Headers from 'common/types/api/headers';
import { JSONObjectOrArray } from 'common/types/json';
import HTML from 'common/types/html';

class HTTPTestServerResponse {
    private _statusCode: PositiveNumber;
    public get statusCode(): PositiveNumber {
        return this._statusCode;
    }
    public set statusCode(v: PositiveNumber) {
        this._statusCode = v;
    }

    private _responseType: string;
    public get responseType(): string {
        return this._responseType;
    }
    public set responseType(v: string) {
        this._responseType = v;
    }

    private _responseTime: PositiveNumber;
    public get responseTime(): PositiveNumber {
        return this._responseTime;
    }
    public set responseTime(v: PositiveNumber) {
        this._responseTime = v;
    }

    private _headers: Headers;

    public get headers(): Headers {
        return this._headers;
    }

    public set headers(v: Headers) {
        this._headers = v;
    }

    private _jsonBody: JSONObjectOrArray;
    public get jsonBody(): JSONObjectOrArray {
        return this._jsonBody;
    }
    public set jsonBody(v: JSONObjectOrArray) {
        this._jsonBody = v;
    }

    private _htmlBody: HTML;
    public get htmlBody(): string {
        return this._htmlBody;
    }
    public set htmlBody(v: string) {
        this._htmlBody = v;
    }

    toJSON() {
        return {
            statusCode: 200,
            responseType: { values: ['json', 'html'], currentType: 'json' },
            responseTime: 0,
            header: {},
            josnBody: { status: 'ok' },
        };
    }
}

export default new HTTPTestServerResponse();
