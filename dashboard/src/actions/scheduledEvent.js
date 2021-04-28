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

export function fetchSubProjectScheduledEventsRequest() {
    return {
        type: types.FETCH_SUBPROJECT_SCHEDULED_EVENTS_REQUEST,
    };
}

export function fetchSubProjectScheduledEventsSuccess(payload) {
    return {
        type: types.FETCH_SUBPROJECT_SCHEDULED_EVENTS_SUCCESS,
        payload,
    };
}

export function fetchSubProjectScheduledEventsFailure(error) {
    return {
        type: types.FETCH_SUBPROJECT_SCHEDULED_EVENTS_FAILURE,
        payload: error,
    };
}

export const fetchSubProjectScheduledEvents = projectId => async dispatch => {
    try {
        dispatch(fetchSubProjectScheduledEventsRequest());
        const response = await getApi(
            `scheduledEvent/${projectId}/scheduledEvents/all`
        );
        dispatch(fetchSubProjectScheduledEventsSuccess(response.data));
    } catch (error) {
        const errorMsg =
            error.response && error.response.data
                ? error.response.data
                : error.data
                ? error.data
                : error.message
                ? error.message
                : 'Network Error';
        dispatch(fetchSubProjectScheduledEventsFailure(errorMsg));
    }
};

export const fetchOngoingScheduledEventsRequest = () => ({
    type: types.FETCH_ONGOING_SCHEDULED_EVENTS_REQUEST,
});

export const fetchOngoingScheduledEventsSuccess = payload => ({
    type: types.FETCH_ONGOING_SCHEDULED_EVENTS_SUCCESS,
    payload,
});

export const fetchOngoingScheduledEventsFailure = error => ({
    type: types.FETCH_ONGOING_SCHEDULED_EVENTS_FAILURE,
    payload: error,
});

export const fetchOngoingScheduledEvents = projectId => async dispatch => {
    try {
        dispatch(fetchOngoingScheduledEventsRequest());

        const response = await getApi(
            `scheduledEvent/${projectId}/ongoingEvent`
        );
        dispatch(fetchOngoingScheduledEventsSuccess(response.data));
    } catch (error) {
        const errorMsg =
            error.response && error.response.data
                ? error.response.data
                : error.data
                ? error.data
                : error.message
                ? error.message
                : 'Network Error';
        dispatch(fetchOngoingScheduledEventsFailure(errorMsg));
    }
};

export const fetchSubProjectOngoingScheduledEventsRequest = () => ({
    type: types.FETCH_SUBPROJECT_ONGOING_SCHEDULED_EVENTS_REQUEST,
});

export const fetchSubProjectOngoingScheduledEventsSuccess = payload => ({
    type: types.FETCH_SUBPROJECT_ONGOING_SCHEDULED_EVENTS_SUCCESS,
    payload,
});

export const fetchSubProjectOngoingScheduledEventsFailure = error => ({
    type: types.FETCH_SUBPROJECT_ONGOING_SCHEDULED_EVENTS_FAILURE,
    payload: error,
});

export const fetchSubProjectOngoingScheduledEvents = projectId => async dispatch => {
    try {
        dispatch(fetchSubProjectOngoingScheduledEventsRequest());
        const response = await getApi(
            `scheduledEvent/${projectId}/ongoingEvent/all`
        );
        dispatch(fetchSubProjectOngoingScheduledEventsSuccess(response.data));
    } catch (error) {
        const errorMsg =
            error.response && error.response.data
                ? error.response.data
                : error.data
                ? error.data
                : error.message
                ? error.message
                : 'Network Error';
        dispatch(fetchSubProjectOngoingScheduledEventsFailure(errorMsg));
    }
};

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

