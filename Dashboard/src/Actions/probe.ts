import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/probe';
import ErrorPayload from 'CommonUI/src/payload-types/error';
import PositiveNumber from 'Common/Types/PositiveNumber';
//Array of Incidents

export const probeRequest = (promise: $TSFixMe): void => {
    return {
        type: types.PROBE_REQUEST,
        payload: promise,
    };
};

export const probeError = (error: ErrorPayload): void => {
    return {
        type: types.PROBE_FAILED,
        payload: error,
    };
};

export const probeSuccess = (probes: $TSFixMe): void => {
    return {
        type: types.PROBE_SUCCESS,
        payload: probes,
    };
};

export const resetProbe = (): void => {
    return {
        type: types.PROBE_RESET,
    };
};

// Gets project Probes
export function getProbes(
    projectId: string,
    skip: PositiveNumber,
    limit: PositiveNumber
) {
    skip = parseInt(skip);
    limit = parseInt(limit);

    return function (dispatch: Dispatch): void {
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
            function (probes): void {
                probes.data.skip = skip || 0;

                probes.data.limit = limit || 10;

                dispatch(probeSuccess(probes.data));
            },
            function (error): void {
                dispatch(probeError(error));
            }
        );
    };
}
