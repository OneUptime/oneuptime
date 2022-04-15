import BackendAPI from 'CommonUI/src/utils/api/backend';
import HelmAPI from 'CommonUI/src/utils/api/helm';
import APiDocsAPI from 'CommonUI/src/utils/api/ApiDocs';
import DashboardAPI from 'CommonUI/src/utils/api/dashboard';

import * as types from '../constants/version';
import { Dispatch } from 'redux';
import Route from 'Common/Types/api/route';

export const getVersionRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.GET_VERSION_REQUEST,
        payload: promise,
    };
};

export const getVersionError: Function = (error: $TSFixMe): void => {
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
        let backendPromise: $TSFixMe = null;
        let helmChartPromise: $TSFixMe = null;
        let docsPromise: $TSFixMe = null;
        let dashboardPromise: $TSFixMe = null;

        backendPromise = BackendAPI.get(new Route('/version'));
        helmChartPromise = HelmAPI.get(new Route('/version'));
        docsPromise = APiDocsAPI.get(new Route('/version'));
        dashboardPromise = DashboardAPI.get(new Route('/version'));

        promise = Promise.all([
            backendPromise,
            helmChartPromise,
            docsPromise,
            dashboardPromise,
        ]);

        dispatch(getVersionRequest(promise));

        promise.then(
            (versions: $TSFixMe): void => {
                let versionsObject: $TSFixMe = {};
                versions.forEach((version: $TSFixMe) => {
                    versionsObject = { ...versionsObject, ...version.data };
                });

                dispatch(getVersionSuccess(versionsObject));
            },
            (error: $TSFixMe): void => {
                dispatch(getVersionError(error));
            }
        );

        return promise;
    };
};
