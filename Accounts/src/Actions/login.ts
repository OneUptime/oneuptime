import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/login';
import { User, DASHBOARD_URL, ADMIN_DASHBOARD_URL } from '../config.js';
import Route from 'Common/Types/api/route';
import { getQueryVar } from '../config';
import { resendToken } from './resendToken';
import Cookies from 'universal-cookie';
import store from '../store';
import ErrorPayload from 'CommonUI/src/payload-types/error';
// There are three possible states for our login
// process and we need actions for each of them

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
    if (!user.id) {
        return {
            type: types.LOGIN_SUCCESS,
            payload: user,
        };
    }

    const state: $TSFixMe = store.getState();
    const { statusPageLogin, statusPageURL }: $TSFixMe = state.login;
    if (statusPageLogin) {
        const newURL: string = `${statusPageURL}?userId=${user.id}&accessToken=${user.tokens.jwtAccessToken}`;

        return (window.location.href = newURL);
    }

    //share localStorage with dashboard app
    const cookies: $TSFixMe = new Cookies();
    cookies.set('data', user, {
        path: '/',
        maxAge: 8640000,
        secure: true,
        sameSite: 'none',
    });

    if (user.role === 'master-admin') {
        //share localStorage with admin dashboard app
        const cookies: $TSFixMe = new Cookies();
        cookies.set('admin-data', user, {
            path: '/',
            maxAge: 8640000,
            secure: true,
            sameSite: 'none',
        });
    }

    if (user.redirect && user?.tokens?.jwtAccessToken) {
        return (window.location.href = `${user.redirect}?accessToken=${user.tokens.jwtAccessToken}`);
    } else if (user.redirect) {
        return (window.location.href = user.redirect);
    } else if (user.role === 'master-admin') {
        window.location.href = ADMIN_DASHBOARD_URL;
    } else {
        window.location.href = DASHBOARD_URL;
    }

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

export const verifyTokenRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.AUTH_VERIFICATION_REQUEST,
        payload: promise,
    };
};

export const verifyTokenError: Function = (error: ErrorPayload): void => {
    return {
        type: types.AUTH_VERIFICATION_FAILED,
        payload: error,
    };
};

// Calls the API to register a user.
export const loginUser: Function = (values: $TSFixMe): void => {
    const initialUrl: $TSFixMe = User.initialUrl();
    const redirect: $TSFixMe = getQueryVar('redirectTo', initialUrl);
    if (redirect) {
        values.redirect = redirect;
    }
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            new Route('user/login'),
            values
        );
        dispatch(loginRequest(promise));

        promise.then(
            (user: $TSFixMe): void => {
                dispatch(loginSuccess(user.data));
            },
            (error: $TSFixMe): void => {
                if (error.message === 'Verify your email first.') {
                    dispatch(resendToken(values));
                    dispatch({
                        type: types.LOGIN_STATE,
                        payload: values,
                    });
                }

                dispatch(loginError(error));
            }
        );
        return promise;
    };
};

export const loginUserSso: $TSFixMe = (values: $TSFixMe) => {
    return async (dispatch: Dispatch) => {
        try {
            const response: $TSFixMe = await BackendAPI.get(
                `user/sso/login?email=${values.email}`
            );

            const { url }: $TSFixMe = response.data;
            window.location.href = url;
        } catch (error) {
            let errorMsg: $TSFixMe;
            if (error && error.response && error.response.data) {
                errorMsg = error.response.data;
            }
            if (error && error.data) {
                errorMsg = error.data;
            }
            if (error && error.message) {
                errorMsg = error.message;
            } else {
                errorMsg = 'Network Error';
            }
            dispatch(loginError(errorMsg));
        }
    };
};

// Calls the API to verify a user token and log them in.
export const verifyAuthToken: Function = (values: $TSFixMe): void => {
    const initialUrl: $TSFixMe = User.initialUrl();
    const redirect: $TSFixMe = getQueryVar('redirectTo', initialUrl);
    if (redirect) {
        values.redirect = redirect;
    }
    const email: $TSFixMe = User.getEmail();
    values.email = values.email || email;
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            new Route('user/totp/verifyToken'),
            values
        );
        dispatch(verifyTokenRequest(promise));

        promise.then(
            (user: $TSFixMe): void => {
                dispatch(loginSuccess(user.data));
            },
            (error: $TSFixMe): void => {
                dispatch(verifyTokenError(error));
            }
        );
        return promise;
    };
};

// Use backup code to login a user.

export const resetBackupCodeLogin: Function = (): void => {
    return {
        type: types.RESET_BACKUP_CODE_VERIFICATION,
    };
};

export const useBackupCodeRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.BACKUP_CODE_VERIFICATION_REQUEST,
        payload: promise,
    };
};

export const useBackupCodeError: Function = (error: ErrorPayload): void => {
    return {
        type: types.BACKUP_CODE_VERIFICATION_FAILED,
        payload: error,
    };
};

export const verifyBackupCode: Function = (values: $TSFixMe): void => {
    const initialUrl: $TSFixMe = User.initialUrl();
    const redirect: $TSFixMe = getQueryVar('redirectTo', initialUrl);
    if (redirect) {
        values.redirect = redirect;
    }
    const email: $TSFixMe = User.getEmail();
    values.email = values.email || email;
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            new Route('user/verify/backupCode'),
            values
        );
        dispatch(useBackupCodeRequest(promise));

        promise.then(
            (user: $TSFixMe): void => {
                dispatch(loginSuccess(user.data));
            },
            (error: $TSFixMe): void => {
                dispatch(useBackupCodeError(error));
            }
        );
        return promise;
    };
};

export const saveStatusPage: Function = (data: $TSFixMe): void => {
    return {
        type: types.SAVE_STATUS_PAGE,
        payload: data,
    };
};

export const masterAdminExistsRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.MASTER_ADMIN_EXISTS_REQUEST,
        payload: promise,
    };
};

export const masterAdminExistsError: Function = (error: ErrorPayload): void => {
    return {
        type: types.MASTER_ADMIN_EXISTS_FAILED,
        payload: error,
    };
};

export const masterAdminExistsSuccess: Function = (data: $TSFixMe): void => {
    return {
        type: types.MASTER_ADMIN_EXISTS_SUCCESS,
        payload: data,
    };
};

export const resetMasterAdminExists: Function = (): void => {
    return {
        type: types.RESET_MASTER_ADMIN_EXISTS,
    };
};

// Calls the API to register a user.
export const checkIfMasterAdminExists: Function = (values: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            'user/masterAdminExists',
            values
        );
        dispatch(masterAdminExistsRequest(promise));
        promise.then(
            (response: $TSFixMe): void => {
                dispatch(masterAdminExistsSuccess(response.data));
            },
            (error: $TSFixMe): void => {
                dispatch(masterAdminExistsError(error));
            }
        );

        return promise;
    };
};

export const changeLogin: Function = (data: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: types.CHANGE_LOGIN,
            payload: data,
        });
    };
};