export function deleteScheduledEventSuccess(payload) {
    return {
        type: types.DELETE_SCHEDULED_EVENT_SUCCESS,
        payload,
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

export const cancelScheduledEvent = (
    projectId,
    scheduledEventId,
    history,
    redirect,
    closeModal,
    modalId
) => async dispatch => {
    try {
        dispatch(cancelScheduledEventRequest());

        const response = await putApi(
            `scheduledEvent/${projectId}/${scheduledEventId}/cancel`
        );

        dispatch(cancelScheduledEventSuccess(response.data));
        closeModal({ id: modalId });
        history.push(redirect);
    } catch (error) {
        const errorMsg =
            error.response && error.response.data
                ? error.response.data
                : error.data
                ? error.data
                : error.message
                ? error.message
                : 'Network Error';
        dispatch(cancelScheduledEventFailure(errorMsg));
    }
};

export function cancelScheduledEventSuccess(payload) {
    return {
        type: types.CANCEL_SCHEDULED_EVENT_SUCCESS,
        payload,
    };
}

export function cancelScheduledEventRequest() {
    return {
        type: types.CANCEL_SCHEDULED_EVENT_REQUEST,
    };
}

export function cancelScheduledEventFailure(error) {
    return {
        type: types.CANCEL_SCHEDULED_EVENT_FAILURE,
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
            function(scheduledEvent) {
                dispatch(updateScheduledEventSuccess(scheduledEvent.data));
            },
            function(error) {
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

// Scheduled Event Note

export const fetchScheduledEventNotesInternalRequest = () => ({
    type: types.FETCH_SCHEDULED_EVENT_NOTES_INTERNAL_REQUEST,
});

export const fetchScheduledEventNotesInternalSuccess = payload => ({
    type: types.FETCH_SCHEDULED_EVENT_NOTES_INTERNAL_SUCCESS,
    payload,
});

export const fetchScheduledEventNotesInternalFailure = error => ({
    type: types.FETCH_SCHEDULED_EVENT_NOTES_INTERNAL_FAILURE,
    payload: error,
});

export const fetchScheduledEventNotesInternal = (
    projectId,
    scheduledEventId,
    limit,
    skip
) => async dispatch => {
    try {
        dispatch(fetchScheduledEventNotesInternalRequest());
        skip = Number(skip);
        limit = Number(limit);

        let response = {};
        if (skip >= 0 && limit >= 0) {
            response = await getApi(
                `scheduledEvent/${projectId}/${scheduledEventId}/notes?limit=${limit}&skip=${skip}`
            );
        } else {
            response = await getApi(
                `scheduledEvent/${projectId}/${scheduledEventId}/notes?`
            );
        }

        const { data, count } = response.data;
        dispatch(
            fetchScheduledEventNotesInternalSuccess({
                data,
                count,
                skip,
                limit,
            })
        );
    } catch (error) {
        const errorMsg =
            error.response && error.response.data
                ? error.response.data
                : error.data
                ? error.data
                : error.message
                ? error.message
                : 'Network Error';
        dispatch(fetchScheduledEventNotesInternalFailure(errorMsg));
    }
};

export const createScheduledEventNoteRequest = () => ({
    type: types.CREATE_SCHEDULED_EVENT_NOTE_REQUEST,
});

export const createScheduledEventNoteSuccess = payload => ({
    type: types.CREATE_SCHEDULED_EVENT_NOTE_SUCCESS,
    payload,
});

export const createScheduledEventNoteFailure = error => ({
    type: types.CREATE_SCHEDULED_EVENT_NOTE_FAILURE,
    payload: error,
});

export const createScheduledEventNote = (
    projectId,
    scheduledEventId,
    data
) => async dispatch => {
    try {
        dispatch(createScheduledEventNoteRequest());

        const response = await postApi(
            `scheduledEvent/${projectId}/${scheduledEventId}/notes`,
            data
        );

        dispatch(createScheduledEventNoteSuccess(response.data));
    } catch (error) {
        const errorMsg =
            error.response && error.response.data
                ? error.response.data
                : error.data
                ? error.data
                : error.message
                ? error.message
                : 'Network Error';
        dispatch(createScheduledEventNoteFailure(errorMsg));
    }
};

export const updateScheduledEventNoteInternalRequest = () => ({
    type: types.UPDATE_SCHEDULED_EVENT_NOTE_INTERNAL_REQUEST,
});

export const updateScheduledEventNoteInternalSuccess = payload => ({
    type: types.UPDATE_SCHEDULED_EVENT_NOTE_INTERNAL_SUCCESS,
    payload,
});

export const updateScheduledEventNoteInternalFailure = error => ({
    type: types.UPDATE_SCHEDULED_EVENT_NOTE_INTERNAL_FAILURE,
    paylod: error,
});

export const updateScheduledEventNoteInternal = (
    projectId,
    scheduledEventId,
    scheduledEventNoteId,
    data
) => async dispatch => {
    try {
        dispatch(updateScheduledEventNoteInternalRequest());
        const response = await putApi(
            `scheduledEvent/${projectId}/${scheduledEventId}/notes/${scheduledEventNoteId}`,
            data
        );

        dispatch(updateScheduledEventNoteInternalSuccess(response.data));
    } catch (error) {
        const errorMsg =
            error.response && error.response.data
                ? error.response.data
                : error.data
                ? error.data
                : error.message
                ? error.message
                : 'Network Error';
        dispatch(updateScheduledEventNoteInternalFailure(errorMsg));
    }
};

export const updateScheduledEventNoteInvestigationRequest = () => ({
    type: types.UPDATE_SCHEDULED_EVENT_NOTE_INVESTIGATION_REQUEST,
});

export const updateScheduledEventNoteInvestigationSuccess = payload => ({
    type: types.UPDATE_SCHEDULED_EVENT_NOTE_INVESTIGATION_SUCCESS,
    payload,
});

export const updateScheduledEventNoteInvestigationFailure = error => ({
    type: types.UPDATE_SCHEDULED_EVENT_NOTE_INVESTIGATION_FAILURE,
    paylod: error,
});

export const updateScheduledEventNoteInvestigation = (
    projectId,
    scheduledEventId,
    scheduledEventNoteId,
    data
) => async dispatch => {
    try {
        dispatch(updateScheduledEventNoteInvestigationRequest());

        const response = await putApi(
            `scheduledEvent/${projectId}/${scheduledEventId}/notes/${scheduledEventNoteId}`,
            data
        );

        dispatch(updateScheduledEventNoteInvestigationSuccess(response.data));
    } catch (error) {
        const errorMsg =
            error.response && error.response.data
                ? error.response.data
                : error.data
                ? error.data
                : error.message
                ? error.message
                : 'Network Error';
        dispatch(updateScheduledEventNoteInvestigationFailure(errorMsg));
    }
};

export const deleteScheduledEventNoteRequest = () => ({
    type: types.DELETE_SCHEDULED_EVENT_NOTE_REQUEST,
});

export const deleteScheduledEventNoteSuccess = payload => ({
    type: types.DELETE_SCHEDULED_EVENT_NOTE_SUCCESS,
    payload,
});

export const deleteScheduledEventNoteFailure = error => ({
    type: types.DELETE_SCHEDULED_EVENT_NOTE_FAILURE,
    payload: error,
});

export const deleteScheduledEventNote = (
    projectId,
    scheduledEventId,
    scheduledEventNoteId
) => async dispatch => {
    try {
        dispatch(deleteScheduledEventNoteRequest());

        const response = await deleteApi(
            `scheduledEvent/${projectId}/${scheduledEventId}/notes/${scheduledEventNoteId}`
        );
        dispatch(deleteScheduledEventNoteSuccess(response.data));
    } catch (error) {
        const errorMsg =
            error.response && error.response.data
                ? error.response.data
                : error.data
                ? error.data
                : error.message
                ? error.message
                : 'Network Error';
        dispatch(deleteScheduledEventNoteFailure(errorMsg));
    }
};

export const resolveScheduledEventRequest = () => ({
    type: types.RESOLVE_SCHEDULED_EVENT_REQUEST,
});

export const resolveScheduledEventSuccess = payload => ({
    type: types.RESOLVE_SCHEDULED_EVENT_SUCCESS,
    payload,
});

export const resolveScheduledEventFailure = error => ({
    type: types.RESOLVE_SCHEDULED_EVENT_FAILURE,
    payload: error,
});

export const resolveScheduledEvent = (
    projectId,
    scheduledEventId
) => async dispatch => {
    try {
        dispatch(resolveScheduledEventRequest());

        const response = await putApi(
            `scheduledEvent/${projectId}/resolve/${scheduledEventId}`
        );
        dispatch(resolveScheduledEventSuccess(response.data));
    } catch (error) {
        const errorMsg =
            error.response && error.response.data
                ? error.response.data
                : error.data
                ? error.data
                : error.message
                ? error.message
                : 'Network Error';
        dispatch(resolveScheduledEventFailure(errorMsg));
    }
};
export const nextPage = projectId => {
    return {
        type: types.NEXT_PAGE,
        payload: projectId,
    };
};
export const prevPage = projectId => {
    return {
        type: types.PREV_PAGE,
        payload: projectId,
    };
};

export function fetchScheduledEventRequest() {
    return {
        type: types.FETCH_SCHEDULED_EVENT_REQUEST_SLUG,
    };
}

export function fetchScheduledEventSuccess(payload) {
    return {
        type: types.FETCH_SCHEDULED_EVENT_SUCCESS_SLUG,
        payload,
    };
}

export function fetchScheduledEventFailure(error) {
    return {
        type: types.FETCH_SCHEDULED_EVENT_FAILURE_SLUG,
        payload: error,
    };
}

export function fetchScheduledEvent(projectId, slug) {
    return function(dispatch) {
        const promise = getApi(`scheduledEvent/${projectId}/slug/${slug}`);
        dispatch(fetchScheduledEventRequest());

        promise.then(
            function(component) {
                dispatch(fetchScheduledEventSuccess(component.data));
            },
            function(error) {
                const errorMsg =
                    error.response && error.response.data
                        ? error.response.data
                        : error.data
                        ? error.data
                        : error.message
                        ? error.message
                        : 'Network Error';
                dispatch(fetchScheduledEventFailure(errorMsg));
            }
        );

        return promise;
    };
}
