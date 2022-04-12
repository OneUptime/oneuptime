import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/scheduledEvent';
import ErrorPayload from 'CommonUI/src/payload-types/error';
import PositiveNumber from 'Common/Types/PositiveNumber';

export const fetchscheduledEvent =
    (projectId: string, scheduledEventId: $TSFixMe) =>
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

export const fetchscheduledEventSuccess = (scheduledEvents: $TSFixMe): void => {
    return {
        type: types.FETCH_SCHEDULED_EVENT_SUCCESS,
        payload: scheduledEvents,
    };
};

export const fetchscheduledEventRequest = (): void => {
    return {
        type: types.FETCH_SCHEDULED_EVENT_REQUEST,
    };
};

export const addScheduleEvent = (payload: $TSFixMe): void => {
    return {
        type: types.ADD_SCHEDULE_EVENT,
        payload: payload,
    };
};
export const fetchscheduledEventFailure = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_SCHEDULED_EVENT_FAILURE,
        payload: error,
    };
};

export const fetchscheduledEvents =
    (projectId: string, skip: PositiveNumber, limit: PositiveNumber) =>
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

export const fetchscheduledEventsSuccess = (
    scheduledEvents: $TSFixMe
): void => {
    return {
        type: types.FETCH_SCHEDULED_EVENTS_SUCCESS,
        payload: scheduledEvents,
    };
};

export const fetchscheduledEventsRequest = (): void => {
    return {
        type: types.FETCH_SCHEDULED_EVENTS_REQUEST,
    };
};

export const fetchscheduledEventsFailure = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_SCHEDULED_EVENTS_FAILURE,
        payload: error,
    };
};

export const fetchSubProjectScheduledEventsRequest = (): void => {
    return {
        type: types.FETCH_SUBPROJECT_SCHEDULED_EVENTS_REQUEST,
    };
};

export const fetchSubProjectScheduledEventsSuccess = (
    payload: $TSFixMe
): void => {
    return {
        type: types.FETCH_SUBPROJECT_SCHEDULED_EVENTS_SUCCESS,
        payload,
    };
};

export const fetchSubProjectScheduledEventsFailure = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_SUBPROJECT_SCHEDULED_EVENTS_FAILURE,
        payload: error,
    };
};

