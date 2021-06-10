import { postApi, getApi, deleteApi } from '../api';
import * as types from '../constants/automatedScript';
import errors from '../errors';

export function resetScripts(data) {
    return {
        type: types.RESET_AUTOMATED_SCRIPT,
        payload: data,
    };
}

export function createAutomatedScriptRequest(data) {
    return {
        type: types.CREATE_AUTOMATED_SCRIPT_REQUEST,
        payload: data,
    };
}

export function createAutomatedScriptSuccess(data) {
    return {
        type: types.CREATE_AUTOMATED_SCRIPT_SUCCESS,
        payload: data,
    };
}

export function createAutomatedScriptFailure(error) {
    return {
        type: types.CREATE_AUTOMATED_SCRIPT_FAILURE,
        payload: error,
    };
}

export function createAutomatedScript(projectId, data) {
    return function(dispatch) {
        const promise = postApi(`automated-scripts/${projectId}`, data);
        dispatch(createAutomatedScriptRequest());

        promise.then(
            function(response) {
                dispatch(createAutomatedScriptSuccess(response.data));
                return response.data;
            },
            function(error) {
                if (error && error.response && error.response.data) {
                    error = error.response.data;
                }
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(createAutomatedScriptFailure(error));
                return error;
            }
        );

        return promise;
    };
}

export function fetchSingleAutomatedScriptSuccess(data) {
    return {
        type: types.FETCH_SINGLE_SCRIPT_SUCCESS,
        payload: data,
    };
}

export function fetchSingleAutomatedScriptRequest(data) {
    return {
        type: types.FETCH_SINGLE_SCRIPT_REQUEST,
        payload: data,
    };
}

export function fetchSingleAutomatedScriptFailure(data) {
    return {
        type: types.FETCH_SINGLE_SCRIPT_FAILURE,
        payload: data,
    };
}

export function fetchSingleAutomatedScript(projectId, automatedSlug) {
    return function(dispatch) {
        const promise = getApi(
            `automated-scripts/${projectId}/${automatedSlug}`
        );
        dispatch(fetchSingleAutomatedScriptRequest());

        promise.then(
            function(response) {
                dispatch(fetchSingleAutomatedScriptSuccess(response.data.data));
            },
            function(error) {
                if (error && error.response && error.response.data) {
                    error = error.response.data;
                }
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(fetchSingleAutomatedScriptFailure(error));
                return error;
            }
        );

        return promise;
    };
}

export function fetchAutomatedScriptSuccess(scripts) {
    return {
        type: types.FETCH_AUTOMATED_SCRIPT_SUCCESS,
        payload: scripts,
    };
}
export function fetchAutomatedScriptFailure(error) {
    return {
        type: types.FETCH_AUTOMATED_SCRIPT_FAILURE,
        payload: error,
    };
}

export function fetchAutomatedScript(projectId, skip, limit) {
    return function(dispatch) {
        const promise = getApi(
            `automated-scripts/${projectId}?skip=${skip}&limit=${limit}`
        );

        promise.then(
            function(response) {
                dispatch(fetchAutomatedScriptSuccess(response.data));
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
                dispatch(fetchAutomatedScriptFailure(error));
            }
        );

        return promise;
    };
}

export function deleteAutomatedScript(scriptId) {
    return function(dispatch, getstate) {
        const projectId = getstate().project.currentProject._id;
        const promise = deleteApi(`automated-scripts/${scriptId}/${projectId}`);

        promise.then(
            function(res) {
                if (res.status === 200) {
                    dispatch(fetchAutomatedScript(projectId));
                }
                return true;
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
                dispatch(fetchAutomatedScriptFailure(errors(error)));
                return false;
            }
        );

        return promise;
    };
}
