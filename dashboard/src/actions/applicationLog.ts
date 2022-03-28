import BackendAPI from '../api';
import { Dispatch } from 'redux';
import * as types from '../constants/applicationLog';

//Create new log container
//props -> {name: '', type, data -> { data.url}}
export function createApplicationLog(
    projectId: $TSFixMe,
    componentId: $TSFixMe,
    values: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.post(
            `application-log/${projectId}/${componentId}/create`,
            values
        );
        dispatch(createApplicationLogRequest());

        promise.then(
            function (applicationLog) {
                dispatch(createApplicationLogSuccess(applicationLog.data));
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
                dispatch(createApplicationLogFailure(error));
            }
        );

        return promise;
    };
}

export const createApplicationLogSuccess = (newApplicationLog: $TSFixMe) => {
    return {
        type: types.CREATE_APPLICATION_LOG_SUCCESS,
        payload: newApplicationLog,
    };
};

export const createApplicationLogRequest = () => {
    return {
        type: types.CREATE_APPLICATION_LOG_REQUEST,
    };
};

export const createApplicationLogFailure = (error: $TSFixMe) => {
    return {
        type: types.CREATE_APPLICATION_LOG_FAILURE,
        payload: error,
    };
};

export const resetCreateApplicationLog = () => {
    return {
        type: types.CREATE_APPLICATION_LOG_RESET,
    };
};

export function fetchApplicationLogs(
    projectId: $TSFixMe,
    componentId: $TSFixMe,
    skip = 0,
    limit = 0,
    paginated = false
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(
            `application-log/${projectId}/${componentId}?skip=${skip}&limit=${limit}`
        );
        dispatch(fetchApplicationLogsRequest(paginated));

        promise.then(
            function (applicationLogs) {
                dispatch(fetchApplicationLogsSuccess(applicationLogs.data));
            },
            function (error) {

                dispatch(fetchApplicationLogsFailure(error));
            }
        );

        return promise;
    };
}

export const fetchApplicationLogsSuccess = (applicationLogs: $TSFixMe) => {
    return {
        type: types.FETCH_APPLICATION_LOGS_SUCCESS,
        payload: applicationLogs,
    };
};

export const fetchApplicationLogsRequest = (paginated: $TSFixMe) => {
    return {
        type: types.FETCH_APPLICATION_LOGS_REQUEST,
        payload: paginated,
    };
};

export const fetchApplicationLogsFailure = (error: $TSFixMe) => {
    return {
        type: types.FETCH_APPLICATION_LOGS_FAILURE,
        payload: error,
    };
};

export const resetFetchApplicationLogs = () => {
    return {
        type: types.FETCH_APPLICATION_LOGS_RESET,
    };
};

