import { postApi } from '../api';
import * as types from '../constants/applicationLog';
import errors from '../errors';

//Create new application log
//props -> {name: '', type, data -> { data.url}}
export function createApplicationLog(componentId, values) {
    return function(dispatch) {
        const promise = postApi(`application-log/${componentId}`, values);
        dispatch(createApplicationLogRequest());

        promise.then(
            function(applicationLog) {
                dispatch(createApplicationLogSuccess(applicationLog.data));
            },
            function(error) {
                if (error && error.response && error.response.data) {
                    error = error.response.data;
                }
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(createApplicationLogFailure(errors(error)));
            }
        );

        return promise;
    };
}

export function createApplicationLogSuccess(newApplicationLog) {
    return {
        type: types.CREATE_APPLICATION_LOG_SUCCESS,
        payload: newApplicationLog,
    };
}

export function createApplicationLogRequest() {
    return {
        type: types.CREATE_APPLICATION_LOG_REQUEST,
    };
}

export function createApplicationLogFailure(error) {
    return {
        type: types.CREATE_APPLICATION_LOG_FAILURE,
        payload: error,
    };
}

export function resetCreateApplicationLog() {
    return {
        type: types.CREATE_APPLICATION_LOG_RESET,
    };
}