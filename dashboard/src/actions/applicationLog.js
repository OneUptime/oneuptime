import { postApi, getApi, deleteApi } from '../api';
import * as types from '../constants/applicationLog';
import errors from '../errors';

//Create new application log
//props -> {name: '', type, data -> { data.url}}
export function createApplicationLog(componentId, values) {
    return function (dispatch) {
        const promise = postApi(`application-log/${componentId}`, values);
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
                dispatch(createApplicationLogFailure(errors(error)));
            }
        );

        return promise;
    };
}

export function createApplicationLogSuccess(newApplicationLog) {
    return {
        type: types.CREATE_APPLICATION_LOG_SUCCESS,
        payload: newApplicationLog,
    };
}

export function createApplicationLogRequest() {
    return {
        type: types.CREATE_APPLICATION_LOG_REQUEST,
    };
}

export function createApplicationLogFailure(error) {
    return {
        type: types.CREATE_APPLICATION_LOG_FAILURE,
        payload: error,
    };
}

export function resetCreateApplicationLog() {
    return {
        type: types.CREATE_APPLICATION_LOG_RESET,
    };
}

export function fetchApplicationLogs(componentId) {
    return function (dispatch) {
        const promise = getApi(`application-log/${componentId}`);
        dispatch(fetchApplicationLogsRequest());

        promise.then(
            function (applicationLogs) {
                dispatch(fetchApplicationLogsSuccess(applicationLogs.data));
            },
            function (error) {
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
                dispatch(fetchApplicationLogsFailure(errors(error)));
            }
        );

        return promise;
    };
}

export function fetchApplicationLogsSuccess(applicationLogs) {
    return {
        type: types.FETCH_APPLICATION_LOGS_SUCCESS,
        payload: applicationLogs,
    };
}

export function fetchApplicationLogsRequest() {
    return {
        type: types.FETCH_APPLICATION_LOGS_REQUEST,
    };
}

export function fetchApplicationLogsFailure(error) {
    return {
        type: types.FETCH_APPLICATION_LOGS_FAILURE,
        payload: error,
    };
}

export function resetFetchApplicationLogs() {
    return {
        type: types.FETCH_APPLICATION_LOGS_RESET,
    };
}

//Delete a applicationLog
//props -> {name: '', type, data -> { data.url}}
export function deleteApplicationLog(applicationLogId, componentId) {
    return function (dispatch) {
        const promise = deleteApi(
            `application-log/${componentId}/${applicationLogId}`,
            {
                applicationLogId,
            }
        );
        dispatch(deleteApplicationLogRequest(applicationLogId));

        promise.then(
            function (applicationLog) {
                dispatch(deleteApplicationLogSuccess(applicationLog.data._id));
            },
            function (error) {
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
                dispatch(
                    deleteApplicationLogFailure({
                        error: errors(error),
                        applicationLogId,
                    })
                );
            }
        );

        return promise;
    };
}

export function deleteApplicationLogSuccess(removedApplicationLogId) {
    return {
        type: types.DELETE_APPLICATION_LOG_SUCCESS,
        payload: removedApplicationLogId,
    };
}

export function deleteApplicationLogRequest(applicationLogId) {
    return {
        type: types.DELETE_APPLICATION_LOG_REQUEST,
        payload: applicationLogId,
    };
}

export function deleteApplicationLogFailure(error) {
    return {
        type: types.DELETE_APPLICATION_LOG_FAILURE,
        payload: error,
    };
}

export function deleteComponentApplicationLogs(componentId) {
    return {
        type: types.DELETE_COMPONENT_APPLICATION_LOGS,
        payload: componentId,
    };
}

export function fetchLogs(applicationLogId, skip, limit, startDate, endDate) {
    return function (dispatch) {
        const promise = postApi(`application-log/${applicationLogId}/logs`, {
            skip,
            limit,
            startDate,
            endDate,
        });
        dispatch(fetchLogsRequest({ applicationLogId }));

        promise.then(
            function (logs) {
                dispatch(
                    fetchLogsSuccess({
                        applicationLogId,
                        logs: logs.data.data,
                        skip,
                        limit,
                        count: logs.data.count,
                    })
                );
            },
            function (error) {
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
                dispatch(fetchLogsFailure({ applicationLogId, error: errors(error) }));
            }
        );

        return promise;
    };
}

export function fetchLogsSuccess(logs) {
    return {
        type: types.FETCH_LOGS_SUCCESS,
        payload: logs ,
    };
}

export function fetchLogsRequest(applicationLogId) {
    return {
        type: types.FETCH_LOGS_REQUEST,
        payload: applicationLogId
    };
}

export function fetchLogsFailure(error) {
    return {
        type: types.FETCH_LOGS_FAILURE,
        payload: error,
    };
}
export function resetFetchLogs() {
    return {
        type: types.FETCH_LOGS_RESET,
    };
}
