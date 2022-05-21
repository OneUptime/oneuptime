import BackendAPI from 'CommonUI/src/utils/api/backend';
import * as types from '../constants/resendToken';
import Route from 'Common/Types/api/route';
export const resendTokenRequest = (promise) => {
    return {
        type: types.RESENDTOKEN_REQUEST,
        payload: promise,
    };
};
export const resendTokenError = (error) => {
    return {
        type: types.RESENDTOKEN_FAILED,
        payload: error,
    };
};
export const resendTokenSuccess = (data) => {
    return {
        type: types.RESENDTOKEN_SUCCESS,
        payload: data,
    };
};
export const resendTokenReset = () => {
    return function (dispatch) {
        dispatch({
            type: types.RESENDTOKEN_RESET,
        });
    };
};
export const resendToken = (values) => {
    return function (dispatch) {
        const promise = BackendAPI.post(new Route('user/resend'), values);
        dispatch(resendTokenRequest(promise));
        promise.then((data) => {
            dispatch(resendTokenSuccess(data));
        }, (error) => {
            dispatch(resendTokenError(error));
        });
    };
};
