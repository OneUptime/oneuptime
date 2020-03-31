import { postApi } from '../api';
import { masterAdminExistsSuccess, loginSuccess } from './login';
import * as types from '../constants/register';
import errors from '../errors';
import { IS_SAAS_SERVICE } from '../config';
// There are three possible states for our login
// process and we need actions for each of them

export function signupError(error) {
    return {
        type: types.SIGNUP_FAILED,
        payload: error,
    };
}

export function saveUserState(values) {
    return {
        type: types.SAVE_USER_STATE,
        payload: values,
    };
}

export function savePlanId(planId) {
    return {
        type: types.SAVE_PLAN_ID,
        payload: planId,
    };
}

export function saveCardState(values) {
    return {
        type: types.SAVE_CARD_STATE,
        payload: values,
    };
}

export function saveCompanyState(values) {
    return {
        type: types.SAVE_COMPANY_STATE,
        payload: values,
    };
}

export function signUpRequest(promise) {
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

export function signupSuccess(user) {
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
export function signupUser(values) {
    return function(dispatch) {
        const promise = postApi('user/signup', values);
        dispatch(signUpRequest(promise));
        promise.then(
            function(user) {
                dispatch(signupSuccess(user.data));
                if (user.data.role === 'master-admin' && !IS_SAAS_SERVICE) {
                    dispatch(loginSuccess(user.data));
                    dispatch(masterAdminExistsSuccess({ result: true }));
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

export function isUserInvitedRequest(promise) {
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

export function isUserInvitedError(error) {
    return {
        type: types.IS_USER_INVITED_RESET,
        payload: error,
    };
}

export function isUserInvitedSuccess(data) {
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
export function isUserInvited(values) {
    return function(dispatch) {
        const promise = postApi('user/isInvited', values);
        dispatch(isUserInvitedRequest(promise));
        promise.then(
            function(response) {
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

export function addCardRequest(promise) {
    return {
        type: types.ADD_CARD_REQUEST,
        payload: promise,
    };
}

export function addCardFailed(error) {
    return {
        type: types.ADD_CARD_FAILED,
        payload: error,
    };
}

export function addCardSuccess(card) {
    return {
        type: types.ADD_CARD_SUCCESS,
        payload: card,
    };
}

export function addCard(data) {
    return function(dispatch) {
        const promise = postApi('stripe/checkCard', data);

        dispatch(addCardRequest(promise));

        promise.then(
            function(card) {
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
