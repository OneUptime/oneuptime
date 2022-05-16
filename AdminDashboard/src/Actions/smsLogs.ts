import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/smsLogs';
import Route from 'Common/Types/api/route';
import PositiveNumber from 'Common/Types/PositiveNumber';
// Fetch All Sms Logs
export const fetchSmsLogsRequest: Function = (): void => {
    return {
        type: types.FETCH_SMSLOGS_REQUEST,
    };
};

export const fetchSmsLogsSuccess: Function = (smsLogs: $TSFixMe): void => {
    return {
        type: types.FETCH_SMSLOGS_SUCCESS,
        payload: smsLogs,
    };
};

export const fetchSmsLogsError: Function = (error: $TSFixMe): void => {
    return {
        type: types.FETCH_SMSLOGS_FAILURE,
        payload: error,
    };
};

export const fetchSmsLogs: $TSFixMe = (
    skip: PositiveNumber,
    limit: PositiveNumber
) => {
    return async (dispatch: Dispatch) => {
        skip = skip ? parseInt(skip) : 0;
        limit = limit ? parseInt(limit) : 10;

        dispatch(fetchSmsLogsRequest());

        try {
            const response: $TSFixMe = await BackendAPI.get(
                `sms-logs?skip=${skip}&limit=${limit}`
            );

            const data: $TSFixMe = response.data;

            dispatch(fetchSmsLogsSuccess(data));

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
            dispatch(fetchSmsLogsError(errorMsg));
        }
    };
};

// Search Sms Logs.
export const searchSmsLogsRequest: Function = (): void => {
    return {
        type: types.SEARCH_SMSLOGS_REQUEST,
    };
};

export const searchSmsLogsSuccess: Function = (smsLogs: $TSFixMe): void => {
    return {
        type: types.SEARCH_SMSLOGS_SUCCESS,
        payload: smsLogs,
    };
};

export const searchSmsLogsError: Function = (error: $TSFixMe): void => {
    return {
        type: types.SEARCH_SMSLOGS_FAILURE,
        payload: error,
    };
};

export const searchSmsLogs: $TSFixMe = (
    filter: $TSFixMe,
    skip: PositiveNumber,
    limit: PositiveNumber
) => {
    return async (dispatch: Dispatch) => {
        const values: $TSFixMe = {
            filter,
        };

        dispatch(searchSmsLogsRequest());

        try {
            const response: $TSFixMe = await BackendAPI.post(
                `sms-logs/search?skip=${skip}&limit=${limit}`,
                values
            );

            const data: $TSFixMe = response.data;

            dispatch(searchSmsLogsSuccess(data));
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
            dispatch(searchSmsLogsError(errorMsg));
        }
    };
};

// Delete All Sms Logs
export const deleteSmsLogsRequest: Function = (): void => {
    return {
        type: types.DELETE_ALL_SMSLOGS_REQUEST,
    };
};

export const deleteSmsLogsSuccess: Function = (message: $TSFixMe): void => {
    return {
        type: types.DELETE_ALL_SMSLOGS_SUCCESS,
        payload: message,
    };
};

export const deleteSmsLogsError: Function = (error: $TSFixMe): void => {
    return {
        type: types.DELETE_ALL_SMSLOGS_FAILURE,
        payload: error,
    };
};

export const deleteSmsLogs: $TSFixMe = () => {
    return async (dispatch: Dispatch): void => {
        dispatch(deleteSmsLogsRequest());

        try {
            const response: $TSFixMe = delete `sms-logs`;

            const message: $TSFixMe = response.data.message;

            dispatch(deleteSmsLogsSuccess(message));
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
            dispatch(deleteSmsLogsError(errorMsg));
        }
    };
};

// Fetch smsLogStatus

export const fetchSmsLogStatusRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.FETCH_SMSLOG_STATUS_REQUEST,
        payload: promise,
    };
};

export const fetchSmsLogStatusError: Function = (error: $TSFixMe): void => {
    return {
        type: types.FETCH_SMSLOG_STATUS_FAILED,
        payload: error,
    };
};

export const fetchSmsLogStatusSuccess: Function = (
    smsLogStatus: $TSFixMe
): void => {
    return {
        type: types.FETCH_SMSLOG_STATUS_SUCCESS,
        payload: smsLogStatus,
    };
};

export const resetFetchSmsLogStatus: Function = (): void => {
    return {
        type: types.FETCH_SMSLOG_STATUS_RESET,
    };
};

// Calls the API to fetch smsLogStatus
export const fetchSmsLogStatus: $TSFixMe = () => {
    return async (dispatch: Dispatch): void => {
        dispatch(fetchSmsLogStatusRequest());

        try {
            const response: $TSFixMe = await BackendAPI.get(
                'globalConfig/smsLogMonitoringStatus'
            );

            dispatch(fetchSmsLogStatusSuccess(response.data));
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
            dispatch(fetchSmsLogStatusError(errorMsg));
            return 'error';
        }
    };
};

// Change smsLogStatus

export const changeSmsLogStatusRequest: Function = (
    promise: $TSFixMe
): void => {
    return {
        type: types.CHANGE_SMSLOG_STATUS_REQUEST,
        payload: promise,
    };
};

export const changeSmsLogStatusError: Function = (error: $TSFixMe): void => {
    return {
        type: types.CHANGE_SMSLOG_STATUS_FAILED,
        payload: error,
    };
};

export const changeSmsLogStatusSuccess: Function = (
    smsLogStatus: $TSFixMe
): void => {
    return {
        type: types.CHANGE_SMSLOG_STATUS_SUCCESS,
        payload: smsLogStatus,
    };
};

export const resetConfirmSmsLogStatus: Function = (): void => {
    return {
        type: types.CHANGE_SMSLOG_STATUS_RESET,
    };
};

// Calls the API to change smsLogStatus
export const smsLogStatusChange: $TSFixMe = (values: $TSFixMe) => {
    return async (dispatch: Dispatch) => {
        dispatch(changeSmsLogStatusRequest());

        try {
            const response: $TSFixMe = await BackendAPI.post(
                new Route('globalConfig/'),
                [{ name: 'smsLogMonitoringStatus', value: values.status }]
            );

            const data: $TSFixMe = response.data;
            dispatch(changeSmsLogStatusSuccess(data));
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
            dispatch(changeSmsLogStatusError(errorMsg));
            return 'error';
        }
    };
};
