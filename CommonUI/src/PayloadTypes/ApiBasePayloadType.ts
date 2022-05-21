import HTTPErrorResponse from 'Common/Types/API/ErrorResponse';
import HTTPResponse from 'Common/Types/API/Response';
import ActionPayload from '../Types/ActionPayload';

export interface ApiRequest extends ActionPayload {
    requesting: boolean;
    httpResponsePromise: Promise<HTTPResponse>;
}
export interface ApiError extends ActionPayload {
    errorResponse: HTTPErrorResponse;
}

export interface ApiSuccess extends ActionPayload {
    response: HTTPResponse;
}

export type ApiReset = ActionPayload;

export type PayloadTypes = ApiRequest | ApiError | ApiSuccess | ApiReset;
