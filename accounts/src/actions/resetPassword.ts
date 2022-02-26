import { postApi } from '../api';
import * as types from '../constants/resetPassword';
import errors from '../errors';

// There are three possible states for our resetPassword
// process and we need actions for each of them

export function resetPasswordRequest(promise: $TSFixMe) {
    return {
        type: types.PASSWORDRESET_REQUEST,
        payload: promise,
    };
}

export function resetPasswordError(error: $TSFixMe) {
    return {
        type: types.PASSWORDRESET_FAILED,
        payload: error,
    };
}

export function resetPasswordSuccess(data: $TSFixMe) {
    return {
        type: types.PASSWORDRESET_SUCCESS,
        payload: data,
    };
}

export const resetResetPassword = () => {
    return {
        type: types.RESET_PASSWORDRESET,
    };
};

export function resetPassword(values: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = postApi('user/forgot-password', values);
        dispatch(resetPasswordRequest(promise));

        promise.then(
            function(data) {
                dispatch(resetPasswordSuccess(data));
            },
            function(error) {
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
                dispatch(resetPasswordError(errors(error)));
            }
        );
    };
}
