import BackendAPI from '../api';
import { Dispatch } from 'redux';
import * as types from '../constants/callLogs';
import Route from 'common/types/api/route';
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

export const fetchCallLogs =
    (skip: $TSFixMe, limit: $TSFixMe) => async (dispatch: Dispatch) => {
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
            dispatch(fetchCallLogsError(errorMsg));
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

export const searchCallLogs =
    (filter: $TSFixMe, skip: $TSFixMe, limit: $TSFixMe) =>
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
            dispatch(searchCallLogsError(errorMsg));
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

export const deleteCallLogs = () => async (dispatch: Dispatch) => {
    dispatch(deleteCallLogsRequest());

    try {
        const response = await delete `call-logs`;

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
        dispatch(deleteCallLogsError(errorMsg));
    }
};

// fetch callLogStatus

export const fetchCallLogStatusRequest = (promise: $TSFixMe) => {
    return {
        type: types.FETCH_CALLLOG_STATUS_REQUEST,
        payload: promise,
    };
};

export const fetchCallLogStatusError = (error: $TSFixMe) => {
    return {
        type: types.FETCH_CALLLOG_STATUS_FAILED,
        payload: error,
    };
};

export const fetchCallLogStatusSuccess = (callLogStatus: $TSFixMe) => {
    return {
        type: types.FETCH_CALLLOG_STATUS_SUCCESS,
        payload: callLogStatus,
    };
};

export const resetFetchCallLogStatus = () => {
    return {
        type: types.FETCH_CALLLOG_STATUS_RESET,
    };
};

// Calls the API to fetch callLogStatus
export const fetchCallLogStatus = () => async (dispatch: Dispatch) => {
    dispatch(fetchCallLogStatusRequest());

    try {
        const response = await BackendAPI.get(
            'globalConfig/callLogMonitoringStatus'
        );

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
        dispatch(fetchCallLogStatusError(errorMsg));
        return 'error';
    }
};

// change callLogStatus

export const changeCallLogStatusRequest = (promise: $TSFixMe) => {
    return {
        type: types.CHANGE_CALLLOG_STATUS_REQUEST,
        payload: promise,
    };
};

export const changeCallLogStatusError = (error: $TSFixMe) => {
    return {
        type: types.CHANGE_CALLLOG_STATUS_FAILED,
        payload: error,
    };
};

export const changeCallLogStatusSuccess = (callLogStatus: $TSFixMe) => {
    return {
        type: types.CHANGE_CALLLOG_STATUS_SUCCESS,
        payload: callLogStatus,
    };
};

export const resetConfirmCallLogStatus = () => {
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
            dispatch(changeCallLogStatusError(errorMsg));
            return 'error';
        }
    };
