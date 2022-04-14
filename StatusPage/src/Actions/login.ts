import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import Route from 'Common/Types/api/route';
import * as types from '../constants/login';
import { User } from '../config';
import ErrorPayload from 'CommonUI/src/payload-types/error';
export const loginRequired: Function = (): void => {
    return {
        type: types.LOGIN_REQUIRED,
    };
};

export const loginRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.LOGIN_REQUEST,
        payload: promise,
    };
};

export const loginError: Function = (error: ErrorPayload): void => {
    return {
        type: types.LOGIN_FAILED,
        payload: error,
    };
};

export const loginSuccess: Function = (user: $TSFixMe): void => {
    //save user session details.
    User.setUserId(user.id);
    User.setAccessToken(user.tokens.jwtAccessToken);

    return {
        type: types.LOGIN_SUCCESS,
        payload: user,
    };
};

export const resetLogin: Function = (): void => {
    return {
        type: types.RESET_LOGIN,
    };
};

// Calls the API to register a user.
export const loginUser: Function = (values: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            new Route('user/login'),
            values
        );
        dispatch(loginRequest(promise));

        promise.then(
            (user): void => {
                dispatch(loginSuccess(user.data));
            },
            (error): void => {
                if (error && error.response && error.response.data) {
                    error = error.response.data;
                }
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                }
                if (error.length > 100) {
                    error = 'Network Error';
                }
                dispatch(loginError(error));
            }
        );
        return promise;
    };
};
