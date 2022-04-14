import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/version';
import Route from 'Common/Types/api/route';
import ErrorPayload from 'CommonUI/src/payload-types/error';
export const getVersionRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.GET_VERSION_REQUEST,
        payload: promise,
    };
};

export const getVersionError: Function = (error: ErrorPayload): void => {
    return {
        type: types.GET_VERSION_FAILED,
        payload: error,
    };
};

export const getVersionSuccess: Function = (versions: $TSFixMe): void => {
    return {
        type: types.GET_VERSION_SUCCESS,
        payload: versions,
    };
};

export const resetGetVersion: Function = (): void => {
    return {
        type: types.GET_VERSION_RESET,
    };
};

export const getVersion: Function = (): void => {
    return function (dispatch: Dispatch): void {
        let promise: $TSFixMe = null;
        promise = BackendAPI.get(new Route('version'));

        dispatch(getVersionRequest(promise));

        promise.then(
            (versions): void => {
                dispatch(getVersionSuccess(versions.data));
            },
            (error): void => {
                dispatch(getVersionError(error));
            }
        );

        return promise;
    };
};
