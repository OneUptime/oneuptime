import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/auditLogs';
import Route from 'Common/Types/api/route';
import PositiveNumber from 'Common/Types/PositiveNumber';
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

export const fetchAuditLogs =
    (skip: PositiveNumber, limit: PositiveNumber) =>
    async (dispatch: Dispatch) => {
        skip = skip ? parseInt(skip) : 0;
        limit = limit ? parseInt(limit) : 10;

        dispatch(fetchAuditLogsRequest());

        try {
            const response = await BackendAPI.get(
                `audit-logs?skip=${skip}&limit=${limit}`
            );

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
            dispatch(fetchAuditLogsError(errorMsg));
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

export const searchAuditLogs =
    (filter: $TSFixMe, skip: PositiveNumber, limit: PositiveNumber) =>
    async (dispatch: Dispatch) => {
        const values = {
            filter,
        };

        dispatch(searchAuditLogsRequest());

        try {
            const response = await BackendAPI.post(
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
            dispatch(searchAuditLogsError(errorMsg));
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

export const deleteAuditLogs = () => async (dispatch: Dispatch) => {
    dispatch(deleteAuditLogsRequest());

    try {
        const response = await delete `audit-logs`;

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
        dispatch(deleteAuditLogsError(errorMsg));
    }
};

// fetch auditLogStatus

export const fetchAuditLogStatusRequest = (promise: $TSFixMe) => {
    return {
        type: types.FETCH_AUDITLOG_STATUS_REQUEST,
        payload: promise,
    };
};

export const fetchAuditLogStatusError = (error: $TSFixMe) => {
    return {
        type: types.FETCH_AUDITLOG_STATUS_FAILED,
        payload: error,
    };
};

export const fetchAuditLogStatusSuccess = (auditLogStatus: $TSFixMe) => {
    return {
        type: types.FETCH_AUDITLOG_STATUS_SUCCESS,
        payload: auditLogStatus,
    };
};

export const resetFetchAuditLogStatus = () => {
    return {
        type: types.FETCH_AUDITLOG_STATUS_RESET,
    };
};

// Calls the API to fetch auditLogStatus
export const fetchAuditLogStatus = () => async (dispatch: Dispatch) => {
    dispatch(fetchAuditLogStatusRequest());

    try {
        const response = await BackendAPI.get(
            'globalConfig/auditLogMonitoringStatus'
        );

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
        dispatch(fetchAuditLogStatusError(errorMsg));
        return 'error';
    }
};

// change auditLogStatus

export const changeAuditLogStatusRequest = (promise: $TSFixMe) => {
    return {
        type: types.CHANGE_AUDITLOG_STATUS_REQUEST,
        payload: promise,
    };
};

export const changeAuditLogStatusError = (error: $TSFixMe) => {
    return {
        type: types.CHANGE_AUDITLOG_STATUS_FAILED,
        payload: error,
    };
};

export const changeAuditLogStatusSuccess = (auditLogStatus: $TSFixMe) => {
    return {
        type: types.CHANGE_AUDITLOG_STATUS_SUCCESS,
        payload: auditLogStatus,
    };
};

export const resetConfirmAuditLogStatus = () => {
    return {
        type: types.CHANGE_AUDITLOG_STATUS_RESET,
    };
};

// Calls the API to change auditLogStatus
export const auditLogStatusChange =
    (values: $TSFixMe) => async (dispatch: Dispatch) => {
        dispatch(changeAuditLogStatusRequest());

        try {
            const response = await BackendAPI.post(new Route('globalConfig/'), [
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
            dispatch(changeAuditLogStatusError(errorMsg));
            return 'error';
        }
    };
