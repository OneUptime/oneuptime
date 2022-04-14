import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import { masterAdminExistsSuccess, loginSuccess } from './login';
import * as types from '../constants/register';
import Route from 'Common/Types/api/route';
import { IS_SAAS_SERVICE } from '../config';
import Cookies from 'universal-cookie';
import ErrorPayload from 'CommonUI/src/payload-types/error';

// There are three possible states for our login
// process and we need actions for each of them

const cookies: $TSFixMe = new Cookies();

export const signupError: Function = (error: ErrorPayload): void => {
    return {
        type: types.SIGNUP_FAILED,
        payload: error,
    };
};

export const saveUserState: Function = (values: $TSFixMe): void => {
    return {
        type: types.SAVE_USER_STATE,
        payload: values,
    };
};

export const savePlanId: Function = (planId: $TSFixMe): void => {
    return {
        type: types.SAVE_PLAN_ID,
        payload: planId,
    };
};

export const saveCardState: Function = (values: $TSFixMe): void => {
    return {
        type: types.SAVE_CARD_STATE,
        payload: values,
    };
};

export const saveCompanyState: Function = (values: $TSFixMe): void => {
    return {
        type: types.SAVE_COMPANY_STATE,
        payload: values,
    };
};

export const signUpRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.SIGNUP_REQUEST,
        payload: promise,
    };
};

export const signUpReset: Function = (): void => {
    return {
        type: types.RESET_SIGNUP,
    };
};

export const signupSuccess: Function = (user: $TSFixMe): void => {
    return {
        type: types.SIGNUP_SUCCESS,
        payload: user,
    };
};

export const resetSignup: Function = (): void => {
    return {
        type: types.RESET_SIGNUP,
    };
};

// Calls the API to register a user.
export const signupUser: Function = (values: $TSFixMe): void => {
    // This is basically for users redirected to oneuptime
    const redirectSource: $TSFixMe = cookies.get('source');
    if (redirectSource) {
        values.source = redirectSource;
    }
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            `user/signup?token=${values.token}`,
            values
        );
        dispatch(signUpRequest(promise));
        promise.then(
            (user): void => {
                dispatch(signupSuccess(user.data));

                if (user.data.role === 'master-admin' && !IS_SAAS_SERVICE) {
                    dispatch(loginSuccess(user.data));
                    dispatch(masterAdminExistsSuccess({ result: true }));
                }
                if (values.token) {
                    dispatch(loginSuccess(user.data));
                }

                if (user.data.cardRegistered) {
                    dispatch(loginSuccess(user.data));
                }
            },
            (error): void => {
                dispatch(signupError(error));
            }
        );
        return promise;
    };
};

//np payload for inc and dec action creators.
export const incrementStep: Function = (): void => {
    return {
        type: types.SIGNUP_STEP_INC,
    };
};

//np payload for inc and dec action creators.
export const skipCardStep: Function = (): void => {
    return {
        type: types.SKIP_CARD_STEP,
    };
};

export const decrementStep: Function = (): void => {
    return {
        type: types.SIGNUP_STEP_DEC,
    };
};

// There are three possible states for our login
// process and we need actions for each of them

export const isUserInvitedRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.IS_USER_INVITED_REQUEST,
        payload: promise,
    };
};

export const isUserInvitedReset: Function = (): void => {
    return {
        type: types.IS_USER_INVITED_RESET,
    };
};

export const isUserInvitedError: Function = (error: ErrorPayload): void => {
    return {
        type: types.IS_USER_INVITED_RESET,
        payload: error,
    };
};

export const isUserInvitedSuccess: Function = (data: $TSFixMe): void => {
    return {
        type: types.IS_USER_INVITED_SUCCESS,
        payload: data,
    };
};

export const resetIsUserInvited: Function = (): void => {
    return {
        type: types.IS_USER_INVITED_RESET,
    };
};

// Calls the API to register a user.
export const isUserInvited: Function = (values: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            new Route('user/isInvited'),
            values
        );
        dispatch(isUserInvitedRequest(promise));
        promise.then(
            (response): void => {
                dispatch(isUserInvitedSuccess(response.data));
            },
            (error): void => {
                dispatch(isUserInvitedError(error));
            }
        );

        return promise;
    };
};

export const addCardRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.ADD_CARD_REQUEST,
        payload: promise,
    };
};

export const addCardFailed: Function = (error: ErrorPayload): void => {
    return {
        type: types.ADD_CARD_FAILED,
        payload: error,
    };
};

export const addCardSuccess: Function = (card: $TSFixMe): void => {
    return {
        type: types.ADD_CARD_SUCCESS,
        payload: card,
    };
};

export const addCard: Function = (data: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            new Route('stripe/checkCard'),
            data
        );

        dispatch(addCardRequest(promise));

        promise.then(
            (card): void => {
                dispatch(addCardSuccess(card.data));
            },
            (error): void => {
                dispatch(addCardFailed(error));
            }
        );
        return promise;
    };
};

export const getEmailSuccess: Function = (email: $TSFixMe): void => {
    return {
        type: types.GET_EMAIL_FROM_TOKEN,
        payload: email,
    };
};

export const getEmailFromToken: Function = (token: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(`user/${token}/email`);
        promise.then(
            (response): void => {
                dispatch(getEmailSuccess(response.data));
            },
            (error): void => {
                dispatch(getEmailSuccess(error));
            }
        );
    };
};
