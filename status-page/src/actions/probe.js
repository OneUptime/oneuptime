import { getApi } from '../api';
import * as types from '../constants/probe';
import errors from '../errors';

// Fetch Project Probes list
export function getProbes(projectId, skip, limit) {
    skip = parseInt(skip);
    limit = parseInt(limit);

    return function(dispatch) {
        let promise = null;
        if (skip >= 0 && limit >= 0) {
            promise = getApi(
                `statusPage/${projectId}/probes?skip=${skip}&limit=${limit}`
            );
        } else {
            promise = getApi(`statusPage/${projectId}/probes`);
        }
        dispatch(probeRequest(promise));

        promise.then(
            function(probes) {
                probes.data.skip = skip || 0;
                probes.data.limit = limit || 10;
                dispatch(probeSuccess(probes.data));
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
                dispatch(probeError(errors(error)));
            }
        );

        return promise;
    };
}

export function probeRequest(promise) {
    return {
        type: types.PROBE_REQUEST,
        payload: promise,
    };
}

export function probeError(error) {
    return {
        type: types.PROBE_FAILED,
        payload: error,
    };
}

export function probeSuccess(probes) {
    return {
        type: types.PROBE_SUCCESS,
        payload: probes,
    };
}

export const resetProbe = () => {
    return {
        type: types.PROBE_RESET,
    };
};
