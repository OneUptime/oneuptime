import BackendAPI from '../utils/backendApi';
import { Dispatch } from 'redux';
import * as types from '../constants/resendToken';
import errors from '../errors';

export const resendTokenRequest = (promise: $TSFixMe) => {
    return {
        type: types.RESENDTOKEN_REQUEST,
        payload: promise,
    };
};

export const resendTokenError = (error: $TSFixMe) => {
    return {
        type: types.RESENDTOKEN_FAILED,
        payload: error,
    };
};

export const resendTokenSuccess = (data: $TSFixMe) => {
    return {
        type: types.RESENDTOKEN_SUCCESS,
        payload: data,
    };
};

export const resendTokenReset = () => {
    return function (dispatch: Dispatch) {
        dispatch({
            type: types.RESENDTOKEN_RESET,
        });
    };
};

export const resendToken = (values: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.post('user/resend', values);
        dispatch(resendTokenRequest(promise));

        promise.then(
            function (data) {
                dispatch(resendTokenSuccess(data));
            },
            function (error) {
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
                dispatch(resendTokenError(errors(error)));
            }
        );
    };
};
