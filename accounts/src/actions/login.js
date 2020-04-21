import { postApi, getApi } from '../api';
import * as types from '../constants/login';
import { User, DASHBOARD_URL, ADMIN_DASHBOARD_URL } from '../config.js';
import errors from '../errors';
import { getQueryVar } from '../config';
import { resendToken } from './resendToken';
import Cookies from 'universal-cookie';
import store from '../store';

// There are three possible states for our login
// process and we need actions for each of them

export function loginRequest(promise) {
    return {
        type: types.LOGIN_REQUEST,
        payload: promise,
    };
}

export function loginError(error) {
    return {
        type: types.LOGIN_FAILED,
        payload: error,
    };
}

export function loginSuccess(user) {
    //save user session details.
    if (!user.id) {
        return {
            type: types.LOGIN_SUCCESS,
            payload: user,
        };
    }

    const state = store.getState();
    const { statusPageLogin, statusPageURL } = state.login;
    if (statusPageLogin) {
        const newURL = `${statusPageURL}?userId=${user.id}&accessToken=${user.tokens.jwtAccessToken}`;
        return (window.location = newURL);
    }

    //share localStorage with dashboard app
    const cookies = new Cookies();
    cookies.set('data', user, {
        path: '/',
        maxAge: 8640000,
    });

    if (user.role === 'master-admin') {
        //share localStorage with admin dashboard app
        const cookies = new Cookies();
        cookies.set('admin-data', user, {
            path: '/',
            maxAge: 8640000,
        });
    }

    if (user.redirect) {
        return (window.location = `${user.redirect}?accessToken=${user.tokens.jwtAccessToken}`);
    } else if (user.role === 'master-admin') {
        window.location = ADMIN_DASHBOARD_URL;
    } else {
        window.location = DASHBOARD_URL;
    }

    return {
        type: types.LOGIN_SUCCESS,
        payload: user,
    };
}

export const resetLogin = () => {
    return {
        type: types.RESET_LOGIN,
    };
};

export function verifyTokenRequest(promise) {
    return {
        type: types.AUTH_VERIFICATION_REQUEST,
        payload: promise,
    };
}

export function verifyTokenError(error) {
    return {
        type: types.AUTH_VERIFICATION_FAILED,
        payload: error,
    };
}

// Calls the API to register a user.
export function loginUser(values) {
    const initialUrl = User.initialUrl();
    const redirect = getQueryVar('redirectTo', initialUrl);
    if (redirect) values.redirect = redirect;
    return function(dispatch) {
        const promise = postApi('user/login', values);
        dispatch(loginRequest(promise));

        promise.then(
            function(user) {
                dispatch(loginSuccess(user.data));
            },
            function(error) {
                if (error.message === 'Verify your email first.') {
                    dispatch(resendToken(values));
                }
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
                dispatch(loginError(errors(error)));
            }
        );
        return promise;
    };
}

// Calls the API to verify a user token and log them in.
export function verifyAuthToken(values) {
    const initialUrl = User.initialUrl();
    const redirect = getQueryVar('redirectTo', initialUrl);
    if (redirect) values.redirect = redirect;
    const email = User.getEmail();
    values.email = email;
    return function(dispatch) {
        const promise = postApi('user/totp/verifyToken', values);
        dispatch(verifyTokenRequest(promise));

        promise.then(
            function(user) {
                dispatch(loginSuccess(user.data));
            },
            function(error) {
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
                dispatch(verifyTokenError(errors(error)));
            }
        );
        return promise;
    };
}

// Use backup code to login a user.

export const resetBackupCodeLogin = () => {
    return {
        type: types.RESET_BACKUP_CODE_VERIFICATION,
    };
};

export function useBackupCodeRequest(promise) {
    return {
        type: types.BACKUP_CODE_VERIFICATION_REQUEST,
        payload: promise,
    };
}

export function useBackupCodeError(error) {
    return {
        type: types.BACKUP_CODE_VERIFICATION_FAILED,
        payload: error,
    };
}

export function verifyBackupCode(values) {
    const initialUrl = User.initialUrl();
    const redirect = getQueryVar('redirectTo', initialUrl);
    if (redirect) values.redirect = redirect;
    const email = User.getEmail();
    values.email = email;
    return function(dispatch) {
        const promise = postApi('user/verify/backupCode', values);
        dispatch(useBackupCodeRequest(promise));

        promise.then(
            function(user) {
                dispatch(loginSuccess(user.data));
            },
            function(error) {
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
                dispatch(useBackupCodeError(errors(error)));
            }
        );
        return promise;
    };
}

export function saveStatusPage(data) {
    return {
        type: types.SAVE_STATUS_PAGE,
        payload: data,
    };
}

export function masterAdminExistsRequest(promise) {
    return {
        type: types.MASTER_ADMIN_EXISTS_REQUEST,
        payload: promise,
    };
}

export function masterAdminExistsError(error) {
    return {
        type: types.MASTER_ADMIN_EXISTS_FAILED,
        payload: error,
    };
}

export function masterAdminExistsSuccess(data) {
    return {
        type: types.MASTER_ADMIN_EXISTS_SUCCESS,
        payload: data,
    };
}

export const resetMasterAdminExists = () => {
    return {
        type: types.RESET_MASTER_ADMIN_EXISTS,
    };
};

// Calls the API to register a user.
export function checkIfMasterAdminExists(values) {
    return function(dispatch) {
        const promise = getApi('user/masterAdminExists', values);
        dispatch(masterAdminExistsRequest(promise));
        promise.then(
            function(response) {
                dispatch(masterAdminExistsSuccess(response.data));
            },
            function(error) {
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
                dispatch(masterAdminExistsError(errors(error)));
            }
        );

        return promise;
    };
}

export function changeLogin(data) {
    return function(dispatch) {
        dispatch({
            type: types.CHANGE_LOGIN,
            payload: data,
        });
    };
}
