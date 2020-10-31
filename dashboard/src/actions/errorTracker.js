import { postApi, getApi } from '../api';
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

export function fetchErrorTrackers(projectId, componentId) {
    return function(dispatch) {
        const promise = getApi(`error-tracker/${projectId}/${componentId}`);
        dispatch(fetchErrorTrackersRequest());

        promise.then(
            function(errorTrackers) {
                dispatch(fetchErrorTrackersSuccess(errorTrackers.data));
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(fetchErrorTrackersFailure(errors(error)));
            }
        );

        return promise;
    };
}

export function fetchErrorTrackersSuccess(errorTrackers) {
    return {
        type: types.FETCH_ERROR_TRACKERS_SUCCESS,
        payload: errorTrackers,
    };
}

export function fetchErrorTrackersRequest() {
    return {
        type: types.FETCH_ERROR_TRACKERS_REQUEST,
    };
}

export function fetchErrorTrackersFailure(error) {
    return {
        type: types.FETCH_ERROR_TRACKERS_FAILURE,
        payload: error,
    };
}

export function resetFetchErrorTrackers() {
    return {
        type: types.FETCH_ERROR_TRACKERS_RESET,
    };
}
