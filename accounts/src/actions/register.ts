import { getApi, postApi } from '../api';
import { masterAdminExistsSuccess, loginSuccess } from './login';
import * as types from '../constants/register';
import errors from '../errors';
import { IS_SAAS_SERVICE } from '../config';
import Cookies from 'universal-cookie';

// There are three possible states for our login
// process and we need actions for each of them

const cookies = new Cookies();

export function signupError(error: $TSFixMe) {
    return {
        type: types.SIGNUP_FAILED,
        payload: error,
    };
}

export function saveUserState(values: $TSFixMe) {
    return {
        type: types.SAVE_USER_STATE,
        payload: values,
    };
}

export function savePlanId(planId: $TSFixMe) {
    return {
        type: types.SAVE_PLAN_ID,
        payload: planId,
    };
}

export function saveCardState(values: $TSFixMe) {
    return {
        type: types.SAVE_CARD_STATE,
        payload: values,
    };
}

export function saveCompanyState(values: $TSFixMe) {
    return {
        type: types.SAVE_COMPANY_STATE,
        payload: values,
    };
}

export function signUpRequest(promise: $TSFixMe) {
    return {
        type: types.SIGNUP_REQUEST,
        payload: promise,
    };
}

export function signUpReset() {
    return {
        type: types.RESET_SIGNUP,
    };
}

export function signupSuccess(user: $TSFixMe) {
    return {
        type: types.SIGNUP_SUCCESS,
        payload: user,
    };
}

export const resetSignup = () => {
    return {
        type: types.RESET_SIGNUP,
    };
};

// Calls the API to register a user.
export function signupUser(values: $TSFixMe) {
    // This is basically for users redirected to oneuptime
    const redirectSource = cookies.get('source');
    if (redirectSource) {
        values.source = redirectSource;
    }
    return function(dispatch: $TSFixMe) {
        const promise = postApi(`user/signup?token=${values.token}`, values);
        dispatch(signUpRequest(promise));
        promise.then(
            function(user) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(signupSuccess(user.data));
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                if (user.data.role === 'master-admin' && !IS_SAAS_SERVICE) {
                    // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                    dispatch(loginSuccess(user.data));
                    dispatch(masterAdminExistsSuccess({ result: true }));
                }
                if (values.token) {
                    // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                    dispatch(loginSuccess(user.data));
                }
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                if (user.data.cardRegistered) {
                    // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                    dispatch(loginSuccess(user.data));
                }
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
                dispatch(signupError(errors(error)));
            }
        );
        return promise;
    };
}

//np payload for inc and dec action creators.
export const incrementStep = () => {
    return {
        type: types.SIGNUP_STEP_INC,
    };
};

//np payload for inc and dec action creators.
export const skipCardStep = () => {
    return {
        type: types.SKIP_CARD_STEP,
    };
};

export const decrementStep = () => {
    return {
        type: types.SIGNUP_STEP_DEC,
    };
};

// There are three possible states for our login
// process and we need actions for each of them

export function isUserInvitedRequest(promise: $TSFixMe) {
    return {
        type: types.IS_USER_INVITED_REQUEST,
        payload: promise,
    };
}

export function isUserInvitedReset() {
    return {
        type: types.IS_USER_INVITED_RESET,
    };
}

export function isUserInvitedError(error: $TSFixMe) {
    return {
        type: types.IS_USER_INVITED_RESET,
        payload: error,
    };
}

export function isUserInvitedSuccess(data: $TSFixMe) {
    return {
        type: types.IS_USER_INVITED_SUCCESS,
        payload: data,
    };
}

export const resetIsUserInvited = () => {
    return {
        type: types.IS_USER_INVITED_RESET,
    };
};

// Calls the API to register a user.
export function isUserInvited(values: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = postApi('user/isInvited', values);
        dispatch(isUserInvitedRequest(promise));
        promise.then(
            function(response) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(isUserInvitedSuccess(response.data));
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
                dispatch(isUserInvitedError(errors(error)));
            }
        );

        return promise;
    };
}

export function addCardRequest(promise: $TSFixMe) {
    return {
        type: types.ADD_CARD_REQUEST,
        payload: promise,
    };
}

export function addCardFailed(error: $TSFixMe) {
    return {
        type: types.ADD_CARD_FAILED,
        payload: error,
    };
}

export function addCardSuccess(card: $TSFixMe) {
    return {
        type: types.ADD_CARD_SUCCESS,
        payload: card,
    };
}

export function addCard(data: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = postApi('stripe/checkCard', data);

        dispatch(addCardRequest(promise));

        promise.then(
            function(card) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(addCardSuccess(card.data));
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
                dispatch(addCardFailed(error));
            }
        );
        return promise;
    };
}

export function getEmailSuccess(email: $TSFixMe) {
    return {
        type: types.GET_EMAIL_FROM_TOKEN,
        payload: email,
    };
}

export function getEmailFromToken(token: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = getApi(`user/${token}/email`);
        promise.then(
            function(response) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(getEmailSuccess(response.data));
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
                dispatch(getEmailSuccess(error));
            }
        );
    };
}
