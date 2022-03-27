import BackendAPI from '../api';
import { Dispatch } from 'redux';
import * as types from '../constants/probe';

//Array of Incidents

export const probeRequest = (promise: $TSFixMe) => {
    return {
        type: types.PROBE_REQUEST,
        payload: promise,
    };
};

export const probeError = (error: $TSFixMe) => {
    return {
        type: types.PROBE_FAILED,
        payload: error,
    };
};

export const probeSuccess = (probes: $TSFixMe) => {
    return {
        type: types.PROBE_SUCCESS,
        payload: probes,
    };
};

export const resetProbe = () => {
    return {
        type: types.PROBE_RESET,
    };
};

// Gets project Probes
export function getProbes(
    projectId: $TSFixMe,
    skip: $TSFixMe,
    limit: $TSFixMe
) {
    skip = parseInt(skip);
    limit = parseInt(limit);

    return function (dispatch: Dispatch) {
        let promise = null;
        if (skip >= 0 && limit >= 0) {
            promise = BackendAPI.get(
                `probe/${projectId}/probes?skip=${skip}&limit=${limit}`
            );
        } else {
            promise = BackendAPI.get(`probe/${projectId}/probes`);
        }
        dispatch(probeRequest(promise));

        promise.then(
            function (probes) {
                probes.data.skip = skip || 0;

                probes.data.limit = limit || 10;

                dispatch(probeSuccess(probes.data));
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
                dispatch(probeError(error));
            }
        );
    };
}
