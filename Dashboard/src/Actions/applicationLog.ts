import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/applicationLog';
import ErrorPayload from 'CommonUI/src/payload-types/error';
import PositiveNumber from 'Common/Types/PositiveNumber';
//Create new log container
//props -> {name: '', type, data -> { data.url}}
export function createApplicationLog(
    projectId: string,
    componentId: $TSFixMe,
    values: $TSFixMe
) {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(
            `application-log/${projectId}/${componentId}/create`,
            values
        );
        dispatch(createApplicationLogRequest());

        promise.then(
            function (applicationLog): void {
                dispatch(createApplicationLogSuccess(applicationLog.data));
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
                dispatch(createApplicationLogFailure(error));
            }
        );

        return promise;
    };
}

export const createApplicationLogSuccess = (
    newApplicationLog: $TSFixMe
): void => {
    return {
        type: types.CREATE_APPLICATION_LOG_SUCCESS,
        payload: newApplicationLog,
    };
};

export const createApplicationLogRequest = (): void => {
    return {
        type: types.CREATE_APPLICATION_LOG_REQUEST,
    };
};

export const createApplicationLogFailure = (error: ErrorPayload): void => {
    return {
        type: types.CREATE_APPLICATION_LOG_FAILURE,
        payload: error,
    };
};

export const resetCreateApplicationLog = (): void => {
    return {
        type: types.CREATE_APPLICATION_LOG_RESET,
    };
};

export function fetchApplicationLogs(
    projectId: string,
    componentId: $TSFixMe,
    skip = 0,
    limit = 0,
    paginated = false
) {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(
            `application-log/${projectId}/${componentId}?skip=${skip}&limit=${limit}`
        );
        dispatch(fetchApplicationLogsRequest(paginated));

        promise.then(
            function (applicationLogs): void {
                dispatch(fetchApplicationLogsSuccess(applicationLogs.data));
            },
            function (error): void {
                dispatch(fetchApplicationLogsFailure(error));
            }
        );

        return promise;
    };
}

export const fetchApplicationLogsSuccess = (
    applicationLogs: $TSFixMe
): void => {
    return {
        type: types.FETCH_APPLICATION_LOGS_SUCCESS,
        payload: applicationLogs,
    };
};

export const fetchApplicationLogsRequest = (paginated: $TSFixMe): void => {
    return {
        type: types.FETCH_APPLICATION_LOGS_REQUEST,
        payload: paginated,
    };
};

export const fetchApplicationLogsFailure = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_APPLICATION_LOGS_FAILURE,
        payload: error,
    };
};

export const resetFetchApplicationLogs = (): void => {
    return {
        type: types.FETCH_APPLICATION_LOGS_RESET,
    };
};

