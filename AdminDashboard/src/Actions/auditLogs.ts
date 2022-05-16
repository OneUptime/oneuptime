import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/auditLogs';
import Route from 'Common/Types/api/route';
import PositiveNumber from 'Common/Types/PositiveNumber';
// Fetch All Audit Logs
export const fetchAuditLogsRequest: Function = (): void => {
    return {
        type: types.FETCH_AUDITLOGS_REQUEST,
    };
};

export const fetchAuditLogsSuccess: Function = (auditLogs: $TSFixMe): void => {
    return {
        type: types.FETCH_AUDITLOGS_SUCCESS,
        payload: auditLogs,
    };
};

export const fetchAuditLogsError: Function = (error: $TSFixMe): void => {
    return {
        type: types.FETCH_AUDITLOGS_FAILURE,
        payload: error,
    };
};

export const fetchAuditLogs: $TSFixMe = (
    skip: PositiveNumber,
    limit: PositiveNumber
) => {
    return async (dispatch: Dispatch) => {
        skip = skip ? parseInt(skip) : 0;
        limit = limit ? parseInt(limit) : 10;

        dispatch(fetchAuditLogsRequest());

        try {
            const response: $TSFixMe = await BackendAPI.get(
                `audit-logs?skip=${skip}&limit=${limit}`
            );

            const data: $TSFixMe = response.data;

            dispatch(fetchAuditLogsSuccess(data));

            return response;
        } catch (error) {
            let errorMsg: $TSFixMe;
            if (error && error.response && error.response.data) {
                errorMsg = error.response.data;
            }
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
};

// Search Audit Logs.
export const searchAuditLogsRequest: Function = (): void => {
    return {
        type: types.SEARCH_AUDITLOGS_REQUEST,
    };
};

export const searchAuditLogsSuccess: Function = (auditLogs: $TSFixMe): void => {
    return {
        type: types.SEARCH_AUDITLOGS_SUCCESS,
        payload: auditLogs,
    };
};

export const searchAuditLogsError: Function = (error: $TSFixMe): void => {
    return {
        type: types.SEARCH_AUDITLOGS_FAILURE,
        payload: error,
    };
};

export const searchAuditLogs: $TSFixMe = (
    filter: $TSFixMe,
    skip: PositiveNumber,
    limit: PositiveNumber
) => {
    return async (dispatch: Dispatch) => {
        const values: $TSFixMe = {
            filter,
        };

        dispatch(searchAuditLogsRequest());

        try {
            const response: $TSFixMe = await BackendAPI.post(
                `audit-logs/search?skip=${skip}&limit=${limit}`,
                values
            );

            const data: $TSFixMe = response.data;

            dispatch(searchAuditLogsSuccess(data));
            return response;
        } catch (error) {
            let errorMsg: $TSFixMe;
            if (error && error.response && error.response.data) {
                errorMsg = error.response.data;
            }
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
};

// Delete All Audit Logs
export const deleteAuditLogsRequest: Function = (): void => {
    return {
        type: types.DELETE_ALL_AUDITLOGS_REQUEST,
    };
};

export const deleteAuditLogsSuccess: Function = (message: $TSFixMe): void => {
    return {
        type: types.DELETE_ALL_AUDITLOGS_SUCCESS,
        payload: message,
    };
};

export const deleteAuditLogsError: Function = (error: $TSFixMe): void => {
    return {
        type: types.DELETE_ALL_AUDITLOGS_FAILURE,
        payload: error,
    };
};

export const deleteAuditLogs: $TSFixMe = () => {
    return async (dispatch: Dispatch): void => {
        dispatch(deleteAuditLogsRequest());

        try {
            const response: $TSFixMe = delete `audit-logs`;

            const message: $TSFixMe = response.data.message;

            dispatch(deleteAuditLogsSuccess(message));
        } catch (error) {
            let errorMsg: $TSFixMe;
            if (error && error.response && error.response.data) {
                errorMsg = error.response.data;
            }
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
};

// Fetch auditLogStatus

export const fetchAuditLogStatusRequest: Function = (
    promise: $TSFixMe
): void => {
    return {
        type: types.FETCH_AUDITLOG_STATUS_REQUEST,
        payload: promise,
    };
};

export const fetchAuditLogStatusError: Function = (error: $TSFixMe): void => {
    return {
        type: types.FETCH_AUDITLOG_STATUS_FAILED,
        payload: error,
    };
};

export const fetchAuditLogStatusSuccess: Function = (
    auditLogStatus: $TSFixMe
): void => {
    return {
        type: types.FETCH_AUDITLOG_STATUS_SUCCESS,
        payload: auditLogStatus,
    };
};

export const resetFetchAuditLogStatus: Function = (): void => {
    return {
        type: types.FETCH_AUDITLOG_STATUS_RESET,
    };
};

// Calls the API to fetch auditLogStatus
export const fetchAuditLogStatus: $TSFixMe = () => {
    return async (dispatch: Dispatch): void => {
        dispatch(fetchAuditLogStatusRequest());

        try {
            const response: $TSFixMe = await BackendAPI.get(
                'globalConfig/auditLogMonitoringStatus'
            );

            dispatch(fetchAuditLogStatusSuccess(response.data));
            return response;
        } catch (error) {
            let errorMsg: $TSFixMe;
            if (error && error.response && error.response.data) {
                errorMsg = error.response.data;
            }
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
};

// Change auditLogStatus

export const changeAuditLogStatusRequest: Function = (
    promise: $TSFixMe
): void => {
    return {
        type: types.CHANGE_AUDITLOG_STATUS_REQUEST,
        payload: promise,
    };
};

export const changeAuditLogStatusError: Function = (error: $TSFixMe): void => {
    return {
        type: types.CHANGE_AUDITLOG_STATUS_FAILED,
        payload: error,
    };
};

export const changeAuditLogStatusSuccess: Function = (
    auditLogStatus: $TSFixMe
): void => {
    return {
        type: types.CHANGE_AUDITLOG_STATUS_SUCCESS,
        payload: auditLogStatus,
    };
};

export const resetConfirmAuditLogStatus: Function = (): void => {
    return {
        type: types.CHANGE_AUDITLOG_STATUS_RESET,
    };
};

// Calls the API to change auditLogStatus
export const auditLogStatusChange: $TSFixMe = (values: $TSFixMe) => {
    return async (dispatch: Dispatch) => {
        dispatch(changeAuditLogStatusRequest());

        try {
            const response: $TSFixMe = await BackendAPI.post(
                new Route('globalConfig/'),
                [{ name: 'auditLogMonitoringStatus', value: values.status }]
            );

            const data: $TSFixMe = response.data;
            dispatch(changeAuditLogStatusSuccess(data));
            return data;
        } catch (error) {
            let errorMsg: $TSFixMe;
            if (error && error.response && error.response.data) {
                errorMsg = error.response.data;
            }
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
};
