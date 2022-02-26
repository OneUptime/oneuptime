import { getApi, postApi, deleteApi } from '../api';
import * as types from '../constants/smsLogs';
import errors from '../errors';

// Fetch All Sms Logs
export const fetchSmsLogsRequest = () => {
    return {
        type: types.FETCH_SMSLOGS_REQUEST,
    };
};

export const fetchSmsLogsSuccess = (smsLogs: $TSFixMe) => {
    return {
        type: types.FETCH_SMSLOGS_SUCCESS,
        payload: smsLogs,
    };
};

export const fetchSmsLogsError = (error: $TSFixMe) => {
    return {
        type: types.FETCH_SMSLOGS_FAILURE,
        payload: error,
    };
};

export const fetchSmsLogs = (skip: $TSFixMe, limit: $TSFixMe) => async (dispatch: $TSFixMe) => {
    skip = skip ? parseInt(skip) : 0;
    limit = limit ? parseInt(limit) : 10;

    dispatch(fetchSmsLogsRequest());

    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
        const response = await getApi(`sms-logs?skip=${skip}&limit=${limit}`);
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
        const data = response.data;

        dispatch(fetchSmsLogsSuccess(data));

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
        dispatch(fetchSmsLogsError(errors(errorMsg)));
    }
};

// Search Sms Logs.
export const searchSmsLogsRequest = () => {
    return {
        type: types.SEARCH_SMSLOGS_REQUEST,
    };
};

export const searchSmsLogsSuccess = (smsLogs: $TSFixMe) => {
    return {
        type: types.SEARCH_SMSLOGS_SUCCESS,
        payload: smsLogs,
    };
};

export const searchSmsLogsError = (error: $TSFixMe) => {
    return {
        type: types.SEARCH_SMSLOGS_FAILURE,
        payload: error,
    };
};

export const searchSmsLogs = (filter: $TSFixMe, skip: $TSFixMe, limit: $TSFixMe) => async (dispatch: $TSFixMe) => {
    const values = {
        filter,
    };

    dispatch(searchSmsLogsRequest());

    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        const response = await postApi(
            `sms-logs/search?skip=${skip}&limit=${limit}`,
            values
        );
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
        const data = response.data;

        dispatch(searchSmsLogsSuccess(data));
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
        dispatch(searchSmsLogsError(errors(errorMsg)));
    }
};

// Delete All Sms Logs
export const deleteSmsLogsRequest = () => {
    return {
        type: types.DELETE_ALL_SMSLOGS_REQUEST,
    };
};

export const deleteSmsLogsSuccess = (message: $TSFixMe) => {
    return {
        type: types.DELETE_ALL_SMSLOGS_SUCCESS,
        payload: message,
    };
};

export const deleteSmsLogsError = (error: $TSFixMe) => {
    return {
        type: types.DELETE_ALL_SMSLOGS_FAILURE,
        payload: error,
    };
};

export const deleteSmsLogs = () => async (dispatch: $TSFixMe) => {
    dispatch(deleteSmsLogsRequest());

    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
        const response = await deleteApi(`sms-logs`);
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
        const message = response.data.message;

        dispatch(deleteSmsLogsSuccess(message));
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
        dispatch(deleteSmsLogsError(errors(errorMsg)));
    }
};

// fetch smsLogStatus

export function fetchSmsLogStatusRequest(promise: $TSFixMe) {
    return {
        type: types.FETCH_SMSLOG_STATUS_REQUEST,
        payload: promise,
    };
}

export function fetchSmsLogStatusError(error: $TSFixMe) {
    return {
        type: types.FETCH_SMSLOG_STATUS_FAILED,
        payload: error,
    };
}

export function fetchSmsLogStatusSuccess(smsLogStatus: $TSFixMe) {
    return {
        type: types.FETCH_SMSLOG_STATUS_SUCCESS,
        payload: smsLogStatus,
    };
}

export const resetFetchSmsLogStatus = () => {
    return {
        type: types.FETCH_SMSLOG_STATUS_RESET,
    };
};

// Calls the API to fetch smsLogStatus
export const fetchSmsLogStatus = () => async (dispatch: $TSFixMe) => {
    // @ts-expect-error ts-migrate(2554) FIXME: Expected 1 arguments, but got 0.
    dispatch(fetchSmsLogStatusRequest());

    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
        const response = await getApi('globalConfig/smsLogMonitoringStatus');
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
        dispatch(fetchSmsLogStatusSuccess(response.data));
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
        dispatch(fetchSmsLogStatusError(errors(errorMsg)));
        return 'error';
    }
};

// change smsLogStatus

export function changeSmsLogStatusRequest(promise: $TSFixMe) {
    return {
        type: types.CHANGE_SMSLOG_STATUS_REQUEST,
        payload: promise,
    };
}

export function changeSmsLogStatusError(error: $TSFixMe) {
    return {
        type: types.CHANGE_SMSLOG_STATUS_FAILED,
        payload: error,
    };
}

export function changeSmsLogStatusSuccess(smsLogStatus: $TSFixMe) {
    return {
        type: types.CHANGE_SMSLOG_STATUS_SUCCESS,
        payload: smsLogStatus,
    };
}

export const resetConfirmSmsLogStatus = () => {
    return {
        type: types.CHANGE_SMSLOG_STATUS_RESET,
    };
};

// Calls the API to change smsLogStatus
export const smsLogStatusChange = (values: $TSFixMe) => async (dispatch: $TSFixMe) => {
    // @ts-expect-error ts-migrate(2554) FIXME: Expected 1 arguments, but got 0.
    dispatch(changeSmsLogStatusRequest());

    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        const response = await postApi('globalConfig/', [
            { name: 'smsLogMonitoringStatus', value: values.status },
        ]);
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
        const data = response.data;
        dispatch(changeSmsLogStatusSuccess(data));
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
        dispatch(changeSmsLogStatusError(errors(errorMsg)));
        return 'error';
    }
};