//Delete a applicationLog
//props -> {name: '', type, data -> { data.url}}
export function deleteApplicationLog(
    projectId: string,
    componentId: $TSFixMe,
    applicationLogId: $TSFixMe
) {
    return function (dispatch: Dispatch): void {
        const promise =
            delete (`application-log/${projectId}/${componentId}/${applicationLogId}`,
            {
                applicationLogId,
            });
        dispatch(deleteApplicationLogRequest(applicationLogId));

        promise.then(
            function (applicationLog): void {
                dispatch(deleteApplicationLogSuccess(applicationLog.data._id));
            },
            function (error): void {
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

export const deleteApplicationLogSuccess = (
    removedApplicationLogId: $TSFixMe
) => {
    return {
        type: types.DELETE_APPLICATION_LOG_SUCCESS,
        payload: removedApplicationLogId,
    };
};

export const deleteApplicationLogRequest = (
    applicationLogId: $TSFixMe
): void => {
    return {
        type: types.DELETE_APPLICATION_LOG_REQUEST,
        payload: applicationLogId,
    };
};

export const deleteApplicationLogFailure = (error: ErrorPayload): void => {
    return {
        type: types.DELETE_APPLICATION_LOG_FAILURE,
        payload: error,
    };
};

export const deleteComponentApplicationLogs = (componentId: $TSFixMe): void => {
    return {
        type: types.DELETE_COMPONENT_APPLICATION_LOGS,
        payload: componentId,
    };
};

export function fetchLogs(
    projectId: string,
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
        const promise = BackendAPI.post(
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
            function (response): void {
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
            function (error): void {
                dispatch(fetchLogsFailure({ applicationLogId, error: error }));
            }
        );

        return promise;
    };
}

export const fetchLogsSuccess = (logs: $TSFixMe): void => {
    return {
        type: types.FETCH_LOGS_SUCCESS,
        payload: logs,
    };
};

export const fetchLogsRequest = (applicationLogId: $TSFixMe): void => {
    return {
        type: types.FETCH_LOGS_REQUEST,
        payload: applicationLogId,
    };
};

export const fetchLogsFailure = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_LOGS_FAILURE,
        payload: error,
    };
};
export const resetFetchLogs = (): void => {
    return {
        type: types.FETCH_LOGS_RESET,
    };
};

export function resetApplicationLogKey(
    projectId: string,
    componentId: $TSFixMe,
    applicationLogId: $TSFixMe
) {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(
            `application-log/${projectId}/${componentId}/${applicationLogId}/reset-key`
        );
        dispatch(resetApplicationLogKeyRequest());

        promise.then(
            function (applicationLog): void {
                dispatch(resetApplicationLogKeySuccess(applicationLog.data));
            },
            function (error): void {
                dispatch(resetApplicationLogKeyFailure(error));
            }
        );

        return promise;
    };
}

export const resetApplicationLogKeySuccess = (
    applicationLog: $TSFixMe
): void => {
    return {
        type: types.RESET_APPLICATION_LOG_KEY_SUCCESS,
        payload: applicationLog,
    };
};

export const resetApplicationLogKeyRequest = (): void => {
    return {
        type: types.RESET_APPLICATION_LOG_KEY_REQUEST,
    };
};

export const resetApplicationLogKeyFailure = (error: ErrorPayload): void => {
    return {
        type: types.RESET_APPLICATION_LOG_KEY_FAILURE,
        payload: error,
    };
};

export const resetresetApplicationLogKey = (): void => {
    return {
        type: types.RESET_APPLICATION_LOG_KEY_RESET,
    };
};
export const editApplicationLogSwitch = (index: $TSFixMe): void => {
    return {
        type: types.EDIT_APPLICATION_LOG_SWITCH,
        payload: index,
    };
};
//Edit new applicationLog
export function editApplicationLog(
    projectId: string,
    componentId: $TSFixMe,
    applicationLogId: $TSFixMe,
    values: $TSFixMe
) {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.put(
            `application-log/${projectId}/${componentId}/${applicationLogId}`,
            values
        );
        dispatch(editApplicationLogRequest());

        promise.then(
            function (applicationLog): void {
                dispatch(editApplicationLogSuccess(applicationLog.data));
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
                dispatch(editApplicationLogFailure(error));
            }
        );

        return promise;
    };
}

export const editApplicationLogSuccess = (
    newApplicationLog: $TSFixMe
): void => {
    return {
        type: types.EDIT_APPLICATION_LOG_SUCCESS,
        payload: newApplicationLog,
    };
};

export const editApplicationLogRequest = (): void => {
    return {
        type: types.EDIT_APPLICATION_LOG_REQUEST,
    };
};

export const editApplicationLogFailure = (error: ErrorPayload): void => {
    return {
        type: types.EDIT_APPLICATION_LOG_FAILURE,
        payload: error,
    };
};

export function fetchStats(
    projectId: string,
    componentId: $TSFixMe,
    applicationLogId: $TSFixMe
) {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(
            `application-log/${projectId}/${componentId}/${applicationLogId}/stats`,
            {}
        );
        dispatch(fetchStatsRequest({ applicationLogId }));

        promise.then(
            function (logs): void {
                dispatch(
                    fetchStatsSuccess({
                        applicationLogId,

                        stats: logs.data.data,
                    })
                );
            },
            function (error): void {
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

export const fetchStatsSuccess = (stats: $TSFixMe): void => {
    return {
        type: types.FETCH_LOG_STAT_SUCCESS,
        payload: stats,
    };
};

export const fetchStatsRequest = (applicationLogId: $TSFixMe): void => {
    return {
        type: types.FETCH_LOG_STAT_REQUEST,
        payload: applicationLogId,
    };
};

export const fetchStatsFailure = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_LOG_STAT_FAILURE,
        payload: error,
    };
};
export const resetFetchStats = (): void => {
    return {
        type: types.FETCH_LOG_STAT_RESET,
    };
};
export const getLogSuccess = (log: $TSFixMe): void => {
    return {
        type: types.GET_LOG_SUCCESS,
        payload: log,
    };
};

export function searchLog(
    projectId: string,
    componentId: $TSFixMe,
    applicationLogId: $TSFixMe,
    payload: $TSFixMe
) {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(
            `application-log/${projectId}/${componentId}/${applicationLogId}/search`,
            payload
        );
        dispatch(fetchLogsRequest({ applicationLogId }));
        promise.then(
            function (response): void {
                dispatch(
                    fetchLogsSuccess({
                        applicationLogId,

                        logs: response.data.searchedLogs,

                        count: response.data.totalSearchCount,
                    })
                );
            },
            function (error): void {
                dispatch(fetchLogsFailure({ applicationLogId, error: error }));
            }
        );
        return promise;
    };
}
