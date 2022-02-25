import { getApi, postApi, deleteApi } from '../api';
import * as types from '../constants/callLogs';
import errors from '../errors';

// Fetch All Call Logs
export const fetchCallLogsRequest = () => {
    return {
        type: types.FETCH_CALLLOGS_REQUEST,
    };
};

export const fetchCallLogsSuccess = callLogs => {
    return {
        type: types.FETCH_CALLLOGS_SUCCESS,
        payload: callLogs,
    };
};

export const fetchCallLogsError = error => {
    return {
        type: types.FETCH_CALLLOGS_FAILURE,
        payload: error,
    };
};

export const fetchCallLogs = (skip, limit) => async dispatch => {
    skip = skip ? parseInt(skip) : 0;
    limit = limit ? parseInt(limit) : 10;

    dispatch(fetchCallLogsRequest());

    try {
        const response = await getApi(`call-logs?skip=${skip}&limit=${limit}`);
        const data = response.data;

        dispatch(fetchCallLogsSuccess(data));

        return response;
    } catch (error) {
        let errorMsg;
        if (error && error.response && error.response.data)
            errorMsg = error.response.data;
        if (error && error.data) {
            errorMsg = error.data;
        }
        if (error && error.message) {
            errorMsg = error.message;
        } else {
            errorMsg = 'Network Error';
        }
        dispatch(fetchCallLogsError(errors(errorMsg)));
    }
};

// Search Call Logs.
export const searchCallLogsRequest = () => {
    return {
        type: types.SEARCH_CALLLOGS_REQUEST,
    };
};

export const searchCallLogsSuccess = callLogs => {
    return {
        type: types.SEARCH_CALLLOGS_SUCCESS,
        payload: callLogs,
    };
};

export const searchCallLogsError = error => {
    return {
        type: types.SEARCH_CALLLOGS_FAILURE,
        payload: error,
    };
};

export const searchCallLogs = (filter, skip, limit) => async dispatch => {
    const values = {
        filter,
    };

    dispatch(searchCallLogsRequest());

    try {
        const response = await postApi(
            `call-logs/search?skip=${skip}&limit=${limit}`,
            values
        );
        const data = response.data;

        dispatch(searchCallLogsSuccess(data));
        return response;
    } catch (error) {
        let errorMsg;
        if (error && error.response && error.response.data)
            errorMsg = error.response.data;
        if (error && error.data) {
            errorMsg = error.data;
        }
        if (error && error.message) {
            errorMsg = error.message;
        } else {
            errorMsg = 'Network Error';
        }
        dispatch(searchCallLogsError(errors(errorMsg)));
    }
};

// Delete All Call Logs
export const deleteCallLogsRequest = () => {
    return {
        type: types.DELETE_ALL_CALLLOGS_REQUEST,
    };
};

export const deleteCallLogsSuccess = message => {
    return {
        type: types.DELETE_ALL_CALLLOGS_SUCCESS,
        payload: message,
    };
};

export const deleteCallLogsError = error => {
    return {
        type: types.DELETE_ALL_CALLLOGS_FAILURE,
        payload: error,
    };
};

export const deleteCallLogs = () => async dispatch => {
    dispatch(deleteCallLogsRequest());

    try {
        const response = await deleteApi(`call-logs`);
        const message = response.data.message;

        dispatch(deleteCallLogsSuccess(message));
    } catch (error) {
        let errorMsg;
        if (error && error.response && error.response.data)
            errorMsg = error.response.data;
        if (error && error.data) {
            errorMsg = error.data;
        }
        if (error && error.message) {
            errorMsg = error.message;
        } else {
            errorMsg = 'Network Error';
        }
        dispatch(deleteCallLogsError(errors(errorMsg)));
    }
};

// fetch callLogStatus

export function fetchCallLogStatusRequest(promise) {
    return {
        type: types.FETCH_CALLLOG_STATUS_REQUEST,
        payload: promise,
    };
}

export function fetchCallLogStatusError(error) {
    return {
        type: types.FETCH_CALLLOG_STATUS_FAILED,
        payload: error,
    };
}

export function fetchCallLogStatusSuccess(callLogStatus) {
    return {
        type: types.FETCH_CALLLOG_STATUS_SUCCESS,
        payload: callLogStatus,
    };
}

export const resetFetchCallLogStatus = () => {
    return {
        type: types.FETCH_CALLLOG_STATUS_RESET,
    };
};

// Calls the API to fetch callLogStatus
export const fetchCallLogStatus = () => async dispatch => {
    dispatch(fetchCallLogStatusRequest());

    try {
        const response = await getApi('globalConfig/callLogMonitoringStatus');
        dispatch(fetchCallLogStatusSuccess(response.data));
        return response;
    } catch (error) {
        let errorMsg;
        if (error && error.response && error.response.data)
            errorMsg = error.response.data;
        if (error && error.data) {
            errorMsg = error.data;
        }
        if (error && error.message) {
            errorMsg = error.message;
        } else {
            errorMsg = 'Network Error';
        }
        dispatch(fetchCallLogStatusError(errors(errorMsg)));
        return 'error';
    }
};

// change callLogStatus

export function changeCallLogStatusRequest(promise) {
    return {
        type: types.CHANGE_CALLLOG_STATUS_REQUEST,
        payload: promise,
    };
}

export function changeCallLogStatusError(error) {
    return {
        type: types.CHANGE_CALLLOG_STATUS_FAILED,
        payload: error,
    };
}

export function changeCallLogStatusSuccess(callLogStatus) {
    return {
        type: types.CHANGE_CALLLOG_STATUS_SUCCESS,
        payload: callLogStatus,
    };
}

export const resetConfirmCallLogStatus = () => {
    return {
        type: types.CHANGE_CALLLOG_STATUS_RESET,
    };
};

// Calls the API to change callLogStatus
export const callLogStatusChange = values => async dispatch => {
    dispatch(changeCallLogStatusRequest());

    try {
        const response = await postApi('globalConfig/', [
            { name: 'callLogMonitoringStatus', value: values.status },
        ]);
        const data = response.data;
        dispatch(changeCallLogStatusSuccess(data));
        return data;
    } catch (error) {
        let errorMsg;
        if (error && error.response && error.response.data)
            errorMsg = error.response.data;
        if (error && error.data) {
            errorMsg = error.data;
        }
        if (error && error.message) {
            errorMsg = error.message;
        } else {
            errorMsg = 'Network Error';
        }
        dispatch(changeCallLogStatusError(errors(errorMsg)));
        return 'error';
    }
};
