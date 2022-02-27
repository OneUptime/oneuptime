import { getApi, postApi, deleteApi } from '../api';
import * as types from '../constants/emailLogs';
import errors from '../errors';

// Fetch All Email Logs
export const fetchEmailLogsRequest = () => {
    return {
        type: types.FETCH_EMAILLOGS_REQUEST,
    };
};

export const fetchEmailLogsSuccess = (emailLogs: $TSFixMe) => {
    return {
        type: types.FETCH_EMAILLOGS_SUCCESS,
        payload: emailLogs,
    };
};

export const fetchEmailLogsError = (error: $TSFixMe) => {
    return {
        type: types.FETCH_EMAILLOGS_FAILURE,
        payload: error,
    };
};

export const fetchEmailLogs = (skip: $TSFixMe, limit: $TSFixMe) => async (
    dispatch: $TSFixMe
) => {
    skip = skip ? parseInt(skip) : 0;
    limit = limit ? parseInt(limit) : 10;

    dispatch(fetchEmailLogsRequest());

    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
        const response = await getApi(`email-logs?skip=${skip}&limit=${limit}`);
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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

export const searchEmailLogsSuccess = (emailLogs: $TSFixMe) => {
    return {
        type: types.SEARCH_EMAILLOGS_SUCCESS,
        payload: emailLogs,
    };
};

export const searchEmailLogsError = (error: $TSFixMe) => {
    return {
        type: types.SEARCH_EMAILLOGS_FAILURE,
        payload: error,
    };
};

export const searchEmailLogs = (
    filter: $TSFixMe,
    skip: $TSFixMe,
    limit: $TSFixMe
) => async (dispatch: $TSFixMe) => {
    const values = {
        filter,
    };

    dispatch(searchEmailLogsRequest());

    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        const response = await postApi(
            `email-logs/search?skip=${skip}&limit=${limit}`,
            values
        );
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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

export const deleteEmailLogsSuccess = (message: $TSFixMe) => {
    return {
        type: types.DELETE_ALL_EMAILLOGS_SUCCESS,
        payload: message,
    };
};

export const deleteEmailLogsError = (error: $TSFixMe) => {
    return {
        type: types.DELETE_ALL_EMAILLOGS_FAILURE,
        payload: error,
    };
};

export const deleteEmailLogs = () => async (dispatch: $TSFixMe) => {
    dispatch(deleteEmailLogsRequest());

    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
        const response = await deleteApi(`email-logs`);
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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

export function fetchEmailLogStatusRequest(promise: $TSFixMe) {
    return {
        type: types.FETCH_EMAILLOG_STATUS_REQUEST,
        payload: promise,
    };
}

export function fetchEmailLogStatusError(error: $TSFixMe) {
    return {
        type: types.FETCH_EMAILLOG_STATUS_FAILED,
        payload: error,
    };
}

export function fetchEmailLogStatusSuccess(emailLogStatus: $TSFixMe) {
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
export const fetchEmailLogStatus = () => async (dispatch: $TSFixMe) => {
    // @ts-expect-error ts-migrate(2554) FIXME: Expected 1 arguments, but got 0.
    dispatch(fetchEmailLogStatusRequest());

    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
        const response = await getApi('globalConfig/emailLogMonitoringStatus');
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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

export function changeEmailLogStatusRequest(promise: $TSFixMe) {
    return {
        type: types.CHANGE_EMAILLOG_STATUS_REQUEST,
        payload: promise,
    };
}

export function changeEmailLogStatusError(error: $TSFixMe) {
    return {
        type: types.CHANGE_EMAILLOG_STATUS_FAILED,
        payload: error,
    };
}

export function changeEmailLogStatusSuccess(emailLogStatus: $TSFixMe) {
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
export const emailLogStatusChange = (values: $TSFixMe) => async (
    dispatch: $TSFixMe
) => {
    // @ts-expect-error ts-migrate(2554) FIXME: Expected 1 arguments, but got 0.
    dispatch(changeEmailLogStatusRequest());

    try {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        const response = await postApi('globalConfig/', [
            { name: 'emailLogMonitoringStatus', value: values.status },
        ]);
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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
