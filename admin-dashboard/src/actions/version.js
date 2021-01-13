import {
    getApi,
    getApiDocs,
    getApiHelm,
    getApiDashboard,
    getApiProbe,
} from '../api';
import * as types from '../constants/version';

export function getVersionRequest(promise) {
    return {
        type: types.GET_VERSION_REQUEST,
        payload: promise,
    };
}

export function getVersionError(error) {
    return {
        type: types.GET_VERSION_FAILED,
        payload: error,
    };
}

export function getVersionSuccess(versions) {
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

export function getVersion() {
    return function(dispatch) {
        let promise = null;
        let backendPromise = null;
        let helmChartPromise = null;
        let docsPromise = null;
        let dashboardPromise = null;
        let probePromise = null;

        backendPromise = getApi('version');
        helmChartPromise = getApiHelm('version');
        docsPromise = getApiDocs('version');
        dashboardPromise = getApiDashboard('version');
        probePromise = getApiProbe('version');

        promise = Promise.all([
            backendPromise,
            helmChartPromise,
            docsPromise,
            dashboardPromise,
            probePromise,
        ]);

        dispatch(getVersionRequest(promise));

        promise.then(
            function(versions) {
                let versionsObject = {};
                versions.forEach(version => {
                    versionsObject = { ...versionsObject, ...version.data };
                });
                console.log('versionsObject', versionsObject);

                dispatch(getVersionSuccess(versionsObject));
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
                dispatch(getVersionError(error));
            }
        );

        return promise;
    };
}
