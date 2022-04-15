import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import * as types from '../constants/applicationLog';
import ErrorPayload from 'CommonUI/src/payload-types/error';
import PositiveNumber from 'Common/Types/PositiveNumber';
//Create new log container
//props -> {name: '', type, data -> { data.url}}
export function createApplicationLog(
    projectId: ObjectID,
    componentId: $TSFixMe,
    values: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            `application-log/${projectId}/${componentId}/create`,
            values
        );
        dispatch(createApplicationLogRequest());

        promise.then(
            (applicationLog: $TSFixMe): void => {
                dispatch(createApplicationLogSuccess(applicationLog.data));
            },
            (error: $TSFixMe): void => {
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
                dispatch(createApplicationLogFailure(error));
            }
        );

        return promise;
    };
}

export const createApplicationLogSuccess: Function = (
    newApplicationLog: $TSFixMe
): void => {
    return {
        type: types.CREATE_APPLICATION_LOG_SUCCESS,
        payload: newApplicationLog,
    };
};

export const createApplicationLogRequest: Function = (): void => {
    return {
        type: types.CREATE_APPLICATION_LOG_REQUEST,
    };
};

export const createApplicationLogFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.CREATE_APPLICATION_LOG_FAILURE,
        payload: error,
    };
};

export const resetCreateApplicationLog: Function = (): void => {
    return {
        type: types.CREATE_APPLICATION_LOG_RESET,
    };
};

export function fetchApplicationLogs(
    projectId: ObjectID,
    componentId: $TSFixMe,
    skip: number = 0
    limit = 0,
    paginated = false
) {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `application-log/${projectId}/${componentId}?skip=${skip}&limit=${limit}`
        );
        dispatch(fetchApplicationLogsRequest(paginated));

        promise.then(
            (applicationLogs: $TSFixMe): void => {
                dispatch(fetchApplicationLogsSuccess(applicationLogs.data));
            },
            (error: $TSFixMe): void => {
                dispatch(fetchApplicationLogsFailure(error));
            }
        );

        return promise;
    };
}

export const fetchApplicationLogsSuccess: Function = (
    applicationLogs: $TSFixMe
): void => {
    return {
        type: types.FETCH_APPLICATION_LOGS_SUCCESS,
        payload: applicationLogs,
    };
};

export const fetchApplicationLogsRequest: Function = (
    paginated: $TSFixMe
): void => {
    return {
        type: types.FETCH_APPLICATION_LOGS_REQUEST,
        payload: paginated,
    };
};

export const fetchApplicationLogsFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_APPLICATION_LOGS_FAILURE,
        payload: error,
    };
};

export const resetFetchApplicationLogs: Function = (): void => {
    return {
        type: types.FETCH_APPLICATION_LOGS_RESET,
    };
};

//Delete a applicationLog
//props -> {name: '', type, data -> { data.url}}
export function deleteApplicationLog(
    projectId: ObjectID,
    componentId: $TSFixMe,
    applicationLogId: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe =
            delete (`application-log/${projectId}/${componentId}/${applicationLogId}`,
            {
                applicationLogId,
            });
        dispatch(deleteApplicationLogRequest(applicationLogId));

        promise.then(
            (applicationLog: $TSFixMe): void => {
                dispatch(deleteApplicationLogSuccess(applicationLog.data._id));
            },
            (error: $TSFixMe): void => {
                dispatch(
                    deleteApplicationLogFailure({
                        error: error,
                        applicationLogId,
                    })
                );
            }
        );

        return promise;
    };
}

export const deleteApplicationLogSuccess: Function = (
    removedApplicationLogId: $TSFixMe
): void => {
    return {
        type: types.DELETE_APPLICATION_LOG_SUCCESS,
        payload: removedApplicationLogId,
    };
};

export const deleteApplicationLogRequest: Function = (
    applicationLogId: $TSFixMe
): void => {
    return {
        type: types.DELETE_APPLICATION_LOG_REQUEST,
        payload: applicationLogId,
    };
};

export const deleteApplicationLogFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.DELETE_APPLICATION_LOG_FAILURE,
        payload: error,
    };
};

export const deleteComponentApplicationLogs: Function = (
    componentId: $TSFixMe
): void => {
    return {
        type: types.DELETE_COMPONENT_APPLICATION_LOGS,
        payload: componentId,
    };
};

export function fetchLogs(
    projectId: ObjectID,
    componentId: $TSFixMe,
    applicationLogId: $TSFixMe,
    skip: PositiveNumber,
    limit: PositiveNumber,
    startDate: $TSFixMe,
    endDate: $TSFixMe,
    type: $TSFixMe,
    filter: $TSFixMe
) {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            `application-log/${projectId}/${componentId}/${applicationLogId}/logs`,
            {
                skip,
                limit,
                startDate,
                endDate,
                type,
                filter,
            }
        );
        dispatch(fetchLogsRequest({ applicationLogId }));

        promise.then(
            (response: $TSFixMe): void => {
                dispatch(
                    fetchLogsSuccess({
                        applicationLogId,

                        logs: response.data.data.logs,

                        dateRange: response.data.data.dateRange,
                        skip,
                        limit,

                        count: response.data.count,
                    })
                );
            },
            (error: $TSFixMe): void => {
                dispatch(fetchLogsFailure({ applicationLogId, error: error }));
            }
        );

        return promise;
    };
}

