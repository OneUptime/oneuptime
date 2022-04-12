import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import Route from 'Common/Types/api/route';
import * as types from '../constants/changePassword';
import ErrorPayload from 'CommonUI/src/payload-types/error';

export const changePasswordRequest = (promise: $TSFixMe): void => {
    return {
        type: types.CHANGEPASSWORD_REQUEST,
        payload: promise,
    };
};

export const changePasswordError = (error: ErrorPayload): void => {
    return {
        type: types.CHANGEPASSWORD_FAILED,
        payload: error,
    };
};

export const changePasswordSuccess = (values: $TSFixMe): void => {
    return {
        type: types.CHANGEPASSWORD_SUCCESS,
        payload: values,
    };
};

export const resetChangePassword = (): void => {
    return {
        type: types.RESET_CHANGEPASSWORD,
    };
};

// Calls the API to register a user.
export const changePassword = (values: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(
            new Route('user/reset-password'),
            values
        );
        dispatch(changePasswordRequest(promise));

        promise.then(
            function (response): void {
                dispatch(changePasswordSuccess(response.data));
            },
            function (error): void {
                dispatch(changePasswordError(error));
            }
        );
    };
};
