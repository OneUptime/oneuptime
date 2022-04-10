import BackendAPI from 'Common-ui/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/version';
import Route from 'Common/Types/api/route';
import ErrorPayload from 'Common-ui/src/payload-types/error';
export const getVersionRequest = (promise: $TSFixMe) => {
    return {
        type: types.GET_VERSION_REQUEST,
        payload: promise,
    };
};

export const getVersionError = (error: ErrorPayload) => {
    return {
        type: types.GET_VERSION_FAILED,
        payload: error,
    };
};

export const getVersionSuccess = (versions: $TSFixMe) => {
    return {
        type: types.GET_VERSION_SUCCESS,
        payload: versions,
    };
};

export const resetGetVersion = () => {
    return {
        type: types.GET_VERSION_RESET,
    };
};

export const getVersion = () => {
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
