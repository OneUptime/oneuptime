import { postApi, getApi, deleteApi, putApi } from '../api';
import * as types from '../constants/automatedScript';

export function resetScripts(data: $TSFixMe) {
    return {
        type: types.RESET_AUTOMATED_SCRIPT,
        payload: data,
    };
}

export function createAutomatedScriptRequest(data: $TSFixMe) {
    return {
        type: types.CREATE_AUTOMATED_SCRIPT_REQUEST,
        payload: data,
    };
}

export function createAutomatedScriptSuccess(data: $TSFixMe) {
    return {
        type: types.CREATE_AUTOMATED_SCRIPT_SUCCESS,
        payload: data,
    };
}

export function createAutomatedScriptFailure(error: $TSFixMe) {
    return {
        type: types.CREATE_AUTOMATED_SCRIPT_FAILURE,
        payload: error,
    };
}

export function createAutomatedScript(projectId: $TSFixMe, data: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = postApi(`automated-scripts/${projectId}`, data);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 1 arguments, but got 0.
        dispatch(createAutomatedScriptRequest());

        promise.then(
            function(response) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(createAutomatedScriptSuccess(response.data));
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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

export function updateAutomatedScriptRequest(data: $TSFixMe) {
    return {
        type: types.CREATE_AUTOMATED_SCRIPT_REQUEST,
        payload: data,
    };
}

export function updateAutomatedScriptSuccess(data: $TSFixMe) {
    return {
        type: types.CREATE_AUTOMATED_SCRIPT_SUCCESS,
        payload: data,
    };
}

export function updateAutomatedScriptFailure(error: $TSFixMe) {
    return {
        type: types.CREATE_AUTOMATED_SCRIPT_FAILURE,
        payload: error,
    };
}

export function updateAutomatedScript(
    projectId: $TSFixMe,
    automatedScriptId: $TSFixMe,
    data: $TSFixMe
) {
    return function(dispatch: $TSFixMe) {
        const promise = putApi(
            `automated-scripts/${projectId}/${automatedScriptId}`,
            data
        );
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 1 arguments, but got 0.
        dispatch(updateAutomatedScriptRequest());

        promise.then(
            function(response) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(updateAutomatedScriptSuccess(response.data));
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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
                dispatch(updateAutomatedScriptFailure(error));
                return error;
            }
        );

        return promise;
    };
}

export function fetchSingleAutomatedScriptSuccess(data: $TSFixMe) {
    return {
        type: types.FETCH_SINGLE_SCRIPT_SUCCESS,
        payload: data,
    };
}

export function fetchSingleAutomatedScriptRequest(data: $TSFixMe) {
    return {
        type: types.FETCH_SINGLE_SCRIPT_REQUEST,
        payload: data,
    };
}

export function fetchSingleAutomatedScriptFailure(data: $TSFixMe) {
    return {
        type: types.FETCH_SINGLE_SCRIPT_FAILURE,
        payload: data,
    };
}

export function fetchSingleAutomatedScript(
    projectId: $TSFixMe,
    automatedSlug: $TSFixMe,
    skip: $TSFixMe,
    limit: $TSFixMe
) {
    return function(dispatch: $TSFixMe) {
        const promise = getApi(
            `automated-scripts/${projectId}/${automatedSlug}?skip=${skip}&limit=${limit}`
        );
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 1 arguments, but got 0.
        dispatch(fetchSingleAutomatedScriptRequest());

        promise.then(
            function(response) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(fetchSingleAutomatedScriptSuccess(response.data));
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

export function fetchAutomatedScriptSuccess(scripts: $TSFixMe) {
    return {
        type: types.FETCH_AUTOMATED_SCRIPT_SUCCESS,
        payload: scripts,
    };
}
export function fetchAutomatedScriptFailure(error: $TSFixMe) {
    return {
        type: types.FETCH_AUTOMATED_SCRIPT_FAILURE,
        payload: error,
    };
}

export function fetchAutomatedScript(
    projectId: $TSFixMe,
    skip: $TSFixMe,
    limit: $TSFixMe
) {
    return function(dispatch: $TSFixMe) {
        const promise = getApi(
            `automated-scripts/${projectId}?skip=${skip}&limit=${limit}`
        );

        promise.then(
            function(response) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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

export function runAutomatedScriptRequest() {
    return {
        type: types.RUN_AUTOMATED_SCRIPT_REQUEST,
    };
}
export function runAutomatedScriptFailure(error: $TSFixMe) {
    return {
        type: types.RUN_AUTOMATED_SCRIPT_FAILURE,
        payload: error,
    };
}
export function runAutomatedScriptSuccess(data: $TSFixMe) {
    return {
        type: types.RUN_AUTOMATED_SCRIPT_SUCCESS,
        payload: data,
    };
}

export function runScript(projectId: $TSFixMe, automatedScriptId: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
        const promise = putApi(
            `automated-scripts/${projectId}/${automatedScriptId}/run`
        );
        dispatch(runAutomatedScriptRequest());

        promise.then(
            function(response) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(runAutomatedScriptSuccess(response.data));
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                return response.data;
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
                dispatch(runAutomatedScriptFailure(error));
            }
        );

        return promise;
    };
}

const deleteAutomatedScriptSuccess = (data: $TSFixMe) => {
    return {
        type: types.DELETE_AUTOMATED_SCRIPT_SUCCESS,
        payload: data,
    };
};

const deleteAutomatedScriptRequest = () => {
    return {
        type: types.DELETE_AUTOMATED_SCRIPT_REQUEST,
    };
};

const deleteAutomatedScriptFailure = (error: $TSFixMe) => {
    return {
        type: types.DELETE_AUTOMATED_SCRIPT_FAILURE,
        payload: error,
    };
};

export function deleteAutomatedScript(
    projectId: $TSFixMe,
    automatedSlug: $TSFixMe
) {
    return function(dispatch: $TSFixMe) {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
        const promise = deleteApi(
            `automated-scripts/${projectId}/${automatedSlug}`
        );
        dispatch(deleteAutomatedScriptRequest());

        promise.then(
            function(response) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(deleteAutomatedScriptSuccess(response.data));
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
                dispatch(deleteAutomatedScriptFailure(error));
                return false;
            }
        );

        return promise;
    };
}
