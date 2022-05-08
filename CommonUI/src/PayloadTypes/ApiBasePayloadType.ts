import HTTPErrorResponse from 'Common/Types/API/ErrorResponse';
import HTTPResponse from 'Common/Types/API/Response';
import ActionPayload from '../Types/ActionPayload';

export interface ApiRequest extends ActionPayload {
    requesting: boolean;
}
export interface ApiError extends ActionPayload {
    error: HTTPErrorResponse;
}

export interface ApiSuccess extends ActionPayload {
    data: HTTPResponse;
}

export interface ApiReset extends ActionPayload {}

export type PayloadTypes = ApiRequest | ApiError | ApiSuccess | ApiReset;
