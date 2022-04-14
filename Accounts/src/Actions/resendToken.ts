import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/resendToken';
import Route from 'Common/Types/api/route';
import ErrorPayload from 'CommonUI/src/payload-types/error';

export const resendTokenRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.RESENDTOKEN_REQUEST,
        payload: promise,
    };
};

export const resendTokenError: Function = (error: ErrorPayload): void => {
    return {
        type: types.RESENDTOKEN_FAILED,
        payload: error,
    };
};

export const resendTokenSuccess: Function = (data: $TSFixMe): void => {
    return {
        type: types.RESENDTOKEN_SUCCESS,
        payload: data,
    };
};

export const resendTokenReset: Function = (): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: types.RESENDTOKEN_RESET,
        });
    };
};

export const resendToken: Function = (values: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            new Route('user/resend'),
            values
        );
        dispatch(resendTokenRequest(promise));

        promise.then(
            (data): void => {
                dispatch(resendTokenSuccess(data));
            },
            (error): void => {
                dispatch(resendTokenError(error));
            }
        );
    };
};
