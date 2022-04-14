import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import * as types from '../constants/automatedScript';
import ErrorPayload from 'CommonUI/src/payload-types/error';
import PositiveNumber from 'Common/Types/PositiveNumber';
export const resetScripts: Function = (data: $TSFixMe): void => {
    return {
        type: types.RESET_AUTOMATED_SCRIPT,
        payload: data,
    };
};

export const createAutomatedScriptRequest: Function = (
    data: $TSFixMe
): void => {
    return {
        type: types.CREATE_AUTOMATED_SCRIPT_REQUEST,
        payload: data,
    };
};

export const createAutomatedScriptSuccess: Function = (
    data: $TSFixMe
): void => {
    return {
        type: types.CREATE_AUTOMATED_SCRIPT_SUCCESS,
        payload: data,
    };
};

export const createAutomatedScriptFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.CREATE_AUTOMATED_SCRIPT_FAILURE,
        payload: error,
    };
};

export const createAutomatedScript: Function = (
    projectId: ObjectID,
    data: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            `automated-scripts/${projectId}`,
            data
        );

        dispatch(createAutomatedScriptRequest());

        promise.then(
            (response): void => {
                dispatch(createAutomatedScriptSuccess(response.data));

                return response.data;
            },
            (error): void => {
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

export const updateAutomatedScriptRequest: Function = (
    data: $TSFixMe
): void => {
    return {
        type: types.CREATE_AUTOMATED_SCRIPT_REQUEST,
        payload: data,
    };
};

export const updateAutomatedScriptSuccess: Function = (
    data: $TSFixMe
): void => {
    return {
        type: types.CREATE_AUTOMATED_SCRIPT_SUCCESS,
        payload: data,
    };
};

export const updateAutomatedScriptFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.CREATE_AUTOMATED_SCRIPT_FAILURE,
        payload: error,
    };
};

export function updateAutomatedScript(
    projectId: ObjectID,
    automatedScriptId: $TSFixMe,
    data: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `automated-scripts/${projectId}/${automatedScriptId}`,
            data
        );

        dispatch(updateAutomatedScriptRequest());

        promise.then(
            (response): void => {
                dispatch(updateAutomatedScriptSuccess(response.data));

                return response.data;
            },
            (error): void => {
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

export const fetchSingleAutomatedScriptSuccess: Function = (
    data: $TSFixMe
): void => {
    return {
        type: types.FETCH_SINGLE_SCRIPT_SUCCESS,
        payload: data,
    };
};

export const fetchSingleAutomatedScriptRequest: Function = (
    data: $TSFixMe
): void => {
    return {
        type: types.FETCH_SINGLE_SCRIPT_REQUEST,
        payload: data,
    };
};

export const fetchSingleAutomatedScriptFailure: Function = (
    data: $TSFixMe
): void => {
    return {
        type: types.FETCH_SINGLE_SCRIPT_FAILURE,
        payload: data,
    };
};

export function fetchSingleAutomatedScript(
    projectId: ObjectID,
    automatedSlug: $TSFixMe,
    skip: PositiveNumber,
    limit: PositiveNumber
) {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `automated-scripts/${projectId}/${automatedSlug}?skip=${skip}&limit=${limit}`
        );

        dispatch(fetchSingleAutomatedScriptRequest());

        promise.then(
            (response): void => {
                dispatch(fetchSingleAutomatedScriptSuccess(response.data));
            },
            (error): void => {
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

export const fetchAutomatedScriptSuccess: Function = (
    scripts: $TSFixMe
): void => {
    return {
        type: types.FETCH_AUTOMATED_SCRIPT_SUCCESS,
        payload: scripts,
    };
};
export const fetchAutomatedScriptFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_AUTOMATED_SCRIPT_FAILURE,
        payload: error,
    };
};

export function fetchAutomatedScript(
    projectId: ObjectID,
    skip: PositiveNumber,
    limit: PositiveNumber
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `automated-scripts/${projectId}?skip=${skip}&limit=${limit}`
        );

        promise.then(
            (response): void => {
                dispatch(fetchAutomatedScriptSuccess(response.data));
            },
            (error): void => {
                dispatch(fetchAutomatedScriptFailure(error));
            }
        );

        return promise;
    };
}

export const runAutomatedScriptRequest: Function = (): void => {
    return {
        type: types.RUN_AUTOMATED_SCRIPT_REQUEST,
    };
};
export const runAutomatedScriptFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.RUN_AUTOMATED_SCRIPT_FAILURE,
        payload: error,
    };
};
export const runAutomatedScriptSuccess: Function = (data: $TSFixMe): void => {
    return {
        type: types.RUN_AUTOMATED_SCRIPT_SUCCESS,
        payload: data,
    };
};

export const runScript: Function = (
    projectId: ObjectID,
    automatedScriptId: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `automated-scripts/${projectId}/${automatedScriptId}/run`
        );
        dispatch(runAutomatedScriptRequest());

        promise.then(
            (response): void => {
                dispatch(runAutomatedScriptSuccess(response.data));

                return response.data;
            },
            (error): void => {
                dispatch(runAutomatedScriptFailure(error));
            }
        );

        return promise;
    };
};

const deleteAutomatedScriptSuccess: Function = (data: $TSFixMe): void => {
    return {
        type: types.DELETE_AUTOMATED_SCRIPT_SUCCESS,
        payload: data,
    };
};

const deleteAutomatedScriptRequest: Function = (): void => {
    return {
        type: types.DELETE_AUTOMATED_SCRIPT_REQUEST,
    };
};

const deleteAutomatedScriptFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.DELETE_AUTOMATED_SCRIPT_FAILURE,
        payload: error,
    };
};

export function deleteAutomatedScript(
    projectId: ObjectID,
    automatedSlug: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe =
            delete `automated-scripts/${projectId}/${automatedSlug}`;
        dispatch(deleteAutomatedScriptRequest());

        promise.then(
            (response): void => {
                dispatch(deleteAutomatedScriptSuccess(response.data));
                return true;
            },
            (error): void => {
                dispatch(deleteAutomatedScriptFailure(error));
                return false;
            }
        );

        return promise;
    };
}
