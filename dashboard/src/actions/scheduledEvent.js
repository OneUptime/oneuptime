import { postApi, getApi, deleteApi, putApi } from '../api';
import * as types from '../constants/scheduledEvent';

export const fetchscheduledEvent = (
    projectId,
    scheduledEventId
) => async dispatch => {
    try {
        dispatch(fetchscheduledEventRequest());

        const response = await getApi(
            `scheduledEvent/${projectId}/${scheduledEventId}`
        );
        dispatch(fetchscheduledEventSuccess(response.data));
    } catch (error) {
        const errorMsg =
            error.response && error.response.data
                ? error.response.data
                : error.data
                ? error.data
                : error.message
                ? error.message
                : 'Network Error';
        dispatch(fetchscheduledEventFailure(errorMsg));
    }
};

export function fetchscheduledEventSuccess(scheduledEvents) {
    return {
        type: types.FETCH_SCHEDULED_EVENT_SUCCESS,
        payload: scheduledEvents,
    };
}

export function fetchscheduledEventRequest() {
    return {
        type: types.FETCH_SCHEDULED_EVENT_REQUEST,
    };
}

export function fetchscheduledEventFailure(error) {
    return {
        type: types.FETCH_SCHEDULED_EVENT_FAILURE,
        payload: error,
    };
}

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
        const { data, count } = response.data;
        dispatch(fetchscheduledEventsSuccess({ data, count, skip, limit }));
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
};

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

export const deleteScheduledEvent = (
    projectId,
    scheduledEventId
) => async dispatch => {
    try {
        dispatch(deleteScheduledEventRequest());

        const response = await deleteApi(
            `scheduledEvent/${projectId}/${scheduledEventId}`
        );
        dispatch(deleteScheduledEventSuccess(response.data));
    } catch (error) {
        const errorMsg =
            error.response && error.response.data
                ? error.response.data
                : error.data
                ? error.data
                : error.message
                ? error.message
                : 'Network Error';
        dispatch(deleteScheduledEventFailure(errorMsg));
    }
};

export function deleteScheduledEventSuccess(scheduledEventId) {
    return {
        type: types.DELETE_SCHEDULED_EVENT_SUCCESS,
        payload: scheduledEventId,
    };
}

export function deleteScheduledEventRequest() {
    return {
        type: types.DELETE_SCHEDULED_EVENT_REQUEST,
    };
}

export function deleteScheduledEventFailure(error) {
    return {
        type: types.DELETE_SCHEDULED_EVENT_FAILURE,
        payload: error,
    };
}

export const updateScheduledEvent = (
    projectId,
    scheduledEventId,
    values
) => async dispatch => {
    try {
        dispatch(updateScheduledEventRequest());

        const response = await putApi(
            `scheduledEvent/${projectId}/${scheduledEventId}`,
            values
        );
        dispatch(updateScheduledEventSuccess(response.data));
    } catch (error) {
        const errorMsg =
            error.response && error.response.data
                ? error.response.data
                : error.data
                ? error.data
                : error.message
                ? error.message
                : 'Network Error';
        dispatch(updateScheduledEventFailure(errorMsg));
    }
};

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
