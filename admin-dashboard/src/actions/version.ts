import { getApi, getApiDocs, getApiHelm, getApiDashboard } from '../api';
import * as types from '../constants/version';

export function getVersionRequest(promise: $TSFixMe) {
    return {
        type: types.GET_VERSION_REQUEST,
        payload: promise,
    };
}

export function getVersionError(error: $TSFixMe) {
    return {
        type: types.GET_VERSION_FAILED,
        payload: error,
    };
}

export function getVersionSuccess(versions: $TSFixMe) {
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
    return function(dispatch: $TSFixMe) {
        let promise = null;
        let backendPromise = null;
        let helmChartPromise = null;
        let docsPromise = null;
        let dashboardPromise = null;

        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
        backendPromise = getApi('version');
        helmChartPromise = getApiHelm('version');
        docsPromise = getApiDocs('version');
        dashboardPromise = getApiDashboard('version');

        promise = Promise.all([
            backendPromise,
            helmChartPromise,
            docsPromise,
            dashboardPromise,
        ]);

        dispatch(getVersionRequest(promise));

        promise.then(
            function(versions) {
                let versionsObject = {};
                versions.forEach(version => {
                    // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                    versionsObject = { ...versionsObject, ...version.data };
                });

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
