import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import * as types from '../constants/probe';
import ErrorPayload from 'CommonUI/src/payload-types/error';
import PositiveNumber from 'Common/Types/PositiveNumber';
//Array of Incidents

export const probeRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.PROBE_REQUEST,
        payload: promise,
    };
};

export const probeError: Function = (error: ErrorPayload): void => {
    return {
        type: types.PROBE_FAILED,
        payload: error,
    };
};

export const probeSuccess: Function = (probes: $TSFixMe): void => {
    return {
        type: types.PROBE_SUCCESS,
        payload: probes,
    };
};

export const resetProbe: Function = (): void => {
    return {
        type: types.PROBE_RESET,
    };
};

// Gets project Probes
export function getProbes(
    projectId: ObjectID,
    skip: PositiveNumber,
    limit: PositiveNumber
): void {
    skip = parseInt(skip);
    limit = parseInt(limit);

    return function (dispatch: Dispatch): void {
        let promise: $TSFixMe = null;
        if (skip >= 0 && limit >= 0) {
            promise = BackendAPI.get(
                `probe/${projectId}/probes?skip=${skip}&limit=${limit}`
            );
        } else {
            promise = BackendAPI.get(`probe/${projectId}/probes`);
        }
        dispatch(probeRequest(promise));

        promise.then(
            (probes: $TSFixMe): void => {
                probes.data.skip = skip || 0;

                probes.data.limit = limit || 10;

                dispatch(probeSuccess(probes.data));
            },
            (error: $TSFixMe): void => {
                dispatch(probeError(error));
            }
        );
    };
}
