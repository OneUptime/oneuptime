import { postApi } from '../api';
import * as types from '../constants/validateToken';
import errors from '../errors';

/*
 * There are three possible states for our validateToken
 * process and we need actions for each of them
 */

export function validateTokenRequest(promise) {
    return {
        type: types.VALIDATE_TOKEN_REQUEST,
        payload: promise,
    };
}

export function validateTokenError(error) {
    return {
        type: types.VALIDATE_TOKEN_FAILED,
        payload: error,
    };
}

export function validateTokenSuccess(accessToken) {
    sessionStorage.setItem('accessToken', accessToken);

    return {
        type: types.VALIDATE_TOKEN_SUCCESS,
        payload: accessToken,
    };
}

export const resetvalidateToken = () => ({
    type: types.RESET_VALIDATE_TOKEN,
});

// Calls the API to register a user.
export function validateToken(token) {
    return function(dispatch) {
        const promise = postApi(
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
}
