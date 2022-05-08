import Action from '../Types/Action';
import { ApiRequest, ApiError, ApiReset, ApiSuccess } from '../PayloadTypes/ApiBase';
import ApiBaseConstants from '../Constants/ApiBase';

export default class ActionBase { 
    public request(apiRequestPayload: ApiRequest): Action {
        return new Action({
            type: ApiBaseConstants.REQUEST,
            payload: apiRequestPayload,
        });
    }

    public error(apiError: ApiError): Action {
        return new Action({
            type: ApiBaseConstants.ERROR,
            payload: apiError,
        })
    }

    public success(apiSuccess: ApiSuccess): Action {
        return new Action({
            type: ApiBaseConstants.SUCCESS,
            payload: apiSuccess,
        })
    }

    public reset(): Action { 
        const apiReset: ApiReset = {};
        return new Action({
            type: ApiBaseConstants.RESET,
            payload: apiReset
        });
    }
}

