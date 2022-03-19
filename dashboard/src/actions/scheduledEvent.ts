import { postApi, getApi, deleteApi, putApi } from '../api';
import * as types from '../constants/scheduledEvent';

export const fetchscheduledEvent =
    (projectId: $TSFixMe, scheduledEventId: $TSFixMe) =>
    async (dispatch: $TSFixMe) => {
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

export function fetchscheduledEventSuccess(scheduledEvents: $TSFixMe) {
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

export function addScheduleEvent(payload: $TSFixMe) {
    return {
        type: types.ADD_SCHEDULE_EVENT,
        payload: payload,
    };
}
export function fetchscheduledEventFailure(error: $TSFixMe) {
    return {
        type: types.FETCH_SCHEDULED_EVENT_FAILURE,
        payload: error,
    };
}

export const fetchscheduledEvents =
    (projectId: $TSFixMe, skip: $TSFixMe, limit: $TSFixMe) =>
    async (dispatch: $TSFixMe) => {
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

export function fetchscheduledEventsSuccess(scheduledEvents: $TSFixMe) {
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

export function fetchscheduledEventsFailure(error: $TSFixMe) {
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

export function fetchSubProjectScheduledEventsSuccess(payload: $TSFixMe) {
    return {
        type: types.FETCH_SUBPROJECT_SCHEDULED_EVENTS_SUCCESS,
        payload,
    };
}

export function fetchSubProjectScheduledEventsFailure(error: $TSFixMe) {
    return {
        type: types.FETCH_SUBPROJECT_SCHEDULED_EVENTS_FAILURE,
        payload: error,
    };
}

export const fetchSubProjectScheduledEvents =
    (projectId: $TSFixMe) => async (dispatch: $TSFixMe) => {
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

export const fetchOngoingScheduledEventsSuccess = (payload: $TSFixMe) => ({
    type: types.FETCH_ONGOING_SCHEDULED_EVENTS_SUCCESS,
    payload,
});

export const fetchOngoingScheduledEventsFailure = (error: $TSFixMe) => ({
    type: types.FETCH_ONGOING_SCHEDULED_EVENTS_FAILURE,
    payload: error,
});

export const fetchOngoingScheduledEvents =
    (projectId: $TSFixMe) => async (dispatch: $TSFixMe) => {
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

export const fetchSubProjectOngoingScheduledEventsSuccess = (
    payload: $TSFixMe
) => ({
    type: types.FETCH_SUBPROJECT_ONGOING_SCHEDULED_EVENTS_SUCCESS,
    payload,
});

export const fetchSubProjectOngoingScheduledEventsFailure = (
    error: $TSFixMe
) => ({
    type: types.FETCH_SUBPROJECT_ONGOING_SCHEDULED_EVENTS_FAILURE,
    payload: error,
});

export const fetchSubProjectOngoingScheduledEvents =
    (projectId: $TSFixMe) => async (dispatch: $TSFixMe) => {
        try {
            dispatch(fetchSubProjectOngoingScheduledEventsRequest());
            const response = await getApi(
                `scheduledEvent/${projectId}/ongoingEvent/all`
            );

            dispatch(
                fetchSubProjectOngoingScheduledEventsSuccess(response.data)
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
            dispatch(fetchSubProjectOngoingScheduledEventsFailure(errorMsg));
        }
    };

export const createScheduledEvent =
    (projectId: $TSFixMe, values: $TSFixMe) => async (dispatch: $TSFixMe) => {
        try {
            dispatch(createScheduledEventRequest());

            const response = await postApi(
                `scheduledEvent/${projectId}`,
                values
            );

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

export function createScheduledEventSuccess(newScheduledEvent: $TSFixMe) {
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

export function createScheduledEventFailure(error: $TSFixMe) {
    return {
        type: types.CREATE_SCHEDULED_EVENT_FAILURE,
        payload: error,
    };
}

export const deleteScheduledEvent =
    (projectId: $TSFixMe, scheduledEventId: $TSFixMe) =>
    async (dispatch: $TSFixMe) => {
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

export function deleteScheduledEventSuccess(payload: $TSFixMe) {
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

export function deleteScheduledEventFailure(error: $TSFixMe) {
    return {
        type: types.DELETE_SCHEDULED_EVENT_FAILURE,
        payload: error,
    };
}

export const cancelScheduledEvent =
    (
        projectId: $TSFixMe,
        scheduledEventId: $TSFixMe,
        history: $TSFixMe,
        redirect: $TSFixMe,
        closeModal: $TSFixMe,
        modalId: $TSFixMe
    ) =>
    async (dispatch: $TSFixMe) => {
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

export function cancelScheduledEventSuccess(payload: $TSFixMe) {
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

export function cancelScheduledEventFailure(error: $TSFixMe) {
    return {
        type: types.CANCEL_SCHEDULED_EVENT_FAILURE,
        payload: error,
    };
}

export function updateScheduledEvent(
    projectId: $TSFixMe,
    scheduledEventId: $TSFixMe,
    values: $TSFixMe
) {
    return function (dispatch: $TSFixMe) {
        const promise = putApi(
            `scheduledEvent/${projectId}/${scheduledEventId}`,
            values
        );
        dispatch(updateScheduledEventRequest());

        promise.then(
            function (scheduledEvent) {
                dispatch(updateScheduledEventSuccess(scheduledEvent.data));
            },
            function (error) {
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

export function updateScheduledEventSuccess(updatedScheduledEvent: $TSFixMe) {
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

export function updateScheduledEventFailure(error: $TSFixMe) {
    return {
        type: types.UPDATE_SCHEDULED_EVENT_FAILURE,
        payload: error,
    };
}

// Scheduled Event Note

export const fetchScheduledEventNotesInternalRequest = () => ({
    type: types.FETCH_SCHEDULED_EVENT_NOTES_INTERNAL_REQUEST,
});

export const fetchScheduledEventNotesInternalSuccess = (payload: $TSFixMe) => ({
    type: types.FETCH_SCHEDULED_EVENT_NOTES_INTERNAL_SUCCESS,
    payload,
});

export const fetchScheduledEventNotesInternalFailure = (error: $TSFixMe) => ({
    type: types.FETCH_SCHEDULED_EVENT_NOTES_INTERNAL_FAILURE,
    payload: error,
});

export const fetchScheduledEventNotesInternal =
    (
        projectId: $TSFixMe,
        scheduledEventId: $TSFixMe,
        limit: $TSFixMe,
        skip: $TSFixMe,
        type: $TSFixMe
    ) =>
    async (dispatch: $TSFixMe) => {
        try {
            dispatch(fetchScheduledEventNotesInternalRequest());
            skip = Number(skip);
            limit = Number(limit);

            let response = {};
            if (skip >= 0 && limit >= 0) {
                response = await getApi(
                    `scheduledEvent/${projectId}/${scheduledEventId}/notes?limit=${limit}&skip=${skip}&type=${type}`
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

export const createScheduledEventNoteSuccess = (payload: $TSFixMe) => ({
    type: types.CREATE_SCHEDULED_EVENT_NOTE_SUCCESS,
    payload,
});

export const createScheduledEventNoteFailure = (error: $TSFixMe) => ({
    type: types.CREATE_SCHEDULED_EVENT_NOTE_FAILURE,
    payload: error,
});

export const createScheduledEventNote =
    (projectId: $TSFixMe, scheduledEventId: $TSFixMe, data: $TSFixMe) =>
    async (dispatch: $TSFixMe) => {
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

export const updateScheduledEventNoteInternalSuccess = (payload: $TSFixMe) => ({
    type: types.UPDATE_SCHEDULED_EVENT_NOTE_INTERNAL_SUCCESS,
    payload,
});

export const updateScheduledEventNoteInternalFailure = (error: $TSFixMe) => ({
    type: types.UPDATE_SCHEDULED_EVENT_NOTE_INTERNAL_FAILURE,
    paylod: error,
});

export const updateScheduledEventNoteInternal =
    (
        projectId: $TSFixMe,
        scheduledEventId: $TSFixMe,
        scheduledEventNoteId: $TSFixMe,
        data: $TSFixMe
    ) =>
    async (dispatch: $TSFixMe) => {
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

export const updateScheduledEventNoteInvestigationSuccess = (
    payload: $TSFixMe
) => ({
    type: types.UPDATE_SCHEDULED_EVENT_NOTE_INVESTIGATION_SUCCESS,
    payload,
});

export const updateScheduledEventNoteInvestigationFailure = (
    error: $TSFixMe
) => ({
    type: types.UPDATE_SCHEDULED_EVENT_NOTE_INVESTIGATION_FAILURE,
    paylod: error,
});

export const updateScheduledEventNoteInvestigation =
    (
        projectId: $TSFixMe,
        scheduledEventId: $TSFixMe,
        scheduledEventNoteId: $TSFixMe,
        data: $TSFixMe
    ) =>
    async (dispatch: $TSFixMe) => {
        try {
            dispatch(updateScheduledEventNoteInvestigationRequest());

            const response = await putApi(
                `scheduledEvent/${projectId}/${scheduledEventId}/notes/${scheduledEventNoteId}`,
                data
            );

            dispatch(
                updateScheduledEventNoteInvestigationSuccess(response.data)
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
            dispatch(updateScheduledEventNoteInvestigationFailure(errorMsg));
        }
    };

export const deleteScheduledEventNoteRequest = () => ({
    type: types.DELETE_SCHEDULED_EVENT_NOTE_REQUEST,
});

export const deleteScheduledEventNoteSuccess = (payload: $TSFixMe) => ({
    type: types.DELETE_SCHEDULED_EVENT_NOTE_SUCCESS,
    payload,
});

export const deleteScheduledEventNoteFailure = (error: $TSFixMe) => ({
    type: types.DELETE_SCHEDULED_EVENT_NOTE_FAILURE,
    payload: error,
});

export const deleteScheduledEventNote =
    (
        projectId: $TSFixMe,
        scheduledEventId: $TSFixMe,
        scheduledEventNoteId: $TSFixMe
    ) =>
    async (dispatch: $TSFixMe) => {
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

export const resolveScheduledEventSuccess = (payload: $TSFixMe) => ({
    type: types.RESOLVE_SCHEDULED_EVENT_SUCCESS,
    payload,
});

export const resolveScheduledEventFailure = (error: $TSFixMe) => ({
    type: types.RESOLVE_SCHEDULED_EVENT_FAILURE,
    payload: error,
});

export const resolveScheduledEvent =
    (projectId: $TSFixMe, scheduledEventId: $TSFixMe) =>
    async (dispatch: $TSFixMe) => {
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
export const nextPage = (projectId: $TSFixMe) => {
    return {
        type: types.NEXT_PAGE,
        payload: projectId,
    };
};
export const prevPage = (projectId: $TSFixMe) => {
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

export function fetchScheduledEventSuccess(payload: $TSFixMe) {
    return {
        type: types.FETCH_SCHEDULED_EVENT_SUCCESS_SLUG,
        payload,
    };
}

export function fetchScheduledEventFailure(error: $TSFixMe) {
    return {
        type: types.FETCH_SCHEDULED_EVENT_FAILURE_SLUG,
        payload: error,
    };
}

export function fetchScheduledEvent(projectId: $TSFixMe, slug: $TSFixMe) {
    return function (dispatch: $TSFixMe) {
        const promise = getApi(`scheduledEvent/${projectId}/slug/${slug}`);
        dispatch(fetchScheduledEventRequest());

        promise.then(
            function (component) {
                dispatch(fetchScheduledEventSuccess(component.data));
            },
            function (error) {
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
