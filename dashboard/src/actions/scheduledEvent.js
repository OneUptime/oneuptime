import { postApi, getApi, deleteApi, putApi } from '../api';
import * as types from '../constants/scheduledEvent';
import errors from '../errors';

export function fetchscheduledEvents(projectId, monitorId, skip, limit) {
    skip = parseInt(skip);
    limit = parseInt(limit);
    return function (dispatch) {
        var promise = null;
        if (skip >= 0 && limit >= 0) {
            promise = getApi(`scheduledEvent/${projectId}/${monitorId}?skip=${skip}&limit=${limit}`);
        } else {
            promise = getApi(`scheduledEvent/${projectId}/${monitorId}?skip=${0}&limit=${10}`);
        }
        dispatch(fetchscheduledEventsRequest());

        promise.then(function (scheduledEvents) {
            dispatch(fetchscheduledEventsSuccess(scheduledEvents.data));
        }, function (error) {
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            if (error && error.message) {
                error = error.message;
            }
            else {
                error = 'Network Error';
            }
            dispatch(fetchscheduledEventsFailure(errors(error)));
        });
        return promise;
    };
}

export function fetchscheduledEventsSuccess(scheduledEvents) {
    return {
        type: types.FETCH_SCHEDULED_EVENTS_SUCCESS,
        payload: scheduledEvents
    };
}

export function fetchscheduledEventsRequest() {
    return {
        type: types.FETCH_SCHEDULED_EVENTS_REQUEST,
    };
}

export function fetchscheduledEventsFailure(error) {
    return {
        type: types.FETCH_SCHEDULED_EVENTS_FAILURE,
        payload: error
    };
}



export function createScheduledEvent(projectId, monitorId, values) {

    return function (dispatch) {
        var promise = postApi(`scheduledEvent/${projectId}/${monitorId}`, values);
        dispatch(createScheduledEventRequest());

        promise.then(function (scheduledEvent) {
            dispatch(createScheduledEventSuccess(scheduledEvent.data));
        }, function (error) {
            if (error && error.response && error.response.data) {
                error = error.response.data;
            }
            if (error && error.data) {
                error = error.data;
            }
            if (error && error.message) {
                error = error.message;
            }
            else {
                error = 'Network Error';
            }
            dispatch(createScheduledEventFailure(errors(error)));
        });
        return promise;
    };
}

export function createScheduledEventSuccess(newScheduledEvent) {
    return {
        type: types.CREATE_SCHEDULED_EVENT_SUCCESS,
        payload: newScheduledEvent
    };
}

export function createScheduledEventRequest() {
    return {
        type: types.CREATE_SCHEDULED_EVENT_REQUEST
    };
}

export function createScheduledEventFailure(error) {
    return {
        type: types.CREATE_SCHEDULED_EVENT_FAILURE,
        payload: error
    };
}


export function deleteScheduledEvent(projectId, scheduledEventId) {
    return function (dispatch) {

        var promise = deleteApi(`scheduledEvent/${projectId}/${scheduledEventId}`);
        dispatch(deleteScheduledEventRequest(scheduledEventId));

        promise.then(function (scheduledEvent) {

            dispatch(deleteScheduledEventSuccess(scheduledEvent.data._id));
        }, function (error) {
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            if (error && error.message) {
                error = error.message;
            }
            else {
                error = 'Network Error';
            }
            dispatch(deleteScheduledEventFailure({ error: errors(error) }));
        });
        return promise;
    };
}

export function deleteScheduledEventSuccess(scheduledEventId) {
    return {
        type: types.DELETE_SCHEDULED_EVENT_SUCCESS,
        payload: scheduledEventId
    };
}

export function deleteScheduledEventRequest(scheduledEventId) {
    return {
        type: types.DELETE_SCHEDULED_EVENT_REQUEST,
        payload: scheduledEventId,
    };
}

export function deleteScheduledEventFailure(error) {
    return {
        type: types.DELETE_SCHEDULED_EVENT_FAILURE,
        payload: error
    };
}


export function updateScheduledEvent(projectId, scheduledEventId, values) {

    return function (dispatch) {
        var promise = putApi(`scheduledEvent/${projectId}/${scheduledEventId}`, values);
        dispatch(updateScheduledEventRequest());

        promise.then(function (updatedScheduledEvent) {
            dispatch(updateScheduledEventSuccess(updatedScheduledEvent.data));
        }, function (error) {
            if (error && error.response && error.response.data) {
                error = error.response.data;
            }
            if (error && error.data) {
                error = error.data;
            }
            if (error && error.message) {
                error = error.message;
            }
            else {
                error = 'Network Error';
            }
            dispatch(updateScheduledEventFailure(errors(error)));
        });
        return promise;
    };
}

export function updateScheduledEventSuccess(updatedScheduledEvent) {
    return {
        type: types.UPDATE_SCHEDULED_EVENT_SUCCESS,
        payload: updatedScheduledEvent
    };
}

export function updateScheduledEventRequest() {
    return {
        type: types.UPDATE_SCHEDULED_EVENT_REQUEST,
    };
}

export function updateScheduledEventFailure(error) {
    return {
        type: types.UPDATE_SCHEDULED_EVENT_FAILURE,
        payload: error
    };
}