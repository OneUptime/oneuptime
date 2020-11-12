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

export function fetchErrorTrackerIssues(
    projectId,
    componentId,
    errorTrackerId,
    skip,
    limit
) {
    return function(dispatch) {
        const promise = postApi(
            `error-tracker/${projectId}/${componentId}/${errorTrackerId}/issues`,
            { skip, limit }
        );
        dispatch(fetchErrorTrackerIssuesRequest(errorTrackerId));

        promise.then(
            function(response) {
                dispatch(
                    fetchErrorTrackerIssuesSuccess({
                        errorTrackerId,
                        errorTrackerIssues:
                            response.data.data.errorTrackerIssues,
                        skip,
                        limit,
                        count: response.data.count,
                    })
                );
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
                dispatch(fetchErrorTrackerIssuesFailure(errors(error)));
            }
        );

        return promise;
    };
}

export function fetchErrorTrackerIssuesSuccess(errorTrackersList) {
    return {
        type: types.FETCH_ISSUES_SUCCESS,
        payload: errorTrackersList,
    };
}

export function fetchErrorTrackerIssuesRequest(errorTrackerId) {
    return {
        type: types.FETCH_ISSUES_REQUEST,
        payload: errorTrackerId,
    };
}

export function fetchErrorTrackerIssuesFailure(error) {
    return {
        type: types.FETCH_ISSUES_FAILURE,
        payload: error,
    };
}

export function resetFetchErrorTrackerIssues() {
    return {
        type: types.FETCH_ISSUES_RESET,
    };
}

export function fetchErrorEvent(
    projectId,
    componentId,
    errorTrackerId,
    errorEventId
) {
    return function(dispatch) {
        const promise = postApi(
            `error-tracker/${projectId}/${componentId}/${errorTrackerId}/error-events/${errorEventId}`
        );
        dispatch(fetchErrorEventRequest(errorTrackerId, errorEventId));

        promise.then(
            function(response) {
                dispatch(
                    fetchErrorEventSuccess({
                        errorTrackerId,
                        errorEventId,
                        errorEvent: response.data.errorEvent,
                        previous: response.data.previous,
                        next: response.data.next,
                        totalEvents: response.data.totalEvents,
                    })
                );
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
                dispatch(fetchErrorEventFailure(errors(error)));
            }
        );

        return promise;
    };
}

export function fetchErrorEventSuccess(errorEvent) {
    return {
        type: types.FETCH_ERROR_EVENT_SUCCESS,
        payload: errorEvent,
    };
}

export function fetchErrorEventRequest(errorTrackerId, errorEventId) {
    return {
        type: types.FETCH_ERROR_EVENT_REQUEST,
        payload: { errorTrackerId, errorEventId },
    };
}

export function fetchErrorEventFailure(error) {
    return {
        type: types.FETCH_ERROR_EVENT_FAILURE,
        payload: error,
    };
}

export function resetFetchErrorEvent() {
    return {
        type: types.FETCH_ERROR_EVENT_RESET,
    };
}

export function setCurrentErrorEvent(errorEventId) {
    return {
        type: types.SET_CURRENT_ERROR_EVENT,
        payload: { errorEventId },
    };
}
