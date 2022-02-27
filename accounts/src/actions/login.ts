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

export function loginRequest(promise: $TSFixMe) {
    return {
        type: types.LOGIN_REQUEST,
        payload: promise,
    };
}

export function loginError(error: $TSFixMe) {
    return {
        type: types.LOGIN_FAILED,
        payload: error,
    };
}

export function loginSuccess(user: $TSFixMe) {
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
        // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'Location'... Remove this comment to see the full error message
        return (window.location = newURL);
    }

    //share localStorage with dashboard app
    const cookies = new Cookies();
    cookies.set('data', user, {
        path: '/',
        maxAge: 8640000,
        secure: true,
        sameSite: 'none',
    });

    if (user.role === 'master-admin') {
        //share localStorage with admin dashboard app
        const cookies = new Cookies();
        cookies.set('admin-data', user, {
            path: '/',
            maxAge: 8640000,
            secure: true,
            sameSite: 'none',
        });
    }

    if (user.redirect && user?.tokens?.jwtAccessToken) {
        // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'Location'... Remove this comment to see the full error message
        return (window.location = `${user.redirect}?accessToken=${user.tokens.jwtAccessToken}`);
    } else if (user.redirect) {
        return (window.location = user.redirect);
    } else if (user.role === 'master-admin') {
        // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'Location'... Remove this comment to see the full error message
        window.location = ADMIN_DASHBOARD_URL;
    } else {
        // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'Location'... Remove this comment to see the full error message
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

export function verifyTokenRequest(promise: $TSFixMe) {
    return {
        type: types.AUTH_VERIFICATION_REQUEST,
        payload: promise,
    };
}

export function verifyTokenError(error: $TSFixMe) {
    return {
        type: types.AUTH_VERIFICATION_FAILED,
        payload: error,
    };
}

// Calls the API to register a user.
export function loginUser(values: $TSFixMe) {
    const initialUrl = User.initialUrl();
    const redirect = getQueryVar('redirectTo', initialUrl);
    if (redirect) values.redirect = redirect;
    return function(dispatch: $TSFixMe) {
        const promise = postApi('user/login', values);
        dispatch(loginRequest(promise));

        promise.then(
            function(user) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(loginSuccess(user.data));
            },
            function(error) {
                if (error.message === 'Verify your email first.') {
                    dispatch(resendToken(values));
                    dispatch({
                        type: types.LOGIN_STATE,
                        payload: values,
                    });
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

export const loginUserSso = (values: $TSFixMe) => async (
    dispatch: $TSFixMe
) => {
    try {
        const response = await getApi(`user/sso/login?email=${values.email}`);
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
        const { url } = response.data;
        window.location = url;
    } catch (error) {
        let errorMsg;
        if (error && error.response && error.response.data)
            errorMsg = error.response.data;
        if (error && error.data) {
            errorMsg = error.data;
        }
        if (error && error.message) {
            errorMsg = error.message;
        } else {
            errorMsg = 'Network Error';
        }
        dispatch(loginError(errors(errorMsg)));
    }
};

// Calls the API to verify a user token and log them in.
export function verifyAuthToken(values: $TSFixMe) {
    const initialUrl = User.initialUrl();
    const redirect = getQueryVar('redirectTo', initialUrl);
    if (redirect) values.redirect = redirect;
    const email = User.getEmail();
    values.email = values.email || email;
    return function(dispatch: $TSFixMe) {
        const promise = postApi('user/totp/verifyToken', values);
        dispatch(verifyTokenRequest(promise));

        promise.then(
            function(user) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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

export function useBackupCodeRequest(promise: $TSFixMe) {
    return {
        type: types.BACKUP_CODE_VERIFICATION_REQUEST,
        payload: promise,
    };
}

export function useBackupCodeError(error: $TSFixMe) {
    return {
        type: types.BACKUP_CODE_VERIFICATION_FAILED,
        payload: error,
    };
}

export function verifyBackupCode(values: $TSFixMe) {
    const initialUrl = User.initialUrl();
    const redirect = getQueryVar('redirectTo', initialUrl);
    if (redirect) values.redirect = redirect;
    const email = User.getEmail();
    values.email = values.email || email;
    return function(dispatch: $TSFixMe) {
        const promise = postApi('user/verify/backupCode', values);
        dispatch(useBackupCodeRequest(promise));

        promise.then(
            function(user) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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

export function saveStatusPage(data: $TSFixMe) {
    return {
        type: types.SAVE_STATUS_PAGE,
        payload: data,
    };
}

export function masterAdminExistsRequest(promise: $TSFixMe) {
    return {
        type: types.MASTER_ADMIN_EXISTS_REQUEST,
        payload: promise,
    };
}

export function masterAdminExistsError(error: $TSFixMe) {
    return {
        type: types.MASTER_ADMIN_EXISTS_FAILED,
        payload: error,
    };
}

export function masterAdminExistsSuccess(data: $TSFixMe) {
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
export function checkIfMasterAdminExists(values: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 1 arguments, but got 2.
        const promise = getApi('user/masterAdminExists', values);
        dispatch(masterAdminExistsRequest(promise));
        promise.then(
            function(response) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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

export function changeLogin(data: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        dispatch({
            type: types.CHANGE_LOGIN,
            payload: data,
        });
    };
}
