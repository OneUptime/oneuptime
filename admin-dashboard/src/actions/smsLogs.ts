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

export const fetchSmsLogs =
    (skip: $TSFixMe, limit: $TSFixMe) => async (dispatch: $TSFixMe) => {
        skip = skip ? parseInt(skip) : 0;
        limit = limit ? parseInt(limit) : 10;

        dispatch(fetchSmsLogsRequest());

        try {
            const response = await getApi(
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

export const searchSmsLogs =
    (filter: $TSFixMe, skip: $TSFixMe, limit: $TSFixMe) =>
        async (dispatch: $TSFixMe) => {
            const values = {
                filter,
            };

            dispatch(searchSmsLogsRequest());

            try {
                const response = await postApi(
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
        const response = await deleteApi(`sms-logs`);

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

export const fetchSmsLogStatusRequest = (promise: $TSFixMe) => {
    return {
        type: types.FETCH_SMSLOG_STATUS_REQUEST,
        payload: promise,
    };
}

export const fetchSmsLogStatusError = (error: $TSFixMe) => {
    return {
        type: types.FETCH_SMSLOG_STATUS_FAILED,
        payload: error,
    };
}

export const fetchSmsLogStatusSuccess = (smsLogStatus: $TSFixMe) => {
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
    dispatch(fetchSmsLogStatusRequest());

    try {
        const response = await getApi('globalConfig/smsLogMonitoringStatus');

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

export const changeSmsLogStatusRequest = (promise: $TSFixMe) => {
    return {
        type: types.CHANGE_SMSLOG_STATUS_REQUEST,
        payload: promise,
    };
}

export const changeSmsLogStatusError = (error: $TSFixMe) => {
    return {
        type: types.CHANGE_SMSLOG_STATUS_FAILED,
        payload: error,
    };
}

export const changeSmsLogStatusSuccess = (smsLogStatus: $TSFixMe) => {
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
export const smsLogStatusChange =
    (values: $TSFixMe) => async (dispatch: $TSFixMe) => {
        dispatch(changeSmsLogStatusRequest());

        try {
            const response = await postApi('globalConfig/', [
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
            dispatch(changeSmsLogStatusError(errors(errorMsg)));
            return 'error';
        }
    };
