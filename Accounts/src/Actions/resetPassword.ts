import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/resetPassword';
import Route from 'Common/Types/api/route';
import ErrorPayload from 'CommonUI/src/payload-types/error';

// There are three possible states for our resetPassword
// process and we need actions for each of them

export const resetPasswordRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.PASSWORDRESET_REQUEST,
        payload: promise,
    };
};

export const resetPasswordError: Function = (error: ErrorPayload): void => {
    return {
        type: types.PASSWORDRESET_FAILED,
        payload: error,
    };
};

export const resetPasswordSuccess: Function = (data: $TSFixMe): void => {
    return {
        type: types.PASSWORDRESET_SUCCESS,
        payload: data,
    };
};

export const resetResetPassword: Function = (): void => {
    return {
        type: types.RESET_PASSWORDRESET,
    };
};

export const resetPassword: Function = (values: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            new Route('user/forgot-password'),
            values
        );
        dispatch(resetPasswordRequest(promise));

        promise.then(
            (data): void => {
                dispatch(resetPasswordSuccess(data));
            },
            (error): void => {
                dispatch(resetPasswordError(error));
            }
        );
    };
};
