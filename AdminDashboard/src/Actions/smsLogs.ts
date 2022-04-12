import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/smsLogs';
import Route from 'Common/Types/api/route';
import PositiveNumber from 'Common/Types/PositiveNumber';
// Fetch All Sms Logs
export const fetchSmsLogsRequest = (): void => {
    return {
        type: types.FETCH_SMSLOGS_REQUEST,
    };
};

export const fetchSmsLogsSuccess = (smsLogs: $TSFixMe): void => {
    return {
        type: types.FETCH_SMSLOGS_SUCCESS,
        payload: smsLogs,
    };
};

export const fetchSmsLogsError = (error: $TSFixMe): void => {
    return {
        type: types.FETCH_SMSLOGS_FAILURE,
        payload: error,
    };
};

export const fetchSmsLogs =
    (skip: PositiveNumber, limit: PositiveNumber) =>
    async (dispatch: Dispatch) => {
        skip = skip ? parseInt(skip) : 0;
        limit = limit ? parseInt(limit) : 10;

        dispatch(fetchSmsLogsRequest());

        try {
            const response = await BackendAPI.get(
                `sms-logs?skip=${skip}&limit=${limit}`
            );

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
            dispatch(fetchSmsLogsError(errorMsg));
        }
    };

// Search Sms Logs.
export const searchSmsLogsRequest = (): void => {
    return {
        type: types.SEARCH_SMSLOGS_REQUEST,
    };
};

export const searchSmsLogsSuccess = (smsLogs: $TSFixMe): void => {
    return {
        type: types.SEARCH_SMSLOGS_SUCCESS,
        payload: smsLogs,
    };
};

export const searchSmsLogsError = (error: $TSFixMe): void => {
    return {
        type: types.SEARCH_SMSLOGS_FAILURE,
        payload: error,
    };
};

export const searchSmsLogs =
    (filter: $TSFixMe, skip: PositiveNumber, limit: PositiveNumber) =>
    async (dispatch: Dispatch) => {
        const values = {
            filter,
        };

        dispatch(searchSmsLogsRequest());

        try {
            const response = await BackendAPI.post(
                `sms-logs/search?skip=${skip}&limit=${limit}`,
                values
            );

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
            dispatch(searchSmsLogsError(errorMsg));
        }
    };

// Delete All Sms Logs
export const deleteSmsLogsRequest = (): void => {
    return {
        type: types.DELETE_ALL_SMSLOGS_REQUEST,
    };
};

export const deleteSmsLogsSuccess = (message: $TSFixMe): void => {
    return {
        type: types.DELETE_ALL_SMSLOGS_SUCCESS,
        payload: message,
    };
};

export const deleteSmsLogsError = (error: $TSFixMe): void => {
    return {
        type: types.DELETE_ALL_SMSLOGS_FAILURE,
        payload: error,
    };
};

export const deleteSmsLogs =
    () =>
    async (dispatch: Dispatch): void => {
        dispatch(deleteSmsLogsRequest());

        try {
            const response = await delete `sms-logs`;

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
            dispatch(deleteSmsLogsError(errorMsg));
        }
    };

// fetch smsLogStatus

export const fetchSmsLogStatusRequest = (promise: $TSFixMe): void => {
    return {
        type: types.FETCH_SMSLOG_STATUS_REQUEST,
        payload: promise,
    };
};

export const fetchSmsLogStatusError = (error: $TSFixMe): void => {
    return {
        type: types.FETCH_SMSLOG_STATUS_FAILED,
        payload: error,
    };
};

export const fetchSmsLogStatusSuccess = (smsLogStatus: $TSFixMe): void => {
    return {
        type: types.FETCH_SMSLOG_STATUS_SUCCESS,
        payload: smsLogStatus,
    };
};

export const resetFetchSmsLogStatus = (): void => {
    return {
        type: types.FETCH_SMSLOG_STATUS_RESET,
    };
};

// Calls the API to fetch smsLogStatus
export const fetchSmsLogStatus =
    () =>
    async (dispatch: Dispatch): void => {
        dispatch(fetchSmsLogStatusRequest());

        try {
            const response = await BackendAPI.get(
                'globalConfig/smsLogMonitoringStatus'
            );

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
            dispatch(fetchSmsLogStatusError(errorMsg));
            return 'error';
        }
    };

// change smsLogStatus

export const changeSmsLogStatusRequest = (promise: $TSFixMe): void => {
    return {
        type: types.CHANGE_SMSLOG_STATUS_REQUEST,
        payload: promise,
    };
};

export const changeSmsLogStatusError = (error: $TSFixMe): void => {
    return {
        type: types.CHANGE_SMSLOG_STATUS_FAILED,
        payload: error,
    };
};

export const changeSmsLogStatusSuccess = (smsLogStatus: $TSFixMe): void => {
    return {
        type: types.CHANGE_SMSLOG_STATUS_SUCCESS,
        payload: smsLogStatus,
    };
};

export const resetConfirmSmsLogStatus = (): void => {
    return {
        type: types.CHANGE_SMSLOG_STATUS_RESET,
    };
};

// Calls the API to change smsLogStatus
export const smsLogStatusChange =
    (values: $TSFixMe) => async (dispatch: Dispatch) => {
        dispatch(changeSmsLogStatusRequest());

        try {
            const response = await BackendAPI.post(new Route('globalConfig/'), [
                { name: 'smsLogMonitoringStatus', value: values.status },
            ]);

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
            dispatch(changeSmsLogStatusError(errorMsg));
            return 'error';
        }
    };
