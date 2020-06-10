import { getApi } from '../api';
import * as types from '../constants/log';
import errors from '../errors';

export function fetchLogs(applicationLogId) {
    return function(dispatch) {
        const promise = getApi(`application-log/${applicationLogId}/logs`);
        dispatch(fetchLogsRequest());

        promise.then(
            function(logs) {
                dispatch(fetchLogsSuccess(logs.data));
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
                dispatch(fetchLogsFailure(errors(error)));
            }
        );

        return promise;
    };
}

export function fetchLogsSuccess(logs) {
    return {
        type: types.FETCH_LOGS_SUCCESS,
        payload: logs,
    };
}

export function fetchLogsRequest() {
    return {
        type: types.FETCH_LOGS_REQUEST,
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