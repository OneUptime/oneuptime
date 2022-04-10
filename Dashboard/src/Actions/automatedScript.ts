import BackendAPI from 'common-ui/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/automatedScript';
import ErrorPayload from 'common-ui/src/payload-types/error';
import PositiveNumber from 'common/Types/PositiveNumber';
export const resetScripts = (data: $TSFixMe) => {
    return {
        type: types.RESET_AUTOMATED_SCRIPT,
        payload: data,
    };
};

export const createAutomatedScriptRequest = (data: $TSFixMe) => {
    return {
        type: types.CREATE_AUTOMATED_SCRIPT_REQUEST,
        payload: data,
    };
};

export const createAutomatedScriptSuccess = (data: $TSFixMe) => {
    return {
        type: types.CREATE_AUTOMATED_SCRIPT_SUCCESS,
        payload: data,
    };
};

export const createAutomatedScriptFailure = (error: ErrorPayload) => {
    return {
        type: types.CREATE_AUTOMATED_SCRIPT_FAILURE,
        payload: error,
    };
};

export const createAutomatedScript = (projectId: string, data: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.post(`automated-scripts/${projectId}`, data);

        dispatch(createAutomatedScriptRequest());

        promise.then(
            function (response) {
                dispatch(createAutomatedScriptSuccess(response.data));

                return response.data;
            },
            function (error) {
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
};

export const updateAutomatedScriptRequest = (data: $TSFixMe) => {
    return {
        type: types.CREATE_AUTOMATED_SCRIPT_REQUEST,
        payload: data,
    };
};

export const updateAutomatedScriptSuccess = (data: $TSFixMe) => {
    return {
        type: types.CREATE_AUTOMATED_SCRIPT_SUCCESS,
        payload: data,
    };
};

export const updateAutomatedScriptFailure = (error: ErrorPayload) => {
    return {
        type: types.CREATE_AUTOMATED_SCRIPT_FAILURE,
        payload: error,
    };
};

export function updateAutomatedScript(
    projectId: string,
    automatedScriptId: $TSFixMe,
    data: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.put(
            `automated-scripts/${projectId}/${automatedScriptId}`,
            data
        );

        dispatch(updateAutomatedScriptRequest());

        promise.then(
            function (response) {
                dispatch(updateAutomatedScriptSuccess(response.data));

                return response.data;
            },
            function (error) {
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

export const fetchSingleAutomatedScriptSuccess = (data: $TSFixMe) => {
    return {
        type: types.FETCH_SINGLE_SCRIPT_SUCCESS,
        payload: data,
    };
};

export const fetchSingleAutomatedScriptRequest = (data: $TSFixMe) => {
    return {
        type: types.FETCH_SINGLE_SCRIPT_REQUEST,
        payload: data,
    };
};

export const fetchSingleAutomatedScriptFailure = (data: $TSFixMe) => {
    return {
        type: types.FETCH_SINGLE_SCRIPT_FAILURE,
        payload: data,
    };
};

export function fetchSingleAutomatedScript(
    projectId: string,
    automatedSlug: $TSFixMe,
    skip: PositiveNumber,
    limit: PositiveNumber
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(
            `automated-scripts/${projectId}/${automatedSlug}?skip=${skip}&limit=${limit}`
        );

        dispatch(fetchSingleAutomatedScriptRequest());

        promise.then(
            function (response) {
                dispatch(fetchSingleAutomatedScriptSuccess(response.data));
            },
            function (error) {
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

export const fetchAutomatedScriptSuccess = (scripts: $TSFixMe) => {
    return {
        type: types.FETCH_AUTOMATED_SCRIPT_SUCCESS,
        payload: scripts,
    };
};
export const fetchAutomatedScriptFailure = (error: ErrorPayload) => {
    return {
        type: types.FETCH_AUTOMATED_SCRIPT_FAILURE,
        payload: error,
    };
};

export function fetchAutomatedScript(
    projectId: string,
    skip: PositiveNumber,
    limit: PositiveNumber
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(
            `automated-scripts/${projectId}?skip=${skip}&limit=${limit}`
        );

        promise.then(
            function (response) {
                dispatch(fetchAutomatedScriptSuccess(response.data));
            },
            function (error) {
                dispatch(fetchAutomatedScriptFailure(error));
            }
        );

        return promise;
    };
}

export const runAutomatedScriptRequest = () => {
    return {
        type: types.RUN_AUTOMATED_SCRIPT_REQUEST,
    };
};
export const runAutomatedScriptFailure = (error: ErrorPayload) => {
    return {
        type: types.RUN_AUTOMATED_SCRIPT_FAILURE,
        payload: error,
    };
};
export const runAutomatedScriptSuccess = (data: $TSFixMe) => {
    return {
        type: types.RUN_AUTOMATED_SCRIPT_SUCCESS,
        payload: data,
    };
};

export const runScript = (projectId: string, automatedScriptId: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.put(
            `automated-scripts/${projectId}/${automatedScriptId}/run`
        );
        dispatch(runAutomatedScriptRequest());

        promise.then(
            function (response) {
                dispatch(runAutomatedScriptSuccess(response.data));

                return response.data;
            },
            function (error) {
                dispatch(runAutomatedScriptFailure(error));
            }
        );

        return promise;
    };
};

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

const deleteAutomatedScriptFailure = (error: ErrorPayload) => {
    return {
        type: types.DELETE_AUTOMATED_SCRIPT_FAILURE,
        payload: error,
    };
};

export function deleteAutomatedScript(
    projectId: string,
    automatedSlug: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise =
            delete `automated-scripts/${projectId}/${automatedSlug}`;
        dispatch(deleteAutomatedScriptRequest());

        promise.then(
            function (response) {
                dispatch(deleteAutomatedScriptSuccess(response.data));
                return true;
            },
            function (error) {
                dispatch(deleteAutomatedScriptFailure(error));
                return false;
            }
        );

        return promise;
    };
}
