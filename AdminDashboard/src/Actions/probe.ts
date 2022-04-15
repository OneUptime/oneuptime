import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/probe';
import Route from 'Common/Types/api/route';
//Array of Incidents

export const probeRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.PROBE_REQUEST,
        payload: promise,
    };
};

export const probeError: Function = (error: $TSFixMe): void => {
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
export const getProbes: Function = (skip = 0, limit = 10): void => {
    skip = parseInt(skip);

    limit = parseInt(limit);

    return function (dispatch: Dispatch): void {
        let promise: $TSFixMe = null;

        promise = BackendAPI.get(`probe/?skip=${skip}&limit=${limit}`);
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
};

//Delete project
export const deleteProbeRequest: Function = (): void => {
    return {
        type: types.DELETE_PROBE_REQUEST,
    };
};

export const deleteProbeReset: Function = (): void => {
    return {
        type: types.DELETE_PROBE_RESET,
    };
};

export const deleteProbeSuccess: Function = (probeId: $TSFixMe): void => {
    return {
        type: types.DELETE_PROBE_SUCCESS,
        payload: probeId,
    };
};

export const deleteProbeError: Function = (error: $TSFixMe): void => {
    return {
        type: types.DELETE_PROBE_FAILED,
        payload: error,
    };
};

// Calls the API to delete a probe
export const deleteProbe: $TSFixMe = (probeId: $TSFixMe) => {
    return async (dispatch: Dispatch) => {
        dispatch(deleteProbeRequest());

        try {
            const response: $TSFixMe = await delete `probe/${probeId}`;
            dispatch(deleteProbeSuccess(probeId));
            return response;
        } catch (error) {
            let errorMsg: $TSFixMe;
            if (error && error.response && error.response.data) {
                errorMsg = error.response.data;
            }
            if (error && error.data) {
                errorMsg = error.data;
            }
            if (error && error.message) {
                errorMsg = error.message;
            } else {
                errorMsg = 'Network Error';
            }
            dispatch(deleteProbeError(errorMsg));
        }
    };
};

//Delete project
export const addProbeRequest: Function = (): void => {
    return {
        type: types.ADD_PROBE_REQUEST,
    };
};

export const addProbeReset: Function = (): void => {
    return {
        type: types.ADD_PROBE_RESET,
    };
};

export const addProbeSuccess: Function = (probeId: $TSFixMe): void => {
    return {
        type: types.ADD_PROBE_SUCCESS,
        payload: probeId,
    };
};

export const addProbeError: Function = (error: $TSFixMe): void => {
    return {
        type: types.ADD_PROBE_FAILED,
        payload: error,
    };
};

export const resetAddProbe: Function = (): void => {
    return function (dispatch: Dispatch): void {
        dispatch(addProbeReset());
    };
};

// Calls the API to add a probe
export const addProbe: $TSFixMe = (probeKey: $TSFixMe, probeName: $TSFixMe) => {
    return async (dispatch: Dispatch) => {
        dispatch(addProbeRequest());

        try {
            const response: $TSFixMe = await BackendAPI.post(
                new Route('probe/'),
                {
                    probeKey,
                    probeName,
                }
            );

            const data: $TSFixMe = response.data;
            dispatch(addProbeSuccess(data));
            return 'ok';
        } catch (error) {
            let errorMsg: $TSFixMe;
            if (error && error.response && error.response.data) {
                errorMsg = error.response.data;
            }
            if (error && error.data) {
                errorMsg = error.data;
            }
            if (error && error.message) {
                errorMsg = error.message;
            } else {
                errorMsg = 'Network Error';
            }
            dispatch(addProbeError(errorMsg));
            return 'error';
        }
    };
};

//Update Probe
export const updateProbeRequest: Function = (): void => {
    return {
        type: types.UPDATE_PROBE_REQUEST,
    };
};

export const updateProbeReset: Function = (): void => {
    return {
        type: types.UPDATE_PROBE_RESET,
    };
};

export const updateProbeSuccess: Function = (value: $TSFixMe): void => {
    return {
        type: types.UPDATE_PROBE_SUCCESS,
        payload: value,
    };
};

export const updateProbeError: Function = (error: $TSFixMe): void => {
    return {
        type: types.UPDATE_PROBE_FAILED,
        payload: error,
    };
};

// Calls the API to update a probe
export const updateProbe: $TSFixMe = (values: $TSFixMe) => {
    return async (dispatch: Dispatch): void => {
        dispatch(updateProbeRequest());

        try {
            const data: $TSFixMe = new FormData();
            data.append('probeImage', values.probeImage);
            data.append('id', values.id);

            const response: $TSFixMe = await BackendAPI.put(
                'probe/update/image',
                data
            );

            const resp: $TSFixMe = response.data;
            if (Object.keys(resp).length > 0) {
                dispatch(updateProbeSuccess(resp));
                return 'ok';
            } else {
                dispatch(addProbeError('Network Error'));
            }
        } catch (error) {
            let errorMsg: $TSFixMe;
            if (error && error.response && error.response.data) {
                errorMsg = error.response.data;
            }
            if (error && error.data) {
                errorMsg = error.data;
            }
            if (error && error.message) {
                errorMsg = error.message;
            } else {
                errorMsg = 'Network Error';
            }
            dispatch(addProbeError(errorMsg));
            return 'error';
        }
    };
};
