import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/resendToken';
import Route from 'Common/Types/api/route';
import ErrorPayload from 'CommonUI/src/payload-types/error';

export const resendTokenRequest = (promise: $TSFixMe): void => {
    return {
        type: types.RESENDTOKEN_REQUEST,
        payload: promise,
    };
};

export const resendTokenError = (error: ErrorPayload): void => {
    return {
        type: types.RESENDTOKEN_FAILED,
        payload: error,
    };
};

export const resendTokenSuccess = (data: $TSFixMe): void => {
    return {
        type: types.RESENDTOKEN_SUCCESS,
        payload: data,
    };
};

export const resendTokenReset = (): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: types.RESENDTOKEN_RESET,
        });
    };
};

export const resendToken = (values: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(new Route('user/resend'), values);
        dispatch(resendTokenRequest(promise));

        promise.then(
            function (data): void {
                dispatch(resendTokenSuccess(data));
            },
            function (error): void {
                dispatch(resendTokenError(error));
            }
        );
    };
};
