import BackendAPI from 'common-ui/src/utils/api/backend';
import { Dispatch } from 'redux';
import Route from 'common/types/api/route';
import * as types from '../constants/login';
import { User } from '../config';
import ErrorPayload from 'common-ui/src/payload-types/error';
export const loginRequired = () => {
    return {
        type: types.LOGIN_REQUIRED,
    };
};

export const loginRequest = (promise: $TSFixMe) => {
    return {
        type: types.LOGIN_REQUEST,
        payload: promise,
    };
};

export const loginError = (error: ErrorPayload) => {
    return {
        type: types.LOGIN_FAILED,
        payload: error,
    };
};

export const loginSuccess = (user: $TSFixMe) => {
    //save user session details.
    User.setUserId(user.id);
    User.setAccessToken(user.tokens.jwtAccessToken);

    return {
        type: types.LOGIN_SUCCESS,
        payload: user,
    };
};

export const resetLogin = () => {
    return {
        type: types.RESET_LOGIN,
    };
};

// Calls the API to register a user.
export const loginUser = (values: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.post(new Route('user/login'), values);
        dispatch(loginRequest(promise));

        promise.then(
            function (user) {
                dispatch(loginSuccess(user.data));
            },
            function (error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
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
