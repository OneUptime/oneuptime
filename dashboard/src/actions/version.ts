import { getApi } from '../api';
import * as types from '../constants/version';

export const getVersionRequest = (promise: $TSFixMe) => {
    return {
        type: types.GET_VERSION_REQUEST,
        payload: promise,
    };
}

export const getVersionError = (error: $TSFixMe) => {
    return {
        type: types.GET_VERSION_FAILED,
        payload: error,
    };
}

export const getVersionSuccess = (versions: $TSFixMe) => {
    return {
        type: types.GET_VERSION_SUCCESS,
        payload: versions,
    };
}

export const resetGetVersion = () => {
    return {
        type: types.GET_VERSION_RESET,
    };
};

export const getVersion = () => {
    return function (dispatch: $TSFixMe) {
        let promise = null;
        promise = getApi('version');

        dispatch(getVersionRequest(promise));

        promise.then(
            function (versions) {
                dispatch(getVersionSuccess(versions.data));
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
                dispatch(getVersionError(error));
            }
        );

        return promise;
    };
}
