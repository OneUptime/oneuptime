import Action from '../Types/Action';
import {
    ApiRequest,
    ApiError,
    ApiReset,
    ApiSuccess,
} from '../PayloadTypes/ApiBasePayloadType';
import ApiBaseConstants from '../Constants/ApiBaseConstants';
import HTTPResponse from 'Common/Types/API/Response';
import { Dispatch } from 'redux';
import HTTPErrorResponse from 'Common/Types/API/ErrorResponse';

export default class ActionBase {
    private _name: string;
    private apiBaseConstants: ApiBaseConstants;
    public get name(): string {
        return this._name;
    }

    public constructor(name: string) {
        this._name = name;
        this.apiBaseConstants = new ApiBaseConstants(name);
    }

    public request(apiRequestPayload: ApiRequest): Action {
        return new Action({
            type: this.apiBaseConstants.REQUEST,
            payload: apiRequestPayload,
        });
    }

    public error(apiError: ApiError): Action {
        return new Action({
            type: this.apiBaseConstants.ERROR,
            payload: apiError,
        });
    }

    public success(apiSuccess: ApiSuccess): Action {
        return new Action({
            type: this.apiBaseConstants.SUCCESS,
            payload: apiSuccess,
        });
    }

    public reset(): Action {
        const apiReset: ApiReset = {};
        return new Action({
            type: this.apiBaseConstants.RESET,
            payload: apiReset,
        });
    }

    public requestData(apiRequest: Promise<HTTPResponse>): Function {
        return async (dispatch: Dispatch): Promise<void> => {
            dispatch(
                this.request({
                    requesting: true,
                    httpResponsePromise: apiRequest,
                })
            );

            try {
                const response: HTTPResponse = await apiRequest;

                dispatch(
                    this.success({
                        response: response,
                    })
                );
            } catch (e) {
                const errorResponse: HTTPErrorResponse = e as HTTPErrorResponse;
                this.error({
                    errorResponse: errorResponse,
                });
            }
        };
    }
}
