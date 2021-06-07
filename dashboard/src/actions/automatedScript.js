import { postApi, getApi, deleteApi } from '../api';
import * as types from '../constants/automatedScript';
import errors from '../errors';

export function createAutomatedScript(values) {
    return function(dispatch, getstate) {
        const projectId = getstate().project.currentProject._id;
        const promise = postApi(`automated-scripts/${projectId}`, values);

        promise.then(
            function(res) {
                if (res.status === 200) {
                    dispatch(fetchAutomatedScript(projectId));
                }
                return true;
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
                dispatch(createAutomatedScriptFailure(errors(error)));
                return false;
            }
        );

        return promise;
    };
}

export function fetchAutomatedScript(projectId) {
    return function(dispatch) {
        const promise = getApi(`automated-scripts/${projectId}`);

        promise.then(
            function(scripts) {
                dispatch(fetchAutomatedScriptSuccess(scripts.data.data));
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

export function createAutomatedScriptSuccess(newComponent) {
    return {
        type: types.CREATE_AUTOMATED_SCRIPT_SUCCESS,
        payload: newComponent,
    };
}

export function createAutomatedScriptFailure(error) {
    return {
        type: types.CREATE_AUTOMATED_SCRIPT_FAILURE,
        payload: error,
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
