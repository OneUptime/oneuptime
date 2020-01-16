import {getApi, deleteApi, postApi} from '../api';
import * as types from '../constants/probe';
import errors from '../errors';

//Array of Incidents

export function probeRequest(promise) {
    return {
        type: types.PROBE_REQUEST,
        payload: promise
    };
}

export function probeError(error) {
    return {
        type: types.PROBE_FAILED,
        payload: error
    };
}

export function probeSuccess(probes) {
    return {
        type: types.PROBE_SUCCESS,
        payload: probes
    };
}

export const resetProbe = () => {
    return {
        type: types.PROBE_RESET,
    };
};

// Gets project Probes
export function getProbes(skip = 0, limit = 10) {
    skip = parseInt(skip);
    limit = parseInt(limit);

    return function (dispatch) {
        var promise = null;
            promise = getApi(`probe/?skip=${skip}&limit=${limit}`);
        dispatch(probeRequest(promise));

        promise.then(function (probes) {
            probes.data.skip = skip || 0;
            probes.data.limit = limit || 10;
            dispatch(probeSuccess(probes.data));
        }, function (error) {
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            if (error && error.message) {
                error = error.message;
            }
            else {
                error = 'Network Error';
            }
            dispatch(probeError(errors(error)));
        });
    };
}

//Delete project
export const deleteProbeRequest = () => {
	return {
		type: types.DELETE_PROBE_REQUEST,
	};
}

export const deleteProbeReset = () => {
	return {
		type: types.DELETE_PROBE_RESET,
	};
}

export const deleteProbeSuccess = probeId => {
	return {
		type: types.DELETE_PROBE_SUCCESS,
		payload: probeId
	};
}

export const deleteProbeError = error => {
	return {
		type: types.DELETE_PROBE_FAILED,
		payload: error
	};
}

// Calls the API to delete a probe
export const deleteProbe = probeId => async (dispatch) => {

	dispatch(deleteProbeRequest());

	try{
		const response = await deleteApi(`probe/${probeId}`);
		dispatch(deleteProbeSuccess(probeId));
		return response;
	}catch(error){
		let errorMsg;
		if (error && error.response && error.response.data)
			errorMsg = error.response.data;
		if (error && error.data) {
			errorMsg = error.data;
		}
		if(error && error.message){
			errorMsg = error.message;
		}
		else{
			errorMsg = 'Network Error';
		}
		dispatch(deleteProbeError(errors(errorMsg)));
	}
}

//Delete project
export const addProbeRequest = () => {
	return {
		type: types.ADD_PROBE_REQUEST,
	};
}

export const addProbeReset = () => {
	return {
		type: types.ADD_PROBE_RESET,
	};
}

export const addProbeSuccess = probeId => {
	return {
		type: types.ADD_PROBE_SUCCESS,
		payload: probeId
	};
}

export const addProbeError = error => {
	return {
		type: types.ADD_PROBE_FAILED,
		payload: error
	};
}

export function resetAddProbe() {
    return function (dispatch) {
        dispatch(addProbeReset());
    };
}

// Calls the API to add a probe
export const addProbe = (probeKey,probeName) => async (dispatch) => {

	dispatch(addProbeRequest());

	try{
        const response = await postApi('probe/',{probeKey,probeName});
        const data = response.data;
		dispatch(addProbeSuccess(data));
		return 'ok';
	}catch(error){
		let errorMsg;
		if (error && error.response && error.response.data)
			errorMsg = error.response.data;
		if (error && error.data) {
			errorMsg = error.data;
		}
		if(error && error.message){
			errorMsg = error.message;
		}
		else{
			errorMsg = 'Network Error';
		}
		dispatch(addProbeError(errors(errorMsg)));
		return 'error';
	}
}
