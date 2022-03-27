import BackendAPI from 'common-ui/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/resetPassword';
import Route from 'common/types/api/route';
// There are three possible states for our resetPassword
// process and we need actions for each of them

export const resetPasswordRequest = (promise: $TSFixMe) => {
    return {
        type: types.PASSWORDRESET_REQUEST,
        payload: promise,
    };
};

export const resetPasswordError = (error: $TSFixMe) => {
    return {
        type: types.PASSWORDRESET_FAILED,
        payload: error,
    };
};

export const resetPasswordSuccess = (data: $TSFixMe) => {
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

export const resetPassword = (values: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.post(
            new Route('user/forgot-password'),
            values
        );
        dispatch(resetPasswordRequest(promise));

        promise.then(
            function (data) {
                dispatch(resetPasswordSuccess(data));
            },
            function (error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(resetPasswordError(error));
            }
        );
    };
};
