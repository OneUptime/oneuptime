import { postApi, getApi, deleteApi, putApi } from '../api';
import * as types from '../constants/scheduledEvent';
import errors from '../errors';

export const fetchscheduledEvents = (
    projectId,
    skip,
    limit
) => async dispatch => {
    skip = Number(skip);
    limit = Number(limit);
    dispatch(fetchscheduledEventsRequest());

    try {
        let response = {};
        if (!skip && !limit) {
            response = await getApi(
                `scheduledEvent/${projectId}?skip=${0}&limit=${10}`
            );
        } else {
            response = await getApi(
                `scheduledEvent/${projectId}?skip=${skip}&limit=${limit}`
            );
        }
        dispatch(fetchscheduledEventsSuccess(response.data));
    } catch (error) {
        const errorMsg =
            error.response && error.response.data
                ? error.response.data
                : error.data
                ? error.data
                : error.message
                ? error.message
                : 'Network Error';
        dispatch(fetchscheduledEventsFailure(errorMsg));
    }
};

export function fetchscheduledEventsSuccess(scheduledEvents) {
    return {
        type: types.FETCH_SCHEDULED_EVENTS_SUCCESS,
        payload: scheduledEvents,
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
        payload: error,
    };
}

export const createScheduledEvent = (projectId, values) => async dispatch => {
    try {
        dispatch(createScheduledEventRequest());

        const response = await postApi(`scheduledEvent/${projectId}`, values);
        dispatch(createScheduledEventSuccess(response.data));
    } catch (error) {
        const errorMsg =
            error.response && error.response.data
                ? error.response.data
                : error.data
                ? error.data
                : error.message
                ? error.message
                : 'Network Error';
        dispatch(createScheduledEventFailure(errorMsg));
    }
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(createScheduledEventFailure(errors(error)));
            }
        );
        return promise;
};
}

export function createScheduledEventSuccess(newScheduledEvent) {
    return {
        type: types.CREATE_SCHEDULED_EVENT_SUCCESS,
        payload: newScheduledEvent,
    };
}

export function createScheduledEventRequest() {
    return {
        type: types.CREATE_SCHEDULED_EVENT_REQUEST,
    };
}

export function createScheduledEventFailure(error) {
    return {
        type: types.CREATE_SCHEDULED_EVENT_FAILURE,
        payload: error,
    };
}

export function deleteScheduledEvent(projectId, scheduledEventId) {
    return function(dispatch) {
        const promise = deleteApi(
            `scheduledEvent/${projectId}/${scheduledEventId}`
        );
        dispatch(deleteScheduledEventRequest(scheduledEventId));

        promise.then(
            function(scheduledEvent) {
                dispatch(deleteScheduledEventSuccess(scheduledEvent.data._id));
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
                dispatch(deleteScheduledEventFailure({ error: errors(error) }));
            }
        );
        return promise;
    };
}

export function deleteScheduledEventSuccess(scheduledEventId) {
    return {
        type: types.DELETE_SCHEDULED_EVENT_SUCCESS,
        payload: scheduledEventId,
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
        payload: error,
    };
}

export function updateScheduledEvent(projectId, scheduledEventId, values) {
    return function(dispatch) {
        const promise = putApi(
            `scheduledEvent/${projectId}/${scheduledEventId}`,
            values
        );
        dispatch(updateScheduledEventRequest());

        promise.then(
            function(updatedScheduledEvent) {
                dispatch(
                    updateScheduledEventSuccess(updatedScheduledEvent.data)
                );
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
                dispatch(updateScheduledEventFailure(errors(error)));
            }
        );
        return promise;
    };
}

export function updateScheduledEventSuccess(updatedScheduledEvent) {
    return {
        type: types.UPDATE_SCHEDULED_EVENT_SUCCESS,
        payload: updatedScheduledEvent,
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
        payload: error,
    };
}
