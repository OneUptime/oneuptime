import { getApi, postApi, deleteApi } from '../api';
import * as types from '../constants/callLogs';
import errors from '../errors';

// Fetch All Call Logs
export const fetchCallLogsRequest = () => {
    return {
        type: types.FETCH_CALLLOGS_REQUEST,
    };
};

export const fetchCallLogsSuccess = (callLogs: $TSFixMe) => {
    return {
        type: types.FETCH_CALLLOGS_SUCCESS,
        payload: callLogs,
    };
};

export const fetchCallLogsError = (error: $TSFixMe) => {
    return {
        type: types.FETCH_CALLLOGS_FAILURE,
        payload: error,
    };
};

export const fetchCallLogs = (skip: $TSFixMe, limit: $TSFixMe) => async (dispatch: $TSFixMe) => {
    skip = skip ? parseInt(skip) : 0;
    limit = limit ? parseInt(limit) : 10;

    dispatch(fetchCallLogsRequest());

    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
        const response = await getApi(`call-logs?skip=${skip}&limit=${limit}`);
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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

export const searchCallLogsSuccess = (callLogs: $TSFixMe) => {
    return {
        type: types.SEARCH_CALLLOGS_SUCCESS,
        payload: callLogs,
    };
};

export const searchCallLogsError = (error: $TSFixMe) => {
    return {
        type: types.SEARCH_CALLLOGS_FAILURE,
        payload: error,
    };
};

export const searchCallLogs = (filter: $TSFixMe, skip: $TSFixMe, limit: $TSFixMe) => async (dispatch: $TSFixMe) => {
    const values = {
        filter,
    };

    dispatch(searchCallLogsRequest());

    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        const response = await postApi(
            `call-logs/search?skip=${skip}&limit=${limit}`,
            values
        );
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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

export const deleteCallLogsSuccess = (message: $TSFixMe) => {
    return {
        type: types.DELETE_ALL_CALLLOGS_SUCCESS,
        payload: message,
    };
};

export const deleteCallLogsError = (error: $TSFixMe) => {
    return {
        type: types.DELETE_ALL_CALLLOGS_FAILURE,
        payload: error,
    };
};

export const deleteCallLogs = () => async (dispatch: $TSFixMe) => {
    dispatch(deleteCallLogsRequest());

    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
        const response = await deleteApi(`call-logs`);
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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

export function fetchCallLogStatusRequest(promise: $TSFixMe) {
    return {
        type: types.FETCH_CALLLOG_STATUS_REQUEST,
        payload: promise,
    };
}

export function fetchCallLogStatusError(error: $TSFixMe) {
    return {
        type: types.FETCH_CALLLOG_STATUS_FAILED,
        payload: error,
    };
}

export function fetchCallLogStatusSuccess(callLogStatus: $TSFixMe) {
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
export const fetchCallLogStatus = () => async (dispatch: $TSFixMe) => {
    // @ts-expect-error ts-migrate(2554) FIXME: Expected 1 arguments, but got 0.
    dispatch(fetchCallLogStatusRequest());

    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
        const response = await getApi('globalConfig/callLogMonitoringStatus');
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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

export function changeCallLogStatusRequest(promise: $TSFixMe) {
    return {
        type: types.CHANGE_CALLLOG_STATUS_REQUEST,
        payload: promise,
    };
}

export function changeCallLogStatusError(error: $TSFixMe) {
    return {
        type: types.CHANGE_CALLLOG_STATUS_FAILED,
        payload: error,
    };
}

export function changeCallLogStatusSuccess(callLogStatus: $TSFixMe) {
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
export const callLogStatusChange = (values: $TSFixMe) => async (dispatch: $TSFixMe) => {
    // @ts-expect-error ts-migrate(2554) FIXME: Expected 1 arguments, but got 0.
    dispatch(changeCallLogStatusRequest());

    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        const response = await postApi('globalConfig/', [
            { name: 'callLogMonitoringStatus', value: values.status },
        ]);
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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
