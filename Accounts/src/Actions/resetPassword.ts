import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/resetPassword';
import Route from 'Common/Types/api/route';
import ErrorPayload from 'CommonUI/src/payload-types/error';

// There are three possible states for our resetPassword
// process and we need actions for each of them

export const resetPasswordRequest = (promise: $TSFixMe): void => {
    return {
        type: types.PASSWORDRESET_REQUEST,
        payload: promise,
    };
};

export const resetPasswordError = (error: ErrorPayload): void => {
    return {
        type: types.PASSWORDRESET_FAILED,
        payload: error,
    };
};

export const resetPasswordSuccess = (data: $TSFixMe): void => {
    return {
        type: types.PASSWORDRESET_SUCCESS,
        payload: data,
    };
};

export const resetResetPassword = (): void => {
    return {
        type: types.RESET_PASSWORDRESET,
    };
};

export const resetPassword = (values: $TSFixMe): void => {
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
                dispatch(resetPasswordError(error));
            }
        );
    };
};
