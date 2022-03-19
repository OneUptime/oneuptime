import { getApi, deleteApi, postApi, putApi } from '../api';
import * as types from '../constants/probe';
import errors from '../errors';

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
export const getProbes = (skip = 0, limit = 10) => {
    skip = parseInt(skip);

    limit = parseInt(limit);

    return function (dispatch: $TSFixMe) {
        let promise = null;

        promise = getApi(`probe/?skip=${skip}&limit=${limit}`);
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
                dispatch(probeError(errors(error)));
            }
        );
    };
};

//Delete project
export const deleteProbeRequest = () => {
    return {
        type: types.DELETE_PROBE_REQUEST,
    };
};

export const deleteProbeReset = () => {
    return {
        type: types.DELETE_PROBE_RESET,
    };
};

export const deleteProbeSuccess = (probeId: $TSFixMe) => {
    return {
        type: types.DELETE_PROBE_SUCCESS,
        payload: probeId,
    };
};

export const deleteProbeError = (error: $TSFixMe) => {
    return {
        type: types.DELETE_PROBE_FAILED,
        payload: error,
    };
};

// Calls the API to delete a probe
export const deleteProbe =
    (probeId: $TSFixMe) => async (dispatch: $TSFixMe) => {
        dispatch(deleteProbeRequest());

        try {
            const response = await deleteApi(`probe/${probeId}`);
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
            dispatch(deleteProbeError(errors(errorMsg)));
        }
    };

//Delete project
export const addProbeRequest = () => {
    return {
        type: types.ADD_PROBE_REQUEST,
    };
};

export const addProbeReset = () => {
    return {
        type: types.ADD_PROBE_RESET,
    };
};

export const addProbeSuccess = (probeId: $TSFixMe) => {
    return {
        type: types.ADD_PROBE_SUCCESS,
        payload: probeId,
    };
};

export const addProbeError = (error: $TSFixMe) => {
    return {
        type: types.ADD_PROBE_FAILED,
        payload: error,
    };
};

export const resetAddProbe = () => {
    return function (dispatch: $TSFixMe) {
        dispatch(addProbeReset());
    };
};

// Calls the API to add a probe
export const addProbe =
    (probeKey: $TSFixMe, probeName: $TSFixMe) => async (dispatch: $TSFixMe) => {
        dispatch(addProbeRequest());

        try {
            const response = await postApi('probe/', { probeKey, probeName });

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
            dispatch(addProbeError(errors(errorMsg)));
            return 'error';
        }
    };

//Update Probe
export const updateProbeRequest = () => {
    return {
        type: types.UPDATE_PROBE_REQUEST,
    };
};

export const updateProbeReset = () => {
    return {
        type: types.UPDATE_PROBE_RESET,
    };
};

export const updateProbeSuccess = (value: $TSFixMe) => {
    return {
        type: types.UPDATE_PROBE_SUCCESS,
        payload: value,
    };
};

export const updateProbeError = (error: $TSFixMe) => {
    return {
        type: types.UPDATE_PROBE_FAILED,
        payload: error,
    };
};

// Calls the API to update a probe
export const updateProbe = (values: $TSFixMe) => async (dispatch: $TSFixMe) => {
    dispatch(updateProbeRequest());

    try {
        const data = new FormData();
        data.append('probeImage', values.probeImage);
        data.append('id', values.id);

        const response = await putApi('probe/update/image', data);

        const resp = response.data;
        if (Object.keys(resp).length > 0) {
            dispatch(updateProbeSuccess(resp));
            return 'ok';
        } else {
            dispatch(addProbeError(errors('Network Error')));
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
        dispatch(addProbeError(errors(errorMsg)));
        return 'error';
    }
};
