import BackendAPI from 'common-ui/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/scheduledEvent';
import ErrorPayload from 'common-ui/src/payload-types/error';
import PositiveNumber from 'common/types/PositiveNumber';

export const fetchscheduledEvent =
    (projectId: $TSFixMe, scheduledEventId: $TSFixMe) =>
    async (dispatch: Dispatch) => {
        try {
            dispatch(fetchscheduledEventRequest());

            const response = await BackendAPI.get(
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

export const fetchscheduledEventSuccess = (scheduledEvents: $TSFixMe) => {
    return {
        type: types.FETCH_SCHEDULED_EVENT_SUCCESS,
        payload: scheduledEvents,
    };
};

export const fetchscheduledEventRequest = () => {
    return {
        type: types.FETCH_SCHEDULED_EVENT_REQUEST,
    };
};

export const addScheduleEvent = (payload: $TSFixMe) => {
    return {
        type: types.ADD_SCHEDULE_EVENT,
        payload: payload,
    };
};
export const fetchscheduledEventFailure = (error: ErrorPayload) => {
    return {
        type: types.FETCH_SCHEDULED_EVENT_FAILURE,
        payload: error,
    };
};

export const fetchscheduledEvents =
    (projectId: $TSFixMe, skip: PositiveNumber, limit: PositiveNumber) =>
    async (dispatch: Dispatch) => {
        skip = Number(skip);
        limit = Number(limit);
        dispatch(fetchscheduledEventsRequest());

        try {
            let response = {};
            if (!skip && !limit) {
                response = await BackendAPI.get(
                    `scheduledEvent/${projectId}?skip=${0}&limit=${10}`
                );
            } else {
                response = await BackendAPI.get(
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

export const fetchscheduledEventsSuccess = (scheduledEvents: $TSFixMe) => {
    return {
        type: types.FETCH_SCHEDULED_EVENTS_SUCCESS,
        payload: scheduledEvents,
    };
};

export const fetchscheduledEventsRequest = () => {
    return {
        type: types.FETCH_SCHEDULED_EVENTS_REQUEST,
    };
};

export const fetchscheduledEventsFailure = (error: ErrorPayload) => {
    return {
        type: types.FETCH_SCHEDULED_EVENTS_FAILURE,
        payload: error,
    };
};

export const fetchSubProjectScheduledEventsRequest = () => {
    return {
        type: types.FETCH_SUBPROJECT_SCHEDULED_EVENTS_REQUEST,
    };
};

export const fetchSubProjectScheduledEventsSuccess = (payload: $TSFixMe) => {
    return {
        type: types.FETCH_SUBPROJECT_SCHEDULED_EVENTS_SUCCESS,
        payload,
    };
};

export const fetchSubProjectScheduledEventsFailure = (error: ErrorPayload) => {
    return {
        type: types.FETCH_SUBPROJECT_SCHEDULED_EVENTS_FAILURE,
        payload: error,
    };
};

export const fetchSubProjectScheduledEvents =
    (projectId: $TSFixMe) => async (dispatch: Dispatch) => {
        try {
            dispatch(fetchSubProjectScheduledEventsRequest());
            const response = await BackendAPI.get(
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

export const fetchOngoingScheduledEventsFailure = (error: ErrorPayload) => ({
    type: types.FETCH_ONGOING_SCHEDULED_EVENTS_FAILURE,
    payload: error,
});

export const fetchOngoingScheduledEvents =
    (projectId: $TSFixMe) => async (dispatch: Dispatch) => {
        try {
            dispatch(fetchOngoingScheduledEventsRequest());

            const response = await BackendAPI.get(
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
    error: ErrorPayload
) => ({
    type: types.FETCH_SUBPROJECT_ONGOING_SCHEDULED_EVENTS_FAILURE,
    payload: error,
});

export const fetchSubProjectOngoingScheduledEvents =
    (projectId: $TSFixMe) => async (dispatch: Dispatch) => {
        try {
            dispatch(fetchSubProjectOngoingScheduledEventsRequest());
            const response = await BackendAPI.get(
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
    (projectId: $TSFixMe, values: $TSFixMe) => async (dispatch: Dispatch) => {
        try {
            dispatch(createScheduledEventRequest());

            const response = await BackendAPI.post(
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

export const createScheduledEventSuccess = (newScheduledEvent: $TSFixMe) => {
    return {
        type: types.CREATE_SCHEDULED_EVENT_SUCCESS,
        payload: newScheduledEvent,
    };
};

export const createScheduledEventRequest = () => {
    return {
        type: types.CREATE_SCHEDULED_EVENT_REQUEST,
    };
};

export const createScheduledEventFailure = (error: ErrorPayload) => {
    return {
        type: types.CREATE_SCHEDULED_EVENT_FAILURE,
        payload: error,
    };
};

export const deleteScheduledEvent =
    (projectId: $TSFixMe, scheduledEventId: $TSFixMe) =>
    async (dispatch: Dispatch) => {
        try {
            dispatch(deleteScheduledEventRequest());

            const response =
                await delete `scheduledEvent/${projectId}/${scheduledEventId}`;

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

export const deleteScheduledEventSuccess = (payload: $TSFixMe) => {
    return {
        type: types.DELETE_SCHEDULED_EVENT_SUCCESS,
        payload,
    };
};

export const deleteScheduledEventRequest = () => {
    return {
        type: types.DELETE_SCHEDULED_EVENT_REQUEST,
    };
};

export const deleteScheduledEventFailure = (error: ErrorPayload) => {
    return {
        type: types.DELETE_SCHEDULED_EVENT_FAILURE,
        payload: error,
    };
};

export const cancelScheduledEvent =
    (
        projectId: $TSFixMe,
        scheduledEventId: $TSFixMe,
        history: $TSFixMe,
        redirect: $TSFixMe,
        closeModal: $TSFixMe,
        modalId: $TSFixMe
    ) =>
    async (dispatch: Dispatch) => {
        try {
            dispatch(cancelScheduledEventRequest());

            const response = await BackendAPI.put(
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

export const cancelScheduledEventSuccess = (payload: $TSFixMe) => {
    return {
        type: types.CANCEL_SCHEDULED_EVENT_SUCCESS,
        payload,
    };
};

export const cancelScheduledEventRequest = () => {
    return {
        type: types.CANCEL_SCHEDULED_EVENT_REQUEST,
    };
};

export const cancelScheduledEventFailure = (error: ErrorPayload) => {
    return {
        type: types.CANCEL_SCHEDULED_EVENT_FAILURE,
        payload: error,
    };
};

export function updateScheduledEvent(
    projectId: $TSFixMe,
    scheduledEventId: $TSFixMe,
    values: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.put(
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

export const updateScheduledEventSuccess = (
    updatedScheduledEvent: $TSFixMe
) => {
    return {
        type: types.UPDATE_SCHEDULED_EVENT_SUCCESS,
        payload: updatedScheduledEvent,
    };
};

export const updateScheduledEventRequest = () => {
    return {
        type: types.UPDATE_SCHEDULED_EVENT_REQUEST,
    };
};

export const updateScheduledEventFailure = (error: ErrorPayload) => {
    return {
        type: types.UPDATE_SCHEDULED_EVENT_FAILURE,
        payload: error,
    };
};

// Scheduled Event Note

export const fetchScheduledEventNotesInternalRequest = () => ({
    type: types.FETCH_SCHEDULED_EVENT_NOTES_INTERNAL_REQUEST,
});

export const fetchScheduledEventNotesInternalSuccess = (payload: $TSFixMe) => ({
    type: types.FETCH_SCHEDULED_EVENT_NOTES_INTERNAL_SUCCESS,
    payload,
});

export const fetchScheduledEventNotesInternalFailure = (
    error: ErrorPayload
) => ({
    type: types.FETCH_SCHEDULED_EVENT_NOTES_INTERNAL_FAILURE,
    payload: error,
});

export const fetchScheduledEventNotesInternal =
    (
        projectId: $TSFixMe,
        scheduledEventId: $TSFixMe,
        limit: PositiveNumber,
        skip: PositiveNumber,
        type: $TSFixMe
    ) =>
    async (dispatch: Dispatch) => {
        try {
            dispatch(fetchScheduledEventNotesInternalRequest());
            skip = Number(skip);
            limit = Number(limit);

            let response = {};
            if (skip >= 0 && limit >= 0) {
                response = await BackendAPI.get(
                    `scheduledEvent/${projectId}/${scheduledEventId}/notes?limit=${limit}&skip=${skip}&type=${type}`
                );
            } else {
                response = await BackendAPI.get(
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

export const createScheduledEventNoteFailure = (error: ErrorPayload) => ({
    type: types.CREATE_SCHEDULED_EVENT_NOTE_FAILURE,
    payload: error,
});

export const createScheduledEventNote =
    (projectId: $TSFixMe, scheduledEventId: $TSFixMe, data: $TSFixMe) =>
    async (dispatch: Dispatch) => {
        try {
            dispatch(createScheduledEventNoteRequest());

            const response = await BackendAPI.post(
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

export const updateScheduledEventNoteInternalFailure = (
    error: ErrorPayload
) => ({
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
    async (dispatch: Dispatch) => {
        try {
            dispatch(updateScheduledEventNoteInternalRequest());
            const response = await BackendAPI.put(
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
    error: ErrorPayload
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
    async (dispatch: Dispatch) => {
        try {
            dispatch(updateScheduledEventNoteInvestigationRequest());

            const response = await BackendAPI.put(
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

export const deleteScheduledEventNoteFailure = (error: ErrorPayload) => ({
    type: types.DELETE_SCHEDULED_EVENT_NOTE_FAILURE,
    payload: error,
});

export const deleteScheduledEventNote =
    (
        projectId: $TSFixMe,
        scheduledEventId: $TSFixMe,
        scheduledEventNoteId: $TSFixMe
    ) =>
    async (dispatch: Dispatch) => {
        try {
            dispatch(deleteScheduledEventNoteRequest());

            const response =
                await delete `scheduledEvent/${projectId}/${scheduledEventId}/notes/${scheduledEventNoteId}`;

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

export const resolveScheduledEventFailure = (error: ErrorPayload) => ({
    type: types.RESOLVE_SCHEDULED_EVENT_FAILURE,
    payload: error,
});

export const resolveScheduledEvent =
    (projectId: $TSFixMe, scheduledEventId: $TSFixMe) =>
    async (dispatch: Dispatch) => {
        try {
            dispatch(resolveScheduledEventRequest());

            const response = await BackendAPI.put(
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

export const fetchScheduledEventRequest = () => {
    return {
        type: types.FETCH_SCHEDULED_EVENT_REQUEST_SLUG,
    };
};

export const fetchScheduledEventSuccess = (payload: $TSFixMe) => {
    return {
        type: types.FETCH_SCHEDULED_EVENT_SUCCESS_SLUG,
        payload,
    };
};

export const fetchScheduledEventFailure = (error: ErrorPayload) => {
    return {
        type: types.FETCH_SCHEDULED_EVENT_FAILURE_SLUG,
        payload: error,
    };
};

export const fetchScheduledEvent = (projectId: $TSFixMe, slug: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(
            `scheduledEvent/${projectId}/slug/${slug}`
        );
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
};
