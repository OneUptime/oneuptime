import { postApi } from '../api';
import * as types from '../constants/errorTracker';
import errors from '../errors';

//Create new error tracker
//props -> {name: '', type, data -> { data.url}}
export function createErrorTracker(projectId, componentId, values) {
    return function(dispatch) {
        const promise = postApi(
            `error-tracker/${projectId}/${componentId}/create`,
            values
        );
        dispatch(createErrorTrackerRequest());

        promise.then(
            function(errorTracker) {
                dispatch(createErrorTrackerSuccess(errorTracker.data));
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
                dispatch(createErrorTrackerFailure(errors(error)));
            }
        );

        return promise;
    };
}

export function createErrorTrackerSuccess(newErrorTracker) {
    return {
        type: types.CREATE_ERROR_TRACKER_SUCCESS,
        payload: newErrorTracker,
    };
}

export function createErrorTrackerRequest() {
    return {
        type: types.CREATE_ERROR_TRACKER_REQUEST,
    };
}

export function createErrorTrackerFailure(error) {
    return {
        type: types.CREATE_ERROR_TRACKER_FAILURE,
        payload: error,
    };
}

export function resetCreateErrorTracker() {
    return {
        type: types.CREATE_ERROR_TRACKER_RESET,
    };
}
