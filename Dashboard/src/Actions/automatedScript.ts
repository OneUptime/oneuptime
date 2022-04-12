import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/automatedScript';
import ErrorPayload from 'CommonUI/src/payload-types/error';
import PositiveNumber from 'Common/Types/PositiveNumber';
export const resetScripts = (data: $TSFixMe): void => {
    return {
        type: types.RESET_AUTOMATED_SCRIPT,
        payload: data,
    };
};

export const createAutomatedScriptRequest = (data: $TSFixMe): void => {
    return {
        type: types.CREATE_AUTOMATED_SCRIPT_REQUEST,
        payload: data,
    };
};

export const createAutomatedScriptSuccess = (data: $TSFixMe): void => {
    return {
        type: types.CREATE_AUTOMATED_SCRIPT_SUCCESS,
        payload: data,
    };
};

export const createAutomatedScriptFailure = (error: ErrorPayload): void => {
    return {
        type: types.CREATE_AUTOMATED_SCRIPT_FAILURE,
        payload: error,
    };
};

export const createAutomatedScript = (
    projectId: string,
    data: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(`automated-scripts/${projectId}`, data);

        dispatch(createAutomatedScriptRequest());

        promise.then(
            function (response): void {
                dispatch(createAutomatedScriptSuccess(response.data));

                return response.data;
            },
            function (error): void {
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

export const updateAutomatedScriptRequest = (data: $TSFixMe): void => {
    return {
        type: types.CREATE_AUTOMATED_SCRIPT_REQUEST,
        payload: data,
    };
};

export const updateAutomatedScriptSuccess = (data: $TSFixMe): void => {
    return {
        type: types.CREATE_AUTOMATED_SCRIPT_SUCCESS,
        payload: data,
    };
};

export const updateAutomatedScriptFailure = (error: ErrorPayload): void => {
    return {
        type: types.CREATE_AUTOMATED_SCRIPT_FAILURE,
        payload: error,
    };
};

export function updateAutomatedScript(
    projectId: string,
    automatedScriptId: $TSFixMe,
    data: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.put(
            `automated-scripts/${projectId}/${automatedScriptId}`,
            data
        );

        dispatch(updateAutomatedScriptRequest());

        promise.then(
            function (response): void {
                dispatch(updateAutomatedScriptSuccess(response.data));

                return response.data;
            },
            function (error): void {
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

export const fetchSingleAutomatedScriptSuccess = (data: $TSFixMe): void => {
    return {
        type: types.FETCH_SINGLE_SCRIPT_SUCCESS,
        payload: data,
    };
};

export const fetchSingleAutomatedScriptRequest = (data: $TSFixMe): void => {
    return {
        type: types.FETCH_SINGLE_SCRIPT_REQUEST,
        payload: data,
    };
};

export const fetchSingleAutomatedScriptFailure = (data: $TSFixMe): void => {
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
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(
            `automated-scripts/${projectId}/${automatedSlug}?skip=${skip}&limit=${limit}`
        );

        dispatch(fetchSingleAutomatedScriptRequest());

        promise.then(
            function (response): void {
                dispatch(fetchSingleAutomatedScriptSuccess(response.data));
            },
            function (error): void {
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

export const fetchAutomatedScriptSuccess = (scripts: $TSFixMe): void => {
    return {
        type: types.FETCH_AUTOMATED_SCRIPT_SUCCESS,
        payload: scripts,
    };
};
export const fetchAutomatedScriptFailure = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_AUTOMATED_SCRIPT_FAILURE,
        payload: error,
    };
};

export function fetchAutomatedScript(
    projectId: string,
    skip: PositiveNumber,
    limit: PositiveNumber
): void {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(
            `automated-scripts/${projectId}?skip=${skip}&limit=${limit}`
        );

        promise.then(
            function (response): void {
                dispatch(fetchAutomatedScriptSuccess(response.data));
            },
            function (error): void {
                dispatch(fetchAutomatedScriptFailure(error));
            }
        );

        return promise;
    };
}

export const runAutomatedScriptRequest = (): void => {
    return {
        type: types.RUN_AUTOMATED_SCRIPT_REQUEST,
    };
};
export const runAutomatedScriptFailure = (error: ErrorPayload): void => {
    return {
        type: types.RUN_AUTOMATED_SCRIPT_FAILURE,
        payload: error,
    };
};
export const runAutomatedScriptSuccess = (data: $TSFixMe): void => {
    return {
        type: types.RUN_AUTOMATED_SCRIPT_SUCCESS,
        payload: data,
    };
};

export const runScript = (
    projectId: string,
    automatedScriptId: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.put(
            `automated-scripts/${projectId}/${automatedScriptId}/run`
        );
        dispatch(runAutomatedScriptRequest());

        promise.then(
            function (response): void {
                dispatch(runAutomatedScriptSuccess(response.data));

                return response.data;
            },
            function (error): void {
                dispatch(runAutomatedScriptFailure(error));
            }
        );

        return promise;
    };
};

const deleteAutomatedScriptSuccess = (data: $TSFixMe): void => {
    return {
        type: types.DELETE_AUTOMATED_SCRIPT_SUCCESS,
        payload: data,
    };
};

const deleteAutomatedScriptRequest = (): void => {
    return {
        type: types.DELETE_AUTOMATED_SCRIPT_REQUEST,
    };
};

const deleteAutomatedScriptFailure = (error: ErrorPayload): void => {
    return {
        type: types.DELETE_AUTOMATED_SCRIPT_FAILURE,
        payload: error,
    };
};

export function deleteAutomatedScript(
    projectId: string,
    automatedSlug: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise =
            delete `automated-scripts/${projectId}/${automatedSlug}`;
        dispatch(deleteAutomatedScriptRequest());

        promise.then(
            function (response): void {
                dispatch(deleteAutomatedScriptSuccess(response.data));
                return true;
            },
            function (error): void {
                dispatch(deleteAutomatedScriptFailure(error));
                return false;
            }
        );

        return promise;
    };
}
