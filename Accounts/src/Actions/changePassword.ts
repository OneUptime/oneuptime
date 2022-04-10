import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import Route from 'Common/Types/api/route';
import * as types from '../constants/changePassword';
import ErrorPayload from 'CommonUI/src/payload-types/error';

export const changePasswordRequest = (promise: $TSFixMe) => {
    return {
        type: types.CHANGEPASSWORD_REQUEST,
        payload: promise,
    };
};

export const changePasswordError = (error: ErrorPayload) => {
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
        const promise = BackendAPI.post(
            new Route('user/reset-password'),
            values
        );
        dispatch(changePasswordRequest(promise));

        promise.then(
            function (response) {
                dispatch(changePasswordSuccess(response.data));
            },
            function (error) {
                dispatch(changePasswordError(error));
            }
        );
    };
};
