import BackendAPI from '../api';
import { Dispatch } from 'redux';
import * as types from '../constants/validateToken';
import errors from '../errors';

/*
 * There are three possible states for our validateToken
 * process and we need actions for each of them
 */

export const validateTokenRequest = (promise: $TSFixMe) => {
    return {
        type: types.VALIDATE_TOKEN_REQUEST,
        payload: promise,
    };
};

export const validateTokenError = (error: $TSFixMe) => {
    return {
        type: types.VALIDATE_TOKEN_FAILED,
        payload: error,
    };
};

export const validateTokenSuccess = (accessToken: $TSFixMe) => {
    sessionStorage.setItem('accessToken', accessToken);

    return {
        type: types.VALIDATE_TOKEN_SUCCESS,
        payload: accessToken,
    };
};

export const resetvalidateToken = () => ({
    type: types.RESET_VALIDATE_TOKEN,
});

// Calls the API to register a user.
export const validateToken = (token: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.post(
            `user/isAuthenticated?accessToken=${token}`,
            {}
        );

        dispatch(validateTokenRequest(promise));

        promise.then(
            user => {
                dispatch(validateTokenSuccess(user.data.tokens.jwtAccessToken));
            },
            error => {
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
                dispatch(validateTokenError(errors(error)));
            }
        );

        return promise;
    };
};
