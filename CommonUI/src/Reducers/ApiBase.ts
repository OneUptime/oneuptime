import ApiBaseConstants from '../Constants/ApiBaseConstants';
import Action from '../Types/Action';
import {
    ApiRequest,
    ApiError,
    ApiSuccess,
} from '../PayloadTypes/ApiBasePayloadType';
import HTTPResponse from 'Common/Types/API/Response';
import HTTPErrorResponse from 'Common/Types/API/ErrorResponse';

export interface InitialStateType {
    requesting: boolean;
    data: HTTPResponse | null;
    error: HTTPErrorResponse | null;
    success: boolean;
}

export const initialState: InitialStateType = {
    requesting: false,
    data: null,
    error: null,
    success: false,
};

const reducer: Function = (
    state: InitialStateType = initialState,
    action: Action
): InitialStateType => {
    switch (action.type) {
        case ApiBaseConstants.REQUEST:
            return Object.assign({}, state, {
                requesting: (action.payload as ApiRequest).requesting,
            });
        case ApiBaseConstants.ERROR:
            return Object.assign({}, state, {
                error: (action.payload as ApiError).error,
            });
        case ApiBaseConstants.RESET:
            return Object.assign({}, state, initialState);
        case ApiBaseConstants.SUCCESS:
            return Object.assign({}, state, {
                success: (action.payload as ApiSuccess).data,
            });
        default:
            return state;
    }
};

export default reducer;
