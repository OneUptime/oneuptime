import { getApi, postApi, deleteApi } from '../api';
import * as types from '../constants/auditLogs';
import errors from '../errors';

// Fetch All Audit Logs
export const fetchAuditLogsRequest = () => {
    return {
        type: types.FETCH_AUDITLOGS_REQUEST,
    };
};

export const fetchAuditLogsSuccess = (auditLogs: $TSFixMe) => {
    return {
        type: types.FETCH_AUDITLOGS_SUCCESS,
        payload: auditLogs,
    };
};

export const fetchAuditLogsError = (error: $TSFixMe) => {
    return {
        type: types.FETCH_AUDITLOGS_FAILURE,
        payload: error,
    };
};

export const fetchAuditLogs = (skip: $TSFixMe, limit: $TSFixMe) => async (
    dispatch: $TSFixMe
) => {
    skip = skip ? parseInt(skip) : 0;
    limit = limit ? parseInt(limit) : 10;

    dispatch(fetchAuditLogsRequest());

    try {
        const response = await getApi(`audit-logs?skip=${skip}&limit=${limit}`);

        const data = response.data;

        dispatch(fetchAuditLogsSuccess(data));

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
        dispatch(fetchAuditLogsError(errors(errorMsg)));
    }
};

// Search Audit Logs.
export const searchAuditLogsRequest = () => {
    return {
        type: types.SEARCH_AUDITLOGS_REQUEST,
    };
};

export const searchAuditLogsSuccess = (auditLogs: $TSFixMe) => {
    return {
        type: types.SEARCH_AUDITLOGS_SUCCESS,
        payload: auditLogs,
    };
};

export const searchAuditLogsError = (error: $TSFixMe) => {
    return {
        type: types.SEARCH_AUDITLOGS_FAILURE,
        payload: error,
    };
};

export const searchAuditLogs = (
    filter: $TSFixMe,
    skip: $TSFixMe,
    limit: $TSFixMe
) => async (dispatch: $TSFixMe) => {
    const values = {
        filter,
    };

    dispatch(searchAuditLogsRequest());

    try {
        const response = await postApi(
            `audit-logs/search?skip=${skip}&limit=${limit}`,
            values
        );

        const data = response.data;

        dispatch(searchAuditLogsSuccess(data));
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
        dispatch(searchAuditLogsError(errors(errorMsg)));
    }
};

// Delete All Audit Logs
export const deleteAuditLogsRequest = () => {
    return {
        type: types.DELETE_ALL_AUDITLOGS_REQUEST,
    };
};

export const deleteAuditLogsSuccess = (message: $TSFixMe) => {
    return {
        type: types.DELETE_ALL_AUDITLOGS_SUCCESS,
        payload: message,
    };
};

export const deleteAuditLogsError = (error: $TSFixMe) => {
    return {
        type: types.DELETE_ALL_AUDITLOGS_FAILURE,
        payload: error,
    };
};

export const deleteAuditLogs = () => async (dispatch: $TSFixMe) => {
    dispatch(deleteAuditLogsRequest());

    try {
        const response = await deleteApi(`audit-logs`);

        const message = response.data.message;

        dispatch(deleteAuditLogsSuccess(message));
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
        dispatch(deleteAuditLogsError(errors(errorMsg)));
    }
};

// fetch auditLogStatus

export function fetchAuditLogStatusRequest(promise: $TSFixMe) {
    return {
        type: types.FETCH_AUDITLOG_STATUS_REQUEST,
        payload: promise,
    };
}

export function fetchAuditLogStatusError(error: $TSFixMe) {
    return {
        type: types.FETCH_AUDITLOG_STATUS_FAILED,
        payload: error,
    };
}

export function fetchAuditLogStatusSuccess(auditLogStatus: $TSFixMe) {
    return {
        type: types.FETCH_AUDITLOG_STATUS_SUCCESS,
        payload: auditLogStatus,
    };
}

export const resetFetchAuditLogStatus = () => {
    return {
        type: types.FETCH_AUDITLOG_STATUS_RESET,
    };
};

// Calls the API to fetch auditLogStatus
export const fetchAuditLogStatus = () => async (dispatch: $TSFixMe) => {
    dispatch(fetchAuditLogStatusRequest());

    try {
        const response = await getApi('globalConfig/auditLogMonitoringStatus');

        dispatch(fetchAuditLogStatusSuccess(response.data));
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
        dispatch(fetchAuditLogStatusError(errors(errorMsg)));
        return 'error';
    }
};

// change auditLogStatus

export function changeAuditLogStatusRequest(promise: $TSFixMe) {
    return {
        type: types.CHANGE_AUDITLOG_STATUS_REQUEST,
        payload: promise,
    };
}

export function changeAuditLogStatusError(error: $TSFixMe) {
    return {
        type: types.CHANGE_AUDITLOG_STATUS_FAILED,
        payload: error,
    };
}

export function changeAuditLogStatusSuccess(auditLogStatus: $TSFixMe) {
    return {
        type: types.CHANGE_AUDITLOG_STATUS_SUCCESS,
        payload: auditLogStatus,
    };
}

export const resetConfirmAuditLogStatus = () => {
    return {
        type: types.CHANGE_AUDITLOG_STATUS_RESET,
    };
};

// Calls the API to change auditLogStatus
export const auditLogStatusChange = (values: $TSFixMe) => async (
    dispatch: $TSFixMe
) => {
    dispatch(changeAuditLogStatusRequest());

    try {
        const response = await postApi('globalConfig/', [
            { name: 'auditLogMonitoringStatus', value: values.status },
        ]);

        const data = response.data;
        dispatch(changeAuditLogStatusSuccess(data));
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
        dispatch(changeAuditLogStatusError(errors(errorMsg)));
        return 'error';
    }
};
