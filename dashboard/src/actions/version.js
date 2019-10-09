import {
    getApi
} from '../api';
import * as types from '../constants/version';

export function getVersionRequest(promise) {
    return {
        type: types.GET_VERSION_REQUEST,
        payload: promise
    };
}

export function getVersionError(error) {
    return {
        type: types.GET_VERSION_FAILED,
        payload: error
    };
}

export function getVersionSuccess(versions) {
    return {
        type: types.GET_VERSION_SUCCESS,
        payload: versions
    };
}

export const resetGetVersion = () => {
    return {
        type: types.GET_VERSION_RESET,
    };
};

export function getVersion() {
    return function (dispatch) {
        var promise = null;
        promise = getApi('version');

        dispatch(getVersionRequest(promise));

        promise.then(function (versions) {
            dispatch(getVersionSuccess(versions.data));
        }, function (error) {
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            if (error && error.message) {
                error = error.message;
            }
            else {
                error = 'Network Error';
            }
            dispatch(getVersionError(error));
        });

        return promise;
    };
}