//Delete a applicationLog
//props -> {name: '', type, data -> { data.url}}
export function deleteApplicationLog(
    projectId: $TSFixMe,
    componentId: $TSFixMe,
    applicationLogId: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise =
            delete (`application-log/${projectId}/${componentId}/${applicationLogId}`,
            {
                applicationLogId,
            });
        dispatch(deleteApplicationLogRequest(applicationLogId));

        promise.then(
            function (applicationLog) {
                dispatch(deleteApplicationLogSuccess(applicationLog.data._id));
            },
            function (error) {

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

export const deleteApplicationLogRequest = (applicationLogId: $TSFixMe) => {
    return {
        type: types.DELETE_APPLICATION_LOG_REQUEST,
        payload: applicationLogId,
    };
};

export const deleteApplicationLogFailure = (error: $TSFixMe) => {
    return {
        type: types.DELETE_APPLICATION_LOG_FAILURE,
        payload: error,
    };
};

export const deleteComponentApplicationLogs = (componentId: $TSFixMe) => {
    return {
        type: types.DELETE_COMPONENT_APPLICATION_LOGS,
        payload: componentId,
    };
};

export function fetchLogs(
    projectId: $TSFixMe,
    componentId: $TSFixMe,
    applicationLogId: $TSFixMe,
    skip: $TSFixMe,
    limit: $TSFixMe,
    startDate: $TSFixMe,
    endDate: $TSFixMe,
    type: $TSFixMe,
    filter: $TSFixMe
) {
    return function (dispatch: Dispatch) {
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
            function (response) {
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
            function (error) {

                dispatch(fetchLogsFailure({ applicationLogId, error: error }));
            }
        );

        return promise;
    };
}

export const fetchLogsSuccess = (logs: $TSFixMe) => {
    return {
        type: types.FETCH_LOGS_SUCCESS,
        payload: logs,
    };
};

export const fetchLogsRequest = (applicationLogId: $TSFixMe) => {
    return {
        type: types.FETCH_LOGS_REQUEST,
        payload: applicationLogId,
    };
};

export const fetchLogsFailure = (error: $TSFixMe) => {
    return {
        type: types.FETCH_LOGS_FAILURE,
        payload: error,
    };
};
export const resetFetchLogs = () => {
    return {
        type: types.FETCH_LOGS_RESET,
    };
};

export function resetApplicationLogKey(
    projectId: $TSFixMe,
    componentId: $TSFixMe,
    applicationLogId: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.post(
            `application-log/${projectId}/${componentId}/${applicationLogId}/reset-key`
        );
        dispatch(resetApplicationLogKeyRequest());

        promise.then(
            function (applicationLog) {
                dispatch(resetApplicationLogKeySuccess(applicationLog.data));
            },
            function (error) {

                dispatch(resetApplicationLogKeyFailure(error));
            }
        );

        return promise;
    };
}

export const resetApplicationLogKeySuccess = (applicationLog: $TSFixMe) => {
    return {
        type: types.RESET_APPLICATION_LOG_KEY_SUCCESS,
        payload: applicationLog,
    };
};

export const resetApplicationLogKeyRequest = () => {
    return {
        type: types.RESET_APPLICATION_LOG_KEY_REQUEST,
    };
};

export const resetApplicationLogKeyFailure = (error: $TSFixMe) => {
    return {
        type: types.RESET_APPLICATION_LOG_KEY_FAILURE,
        payload: error,
    };
};

export const resetresetApplicationLogKey = () => {
    return {
        type: types.RESET_APPLICATION_LOG_KEY_RESET,
    };
};
export const editApplicationLogSwitch = (index: $TSFixMe) => {
    return {
        type: types.EDIT_APPLICATION_LOG_SWITCH,
        payload: index,
    };
};
//Edit new applicationLog
export function editApplicationLog(
    projectId: $TSFixMe,
    componentId: $TSFixMe,
    applicationLogId: $TSFixMe,
    values: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.put(
            `application-log/${projectId}/${componentId}/${applicationLogId}`,
            values
        );
        dispatch(editApplicationLogRequest());

        promise.then(
            function (applicationLog) {
                dispatch(editApplicationLogSuccess(applicationLog.data));
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
                dispatch(editApplicationLogFailure(error));
            }
        );

        return promise;
    };
}

export const editApplicationLogSuccess = (newApplicationLog: $TSFixMe) => {
    return {
        type: types.EDIT_APPLICATION_LOG_SUCCESS,
        payload: newApplicationLog,
    };
};

export const editApplicationLogRequest = () => {
    return {
        type: types.EDIT_APPLICATION_LOG_REQUEST,
    };
};

export const editApplicationLogFailure = (error: $TSFixMe) => {
    return {
        type: types.EDIT_APPLICATION_LOG_FAILURE,
        payload: error,
    };
};

export function fetchStats(
    projectId: $TSFixMe,
    componentId: $TSFixMe,
    applicationLogId: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.post(
            `application-log/${projectId}/${componentId}/${applicationLogId}/stats`,
            {}
        );
        dispatch(fetchStatsRequest({ applicationLogId }));

        promise.then(
            function (logs) {
                dispatch(
                    fetchStatsSuccess({
                        applicationLogId,

                        stats: logs.data.data,
                    })
                );
            },
            function (error) {

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

export const fetchStatsSuccess = (stats: $TSFixMe) => {
    return {
        type: types.FETCH_LOG_STAT_SUCCESS,
        payload: stats,
    };
};

export const fetchStatsRequest = (applicationLogId: $TSFixMe) => {
    return {
        type: types.FETCH_LOG_STAT_REQUEST,
        payload: applicationLogId,
    };
};

export const fetchStatsFailure = (error: $TSFixMe) => {
    return {
        type: types.FETCH_LOG_STAT_FAILURE,
        payload: error,
    };
};
export const resetFetchStats = () => {
    return {
        type: types.FETCH_LOG_STAT_RESET,
    };
};
export const getLogSuccess = (log: $TSFixMe) => {
    return {
        type: types.GET_LOG_SUCCESS,
        payload: log,
    };
};

export function searchLog(
    projectId: $TSFixMe,
    componentId: $TSFixMe,
    applicationLogId: $TSFixMe,
    payload: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.post(
            `application-log/${projectId}/${componentId}/${applicationLogId}/search`,
            payload
        );
        dispatch(fetchLogsRequest({ applicationLogId }));
        promise.then(
            function (response) {
                dispatch(
                    fetchLogsSuccess({
                        applicationLogId,

                        logs: response.data.searchedLogs,

                        count: response.data.totalSearchCount,
                    })
                );
            },
            function (error) {

                dispatch(fetchLogsFailure({ applicationLogId, error: error }));
            }
        );
        return promise;
    };
}