export const fetchSubProjectScheduledEvents =
    (projectId: string) => async (dispatch: Dispatch) => {
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

export const fetchOngoingScheduledEventsRequest = (): void => ({
    type: types.FETCH_ONGOING_SCHEDULED_EVENTS_REQUEST,
});

export const fetchOngoingScheduledEventsSuccess = (
    payload: $TSFixMe
): void => ({
    type: types.FETCH_ONGOING_SCHEDULED_EVENTS_SUCCESS,
    payload,
});

export const fetchOngoingScheduledEventsFailure = (
    error: ErrorPayload
): void => ({
    type: types.FETCH_ONGOING_SCHEDULED_EVENTS_FAILURE,
    payload: error,
});

export const fetchOngoingScheduledEvents =
    (projectId: string) => async (dispatch: Dispatch) => {
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

export const fetchSubProjectOngoingScheduledEventsRequest = (): void => ({
    type: types.FETCH_SUBPROJECT_ONGOING_SCHEDULED_EVENTS_REQUEST,
});

export const fetchSubProjectOngoingScheduledEventsSuccess = (
    payload: $TSFixMe
): void => ({
    type: types.FETCH_SUBPROJECT_ONGOING_SCHEDULED_EVENTS_SUCCESS,
    payload,
});

export const fetchSubProjectOngoingScheduledEventsFailure = (
    error: ErrorPayload
): void => ({
    type: types.FETCH_SUBPROJECT_ONGOING_SCHEDULED_EVENTS_FAILURE,
    payload: error,
});

export const fetchSubProjectOngoingScheduledEvents =
    (projectId: string): void =>
    async (dispatch: Dispatch): void => {
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
    (projectId: string, values: $TSFixMe) => async (dispatch: Dispatch) => {
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

export const createScheduledEventSuccess = (
    newScheduledEvent: $TSFixMe
): void => {
    return {
        type: types.CREATE_SCHEDULED_EVENT_SUCCESS,
        payload: newScheduledEvent,
    };
};

export const createScheduledEventRequest = (): void => {
    return {
        type: types.CREATE_SCHEDULED_EVENT_REQUEST,
    };
};

export const createScheduledEventFailure = (error: ErrorPayload): void => {
    return {
        type: types.CREATE_SCHEDULED_EVENT_FAILURE,
        payload: error,
    };
};

export const deleteScheduledEvent =
    (projectId: string, scheduledEventId: $TSFixMe): void =>
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

export const deleteScheduledEventSuccess = (payload: $TSFixMe): void => {
    return {
        type: types.DELETE_SCHEDULED_EVENT_SUCCESS,
        payload,
    };
};

export const deleteScheduledEventRequest = (): void => {
    return {
        type: types.DELETE_SCHEDULED_EVENT_REQUEST,
    };
};

export const deleteScheduledEventFailure = (error: ErrorPayload): void => {
    return {
        type: types.DELETE_SCHEDULED_EVENT_FAILURE,
        payload: error,
    };
};

export const cancelScheduledEvent =
    (
        projectId: string,
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

export const cancelScheduledEventSuccess = (payload: $TSFixMe): void => {
    return {
        type: types.CANCEL_SCHEDULED_EVENT_SUCCESS,
        payload,
    };
};

export const cancelScheduledEventRequest = (): void => {
    return {
        type: types.CANCEL_SCHEDULED_EVENT_REQUEST,
    };
};

export const cancelScheduledEventFailure = (error: ErrorPayload): void => {
    return {
        type: types.CANCEL_SCHEDULED_EVENT_FAILURE,
        payload: error,
    };
};

export function updateScheduledEvent(
    projectId: string,
    scheduledEventId: $TSFixMe,
    values: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.put(
            `scheduledEvent/${projectId}/${scheduledEventId}`,
            values
        );
        dispatch(updateScheduledEventRequest());

        promise.then(
            function (scheduledEvent): void {
                dispatch(updateScheduledEventSuccess(scheduledEvent.data));
            },
            function (error): void {
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
): void => {
    return {
        type: types.UPDATE_SCHEDULED_EVENT_SUCCESS,
        payload: updatedScheduledEvent,
    };
};

export const updateScheduledEventRequest = (): void => {
    return {
        type: types.UPDATE_SCHEDULED_EVENT_REQUEST,
    };
};

export const updateScheduledEventFailure = (error: ErrorPayload): void => {
    return {
        type: types.UPDATE_SCHEDULED_EVENT_FAILURE,
        payload: error,
    };
};

// Scheduled Event Note

export const fetchScheduledEventNotesInternalRequest = (): void => ({
    type: types.FETCH_SCHEDULED_EVENT_NOTES_INTERNAL_REQUEST,
});

export const fetchScheduledEventNotesInternalSuccess = (
    payload: $TSFixMe
): void => ({
    type: types.FETCH_SCHEDULED_EVENT_NOTES_INTERNAL_SUCCESS,
    payload,
});

export const fetchScheduledEventNotesInternalFailure = (
    error: ErrorPayload
): void => ({
    type: types.FETCH_SCHEDULED_EVENT_NOTES_INTERNAL_FAILURE,
    payload: error,
});

export const fetchScheduledEventNotesInternal =
    (
        projectId: string,
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

export const createScheduledEventNoteRequest = (): void => ({
    type: types.CREATE_SCHEDULED_EVENT_NOTE_REQUEST,
});

export const createScheduledEventNoteSuccess = (payload: $TSFixMe): void => ({
    type: types.CREATE_SCHEDULED_EVENT_NOTE_SUCCESS,
    payload,
});

export const createScheduledEventNoteFailure = (error: ErrorPayload): void => ({
    type: types.CREATE_SCHEDULED_EVENT_NOTE_FAILURE,
    payload: error,
});

export const createScheduledEventNote =
    (projectId: string, scheduledEventId: $TSFixMe, data: $TSFixMe) =>
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

export const updateScheduledEventNoteInternalRequest = (): void => ({
    type: types.UPDATE_SCHEDULED_EVENT_NOTE_INTERNAL_REQUEST,
});

export const updateScheduledEventNoteInternalSuccess = (
    payload: $TSFixMe
): void => ({
    type: types.UPDATE_SCHEDULED_EVENT_NOTE_INTERNAL_SUCCESS,
    payload,
});

export const updateScheduledEventNoteInternalFailure = (
    error: ErrorPayload
): void => ({
    type: types.UPDATE_SCHEDULED_EVENT_NOTE_INTERNAL_FAILURE,
    paylod: error,
});

export const updateScheduledEventNoteInternal =
    (
        projectId: string,
        scheduledEventId: $TSFixMe,
        scheduledEventNoteId: $TSFixMe,
        data: $TSFixMe
    ): void =>
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

export const updateScheduledEventNoteInvestigationRequest = (): void => ({
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
): void => ({
    type: types.UPDATE_SCHEDULED_EVENT_NOTE_INVESTIGATION_FAILURE,
    paylod: error,
});

export const updateScheduledEventNoteInvestigation =
    (
        projectId: string,
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

export const deleteScheduledEventNoteRequest = (): void => ({
    type: types.DELETE_SCHEDULED_EVENT_NOTE_REQUEST,
});

export const deleteScheduledEventNoteSuccess = (payload: $TSFixMe): void => ({
    type: types.DELETE_SCHEDULED_EVENT_NOTE_SUCCESS,
    payload,
});

export const deleteScheduledEventNoteFailure = (error: ErrorPayload): void => ({
    type: types.DELETE_SCHEDULED_EVENT_NOTE_FAILURE,
    payload: error,
});

export const deleteScheduledEventNote =
    (
        projectId: string,
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

export const resolveScheduledEventRequest = (): void => ({
    type: types.RESOLVE_SCHEDULED_EVENT_REQUEST,
});

export const resolveScheduledEventSuccess = (payload: $TSFixMe): void => ({
    type: types.RESOLVE_SCHEDULED_EVENT_SUCCESS,
    payload,
});

export const resolveScheduledEventFailure = (error: ErrorPayload): void => ({
    type: types.RESOLVE_SCHEDULED_EVENT_FAILURE,
    payload: error,
});

export const resolveScheduledEvent =
    (projectId: string, scheduledEventId: $TSFixMe) =>
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
export const nextPage = (projectId: string): void => {
    return {
        type: types.NEXT_PAGE,
        payload: projectId,
    };
};
export const prevPage = (projectId: string): void => {
    return {
        type: types.PREV_PAGE,
        payload: projectId,
    };
};

export const fetchScheduledEventRequest = (): void => {
    return {
        type: types.FETCH_SCHEDULED_EVENT_REQUEST_SLUG,
    };
};

export const fetchScheduledEventSuccess = (payload: $TSFixMe): void => {
    return {
        type: types.FETCH_SCHEDULED_EVENT_SUCCESS_SLUG,
        payload,
    };
};

export const fetchScheduledEventFailure = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_SCHEDULED_EVENT_FAILURE_SLUG,
        payload: error,
    };
};

export const fetchScheduledEvent = (
    projectId: string,
    slug: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(
            `scheduledEvent/${projectId}/slug/${slug}`
        );
        dispatch(fetchScheduledEventRequest());

        promise.then(
            function (component): void {
                dispatch(fetchScheduledEventSuccess(component.data));
            },
            function (error): void {
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
