import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/version';
import Route from 'Common/Types/api/route';
import ErrorPayload from 'CommonUI/src/payload-types/error';
export const getVersionRequest = (promise: $TSFixMe): void => {
    return {
        type: types.GET_VERSION_REQUEST,
        payload: promise,
    };
};

export const getVersionError = (error: ErrorPayload): void => {
    return {
        type: types.GET_VERSION_FAILED,
        payload: error,
    };
};

export const getVersionSuccess = (versions: $TSFixMe): void => {
    return {
        type: types.GET_VERSION_SUCCESS,
        payload: versions,
    };
};

export const resetGetVersion = (): void => {
    return {
        type: types.GET_VERSION_RESET,
    };
};

export const getVersion = (): void => {
    return function (dispatch: Dispatch) {
        let promise = null;
        promise = BackendAPI.get(new Route('version'));

        dispatch(getVersionRequest(promise));

        promise.then(
            function (versions) {
                dispatch(getVersionSuccess(versions.data));
            },
            function (error) {
                dispatch(getVersionError(error));
            }
        );

        return promise;
    };
};
