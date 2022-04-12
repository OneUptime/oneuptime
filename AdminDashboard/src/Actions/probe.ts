import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/probe';
import Route from 'Common/Types/api/route';
//Array of Incidents

export const probeRequest = (promise: $TSFixMe): void => {
    return {
        type: types.PROBE_REQUEST,
        payload: promise,
    };
};

export const probeError = (error: $TSFixMe): void => {
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
export const getProbes = (skip = 0, limit = 10): void => {
    skip = parseInt(skip);

    limit = parseInt(limit);

    return function (dispatch: Dispatch): void {
        let promise = null;

        promise = BackendAPI.get(`probe/?skip=${skip}&limit=${limit}`);
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
};

//Delete project
export const deleteProbeRequest = (): void => {
    return {
        type: types.DELETE_PROBE_REQUEST,
    };
};

export const deleteProbeReset = (): void => {
    return {
        type: types.DELETE_PROBE_RESET,
    };
};

export const deleteProbeSuccess = (probeId: $TSFixMe): void => {
    return {
        type: types.DELETE_PROBE_SUCCESS,
        payload: probeId,
    };
};

export const deleteProbeError = (error: $TSFixMe): void => {
    return {
        type: types.DELETE_PROBE_FAILED,
        payload: error,
    };
};

// Calls the API to delete a probe
export const deleteProbe =
    (probeId: $TSFixMe) => async (dispatch: Dispatch) => {
        dispatch(deleteProbeRequest());

        try {
            const response = await delete `probe/${probeId}`;
            dispatch(deleteProbeSuccess(probeId));
            return response;
        } catch (error) {
            let errorMsg;
            if (error && error.response && error.response.data)
                errorMsg = error.response.data;
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

//Delete project
export const addProbeRequest = (): void => {
    return {
        type: types.ADD_PROBE_REQUEST,
    };
};

export const addProbeReset = (): void => {
    return {
        type: types.ADD_PROBE_RESET,
    };
};

export const addProbeSuccess = (probeId: $TSFixMe): void => {
    return {
        type: types.ADD_PROBE_SUCCESS,
        payload: probeId,
    };
};

export const addProbeError = (error: $TSFixMe): void => {
    return {
        type: types.ADD_PROBE_FAILED,
        payload: error,
    };
};

export const resetAddProbe = (): void => {
    return function (dispatch: Dispatch): void {
        dispatch(addProbeReset());
    };
};

// Calls the API to add a probe
export const addProbe =
    (probeKey: $TSFixMe, probeName: $TSFixMe) => async (dispatch: Dispatch) => {
        dispatch(addProbeRequest());

        try {
            const response = await BackendAPI.post(new Route('probe/'), {
                probeKey,
                probeName,
            });

            const data = response.data;
            dispatch(addProbeSuccess(data));
            return 'ok';
        } catch (error) {
            let errorMsg;
            if (error && error.response && error.response.data)
                errorMsg = error.response.data;
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

//Update Probe
export const updateProbeRequest = (): void => {
    return {
        type: types.UPDATE_PROBE_REQUEST,
    };
};

export const updateProbeReset = (): void => {
    return {
        type: types.UPDATE_PROBE_RESET,
    };
};

export const updateProbeSuccess = (value: $TSFixMe): void => {
    return {
        type: types.UPDATE_PROBE_SUCCESS,
        payload: value,
    };
};

export const updateProbeError = (error: $TSFixMe): void => {
    return {
        type: types.UPDATE_PROBE_FAILED,
        payload: error,
    };
};

// Calls the API to update a probe
export const updateProbe =
    (values: $TSFixMe) =>
    async (dispatch: Dispatch): void => {
        dispatch(updateProbeRequest());

        try {
            const data = new FormData();
            data.append('probeImage', values.probeImage);
            data.append('id', values.id);

            const response = await BackendAPI.put('probe/update/image', data);

            const resp = response.data;
            if (Object.keys(resp).length > 0) {
                dispatch(updateProbeSuccess(resp));
                return 'ok';
            } else {
                dispatch(addProbeError('Network Error'));
            }
        } catch (error) {
            let errorMsg;
            if (error && error.response && error.response.data)
                errorMsg = error.response.data;
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