export const fetchLogsSuccess: Function = (logs: $TSFixMe): void => {
    return {
        type: types.FETCH_LOGS_SUCCESS,
        payload: logs,
    };
};

export const fetchLogsRequest: Function = (
    applicationLogId: $TSFixMe
): void => {
    return {
        type: types.FETCH_LOGS_REQUEST,
        payload: applicationLogId,
    };
};

export const fetchLogsFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_LOGS_FAILURE,
        payload: error,
    };
};
export const resetFetchLogs: Function = (): void => {
    return {
        type: types.FETCH_LOGS_RESET,
    };
};

export function resetApplicationLogKey(
    projectId: ObjectID,
    componentId: $TSFixMe,
    applicationLogId: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            `application-log/${projectId}/${componentId}/${applicationLogId}/reset-key`
        );
        dispatch(resetApplicationLogKeyRequest());

        promise.then(
            (applicationLog: $TSFixMe): void => {
                dispatch(resetApplicationLogKeySuccess(applicationLog.data));
            },
            (error: $TSFixMe): void => {
                dispatch(resetApplicationLogKeyFailure(error));
            }
        );

        return promise;
    };
}

export const resetApplicationLogKeySuccess: Function = (
    applicationLog: $TSFixMe
): void => {
    return {
        type: types.RESET_APPLICATION_LOG_KEY_SUCCESS,
        payload: applicationLog,
    };
};

export const resetApplicationLogKeyRequest: Function = (): void => {
    return {
        type: types.RESET_APPLICATION_LOG_KEY_REQUEST,
    };
};

export const resetApplicationLogKeyFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.RESET_APPLICATION_LOG_KEY_FAILURE,
        payload: error,
    };
};

export const resetresetApplicationLogKey: Function = (): void => {
    return {
        type: types.RESET_APPLICATION_LOG_KEY_RESET,
    };
};
export const editApplicationLogSwitch: Function = (index: $TSFixMe): void => {
    return {
        type: types.EDIT_APPLICATION_LOG_SWITCH,
        payload: index,
    };
};
//Edit new applicationLog
export function editApplicationLog(
    projectId: ObjectID,
    componentId: $TSFixMe,
    applicationLogId: $TSFixMe,
    values: $TSFixMe
) {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `application-log/${projectId}/${componentId}/${applicationLogId}`,
            values
        );
        dispatch(editApplicationLogRequest());

        promise.then(
            (applicationLog: $TSFixMe): void => {
                dispatch(editApplicationLogSuccess(applicationLog.data));
            },
            (error: $TSFixMe): void => {
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
                dispatch(editApplicationLogFailure(error));
            }
        );

        return promise;
    };
}

export const editApplicationLogSuccess: Function = (
    newApplicationLog: $TSFixMe
): void => {
    return {
        type: types.EDIT_APPLICATION_LOG_SUCCESS,
        payload: newApplicationLog,
    };
};

export const editApplicationLogRequest: Function = (): void => {
    return {
        type: types.EDIT_APPLICATION_LOG_REQUEST,
    };
};

export const editApplicationLogFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.EDIT_APPLICATION_LOG_FAILURE,
        payload: error,
    };
};

export function fetchStats(
    projectId: ObjectID,
    componentId: $TSFixMe,
    applicationLogId: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            `application-log/${projectId}/${componentId}/${applicationLogId}/stats`,
            {}
        );
        dispatch(fetchStatsRequest({ applicationLogId }));

        promise.then(
            (logs: $TSFixMe): void => {
                dispatch(
                    fetchStatsSuccess({
                        applicationLogId,

                        stats: logs.data.data,
                    })
                );
            },
            (error: $TSFixMe): void => {
                dispatch(
                    fetchStatsFailure({
                        applicationLogId,
                        error: error,
                    })
                );
            }
        );

        return promise;
    };
}

export const fetchStatsSuccess: Function = (stats: $TSFixMe): void => {
    return {
        type: types.FETCH_LOG_STAT_SUCCESS,
        payload: stats,
    };
};

export const fetchStatsRequest: Function = (
    applicationLogId: $TSFixMe
): void => {
    return {
        type: types.FETCH_LOG_STAT_REQUEST,
        payload: applicationLogId,
    };
};

export const fetchStatsFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_LOG_STAT_FAILURE,
        payload: error,
    };
};
export const resetFetchStats: Function = (): void => {
    return {
        type: types.FETCH_LOG_STAT_RESET,
    };
};
export const getLogSuccess: Function = (log: $TSFixMe): void => {
    return {
        type: types.GET_LOG_SUCCESS,
        payload: log,
    };
};

export function searchLog(
    projectId: ObjectID,
    componentId: $TSFixMe,
    applicationLogId: $TSFixMe,
    payload: $TSFixMe
) {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            `application-log/${projectId}/${componentId}/${applicationLogId}/search`,
            payload
        );
        dispatch(fetchLogsRequest({ applicationLogId }));
        promise.then(
            (response: $TSFixMe): void => {
                dispatch(
                    fetchLogsSuccess({
                        applicationLogId,

                        logs: response.data.searchedLogs,

                        count: response.data.totalSearchCount,
                    })
                );
            },
            (error: $TSFixMe): void => {
                dispatch(fetchLogsFailure({ applicationLogId, error: error }));
            }
        );
        return promise;
    };
}
