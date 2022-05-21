import BackendAPI from 'CommonUI/src/utils/api/backend';
import * as types from '../constants/resetPassword';
import Route from 'Common/Types/api/route';
/*
 * There are three possible states for our resetPassword
 * Process and we need actions for each of them
 */
export const resetPasswordRequest = (promise) => {
    return {
        type: types.PASSWORDRESET_REQUEST,
        payload: promise,
    };
};
export const resetPasswordError = (error) => {
    return {
        type: types.PASSWORDRESET_FAILED,
        payload: error,
    };
};
export const resetPasswordSuccess = (data) => {
    return {
        type: types.PASSWORDRESET_SUCCESS,
        payload: data,
    };
};
export const resetResetPassword = () => {
    return {
        type: types.RESET_PASSWORDRESET,
    };
};
export const resetPassword = (values) => {
    return function (dispatch) {
        const promise = BackendAPI.post(new Route('user/forgot-password'), values);
        dispatch(resetPasswordRequest(promise));
        promise.then((data) => {
            dispatch(resetPasswordSuccess(data));
        }, (error) => {
            dispatch(resetPasswordError(error));
        });
    };
};
