import { getApi, postApi, deleteApi } from '../api';
import * as types from '../constants/emailLogs';
import errors from '../errors';

// Fetch All Email Logs
export const fetchEmailLogsRequest = () => {
    return {
        type: types.FETCH_EMAILLOGS_REQUEST,
    };
};

export const fetchEmailLogsSuccess = emailLogs => {
    return {
        type: types.FETCH_EMAILLOGS_SUCCESS,
        payload: emailLogs,
    };
};

export const fetchEmailLogsError = error => {
    return {
        type: types.FETCH_EMAILLOGS_FAILURE,
        payload: error,
    };
};

export const fetchEmailLogs = (skip, limit) => async dispatch => {
    skip = skip ? parseInt(skip) : 0;
    limit = limit ? parseInt(limit) : 10;

    dispatch(fetchEmailLogsRequest());

    try {
        const response = await getApi(`email-logs?skip=${skip}&limit=${limit}`);
        const data = response.data;

        dispatch(fetchEmailLogsSuccess(data));

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
        dispatch(fetchEmailLogsError(errors(errorMsg)));
    }
};

// Search Email Logs.
export const searchEmailLogsRequest = () => {
    return {
        type: types.SEARCH_EMAILLOGS_REQUEST,
    };
};

export const searchEmailLogsSuccess = emailLogs => {
    return {
        type: types.SEARCH_EMAILLOGS_SUCCESS,
        payload: emailLogs,
    };
};

export const searchEmailLogsError = error => {
    return {
        type: types.SEARCH_EMAILLOGS_FAILURE,
        payload: error,
    };
};

export const searchEmailLogs = (filter, skip, limit) => async dispatch => {
    const values = {
        filter,
    };

    dispatch(searchEmailLogsRequest());

    try {
        const response = await postApi(
            `email-logs/search?skip=${skip}&limit=${limit}`,
            values
        );
        const data = response.data;

        dispatch(searchEmailLogsSuccess(data));
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
        dispatch(searchEmailLogsError(errors(errorMsg)));
    }
};

// Delete All Email Logs
export const deleteEmailLogsRequest = () => {
    return {
        type: types.DELETE_ALL_EMAILLOGS_REQUEST,
    };
};

export const deleteEmailLogsSuccess = message => {
    return {
        type: types.DELETE_ALL_EMAILLOGS_SUCCESS,
        payload: message,
    };
};

export const deleteEmailLogsError = error => {
    return {
        type: types.DELETE_ALL_EMAILLOGS_FAILURE,
        payload: error,
    };
};

export const deleteEmailLogs = () => async dispatch => {
    dispatch(deleteEmailLogsRequest());

    try {
        const response = await deleteApi(`email-logs`);
        const message = response.data.message;

        dispatch(deleteEmailLogsSuccess(message));
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
        dispatch(deleteEmailLogsError(errors(errorMsg)));
    }
};

// fetch emailLogStatus

export function fetchEmailLogStatusRequest(promise) {
    return {
        type: types.FETCH_EMAILLOG_STATUS_REQUEST,
        payload: promise,
    };
}

export function fetchEmailLogStatusError(error) {
    return {
        type: types.FETCH_EMAILLOG_STATUS_FAILED,
        payload: error,
    };
}

export function fetchEmailLogStatusSuccess(emailLogStatus) {
    return {
        type: types.FETCH_EMAILLOG_STATUS_SUCCESS,
        payload: emailLogStatus,
    };
}

export const resetFetchEmailLogStatus = () => {
    return {
        type: types.FETCH_EMAILLOG_STATUS_RESET,
    };
};

// Calls the API to fetch emailLogStatus
export const fetchEmailLogStatus = () => async dispatch => {
    dispatch(fetchEmailLogStatusRequest());

    try {
        const response = await getApi('globalConfig/emailLogMonitoringStatus');
        dispatch(fetchEmailLogStatusSuccess(response.data));
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
        dispatch(fetchEmailLogStatusError(errors(errorMsg)));
        return 'error';
    }
};

// change emailLogStatus

export function changeEmailLogStatusRequest(promise) {
    return {
        type: types.CHANGE_EMAILLOG_STATUS_REQUEST,
        payload: promise,
    };
}

export function changeEmailLogStatusError(error) {
    return {
        type: types.CHANGE_EMAILLOG_STATUS_FAILED,
        payload: error,
    };
}

export function changeEmailLogStatusSuccess(emailLogStatus) {
    return {
        type: types.CHANGE_EMAILLOG_STATUS_SUCCESS,
        payload: emailLogStatus,
    };
}

export const resetConfirmEmailLogStatus = () => {
    return {
        type: types.CHANGE_EMAILLOG_STATUS_RESET,
    };
};

// Calls the API to change emailLogStatus
export const emailLogStatusChange = values => async dispatch => {
    dispatch(changeEmailLogStatusRequest());

    try {
        const response = await postApi('globalConfig/', [
            { name: 'emailLogMonitoringStatus', value: values.status },
        ]);
        const data = response.data;
        dispatch(changeEmailLogStatusSuccess(data));
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
        dispatch(changeEmailLogStatusError(errors(errorMsg)));
        return 'error';
    }
};
