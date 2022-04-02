import BackendAPI from 'common-ui/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/probe';
import ErrorPayload from 'common-ui/src/payload-types/error';
import PositiveNumber from 'common/types/positive-number';
// Fetch Project Probes list
export function getProbes(
    projectId: $TSFixMe,
    skip: PositiveNumber,
    limit: PositiveNumber
) {
    skip = parseInt(skip);
    limit = parseInt(limit);

    return function (dispatch: Dispatch) {
        let promise = null;
        if (skip >= 0 && limit >= 0) {
            promise = BackendAPI.get(
                `status-page/${projectId}/probes?skip=${skip}&limit=${limit}`
            );
        } else {
            promise = BackendAPI.get(`status-page/${projectId}/probes`);
        }
        dispatch(probeRequest(promise));

        promise.then(
            function (probes) {
                probes.data.skip = skip || 0;

                probes.data.limit = limit || 10;

                dispatch(probeSuccess(probes.data));
            },
            function (error) {
                dispatch(probeError(error));
            }
        );

        return promise;
    };
}

export const probeRequest = (promise: $TSFixMe) => {
    return {
        type: types.PROBE_REQUEST,
        payload: promise,
    };
};

export const probeError = (error: ErrorPayload) => {
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
