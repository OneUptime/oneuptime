import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/callLogs';
import Route from 'Common/Types/api/route';
import PositiveNumber from 'Common/Types/PositiveNumber';
// Fetch All Call Logs
export const fetchCallLogsRequest = (): void => {
    return {
        type: types.FETCH_CALLLOGS_REQUEST,
    };
};

export const fetchCallLogsSuccess = (callLogs: $TSFixMe): void => {
    return {
        type: types.FETCH_CALLLOGS_SUCCESS,
        payload: callLogs,
    };
};

export const fetchCallLogsError = (error: $TSFixMe): void => {
    return {
        type: types.FETCH_CALLLOGS_FAILURE,
        payload: error,
    };
};

export const fetchCallLogs =
    (skip: PositiveNumber, limit: PositiveNumber) =>
    async (dispatch: Dispatch) => {
        skip = skip ? parseInt(skip) : 0;
        limit = limit ? parseInt(limit) : 10;

        dispatch(fetchCallLogsRequest());

        try {
            const response = await BackendAPI.get(
                `call-logs?skip=${skip}&limit=${limit}`
            );

            const data = response.data;

            dispatch(fetchCallLogsSuccess(data));

            return response;
        } catch (error) {
            let errorMsg;
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
            dispatch(fetchCallLogsError(errorMsg));
        }
    };

// Search Call Logs.
export const searchCallLogsRequest = (): void => {
    return {
        type: types.SEARCH_CALLLOGS_REQUEST,
    };
};

export const searchCallLogsSuccess = (callLogs: $TSFixMe): void => {
    return {
        type: types.SEARCH_CALLLOGS_SUCCESS,
        payload: callLogs,
    };
};

export const searchCallLogsError = (error: $TSFixMe): void => {
    return {
        type: types.SEARCH_CALLLOGS_FAILURE,
        payload: error,
    };
};

export const searchCallLogs =
    (filter: $TSFixMe, skip: PositiveNumber, limit: PositiveNumber) =>
    async (dispatch: Dispatch) => {
        const values = {
            filter,
        };

        dispatch(searchCallLogsRequest());

        try {
            const response = await BackendAPI.post(
                `call-logs/search?skip=${skip}&limit=${limit}`,
                values
            );

            const data = response.data;

            dispatch(searchCallLogsSuccess(data));
            return response;
        } catch (error) {
            let errorMsg;
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
            dispatch(searchCallLogsError(errorMsg));
        }
    };

// Delete All Call Logs
export const deleteCallLogsRequest = (): void => {
    return {
        type: types.DELETE_ALL_CALLLOGS_REQUEST,
    };
};

export const deleteCallLogsSuccess = (message: $TSFixMe): void => {
    return {
        type: types.DELETE_ALL_CALLLOGS_SUCCESS,
        payload: message,
    };
};

export const deleteCallLogsError = (error: $TSFixMe): void => {
    return {
        type: types.DELETE_ALL_CALLLOGS_FAILURE,
        payload: error,
    };
};

export const deleteCallLogs =
    () =>
    async (dispatch: Dispatch): void => {
        dispatch(deleteCallLogsRequest());

        try {
            const response = await delete `call-logs`;

            const message = response.data.message;

            dispatch(deleteCallLogsSuccess(message));
        } catch (error) {
            let errorMsg;
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
            dispatch(deleteCallLogsError(errorMsg));
        }
    };

// fetch callLogStatus

export const fetchCallLogStatusRequest = (promise: $TSFixMe): void => {
    return {
        type: types.FETCH_CALLLOG_STATUS_REQUEST,
        payload: promise,
    };
};

export const fetchCallLogStatusError = (error: $TSFixMe): void => {
    return {
        type: types.FETCH_CALLLOG_STATUS_FAILED,
        payload: error,
    };
};

export const fetchCallLogStatusSuccess = (callLogStatus: $TSFixMe): void => {
    return {
        type: types.FETCH_CALLLOG_STATUS_SUCCESS,
        payload: callLogStatus,
    };
};

export const resetFetchCallLogStatus = (): void => {
    return {
        type: types.FETCH_CALLLOG_STATUS_RESET,
    };
};

// Calls the API to fetch callLogStatus
export const fetchCallLogStatus =
    () =>
    async (dispatch: Dispatch): void => {
        dispatch(fetchCallLogStatusRequest());

        try {
            const response = await BackendAPI.get(
                'globalConfig/callLogMonitoringStatus'
            );

            dispatch(fetchCallLogStatusSuccess(response.data));
            return response;
        } catch (error) {
            let errorMsg;
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
            dispatch(fetchCallLogStatusError(errorMsg));
            return 'error';
        }
    };

// change callLogStatus

export const changeCallLogStatusRequest = (promise: $TSFixMe): void => {
    return {
        type: types.CHANGE_CALLLOG_STATUS_REQUEST,
        payload: promise,
    };
};

export const changeCallLogStatusError = (error: $TSFixMe): void => {
    return {
        type: types.CHANGE_CALLLOG_STATUS_FAILED,
        payload: error,
    };
};

export const changeCallLogStatusSuccess = (callLogStatus: $TSFixMe): void => {
    return {
        type: types.CHANGE_CALLLOG_STATUS_SUCCESS,
        payload: callLogStatus,
    };
};

export const resetConfirmCallLogStatus = (): void => {
    return {
        type: types.CHANGE_CALLLOG_STATUS_RESET,
    };
};

// Calls the API to change callLogStatus
export const callLogStatusChange =
    (values: $TSFixMe) => async (dispatch: Dispatch) => {
        dispatch(changeCallLogStatusRequest());

        try {
            const response = await BackendAPI.post(new Route('globalConfig/'), [
                { name: 'callLogMonitoringStatus', value: values.status },
            ]);

            const data = response.data;
            dispatch(changeCallLogStatusSuccess(data));
            return data;
        } catch (error) {
            let errorMsg;
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
            dispatch(changeCallLogStatusError(errorMsg));
            return 'error';
        }
    };
