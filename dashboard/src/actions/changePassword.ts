import { postApi } from '../api';
import { Dispatch } from 'redux';
import * as types from '../constants/changePassword';
import errors from '../errors';

export const changePasswordRequest = (promise: $TSFixMe) => {
    return {
        type: types.CHANGEPASSWORD_REQUEST,
        payload: promise,
    };
};

export const changePasswordError = (error: $TSFixMe) => {
    return {
        type: types.CHANGEPASSWORD_FAILED,
        payload: error,
    };
};

export const changePasswordSuccess = (values: $TSFixMe) => {
    return {
        type: types.CHANGEPASSWORD_SUCCESS,
        payload: values,
    };
};

export const resetChangePassword = () => {
    return {
        type: types.RESET_CHANGEPASSWORD,
    };
};

// Calls the API to register a user.
export const changePassword = (values: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = postApi('user/reset-password', values);
        dispatch(changePasswordRequest(promise));

        promise.then(
            function (response) {
                dispatch(changePasswordSuccess(response.data));
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
                dispatch(changePasswordError(errors(error)));
            }
        );
    };
};
