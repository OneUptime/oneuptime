import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import * as types from '../constants/scheduledEvent';
import ErrorPayload from 'CommonUI/src/PayloadTypes/error';
import PositiveNumber from 'Common/Types/PositiveNumber';

export const fetchscheduledEvent: $TSFixMe = (
    projectId: ObjectID,
    scheduledEventId: $TSFixMe
) => {
    return async (dispatch: Dispatch) => {
        try {
            dispatch(fetchscheduledEventRequest());

            const response: $TSFixMe = await BackendAPI.get(
                `scheduledEvent/${projectId}/${scheduledEventId}`
            );

            dispatch(fetchscheduledEventSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
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
};

export const fetchscheduledEventSuccess: Function = (
    scheduledEvents: $TSFixMe
): void => {
    return {
        type: types.FETCH_SCHEDULED_EVENT_SUCCESS,
        payload: scheduledEvents,
    };
};

export const fetchscheduledEventRequest: Function = (): void => {
    return {
        type: types.FETCH_SCHEDULED_EVENT_REQUEST,
    };
};

export const addScheduleEvent: Function = (payload: $TSFixMe): void => {
    return {
        type: types.ADD_SCHEDULE_EVENT,
        payload: payload,
    };
};
export const fetchscheduledEventFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_SCHEDULED_EVENT_FAILURE,
        payload: error,
    };
};

export const fetchscheduledEvents: $TSFixMe = (
    projectId: ObjectID,
    skip: PositiveNumber,
    limit: PositiveNumber
) => {
    return async (dispatch: Dispatch) => {
        skip = Number(skip);
        limit = Number(limit);
        dispatch(fetchscheduledEventsRequest());

        try {
            let response: $TSFixMe = {};
            if (!skip && !limit) {
                response = await BackendAPI.get(
                    `scheduledEvent/${projectId}?skip=${0}&limit=${10}`
                );
            } else {
                response = await BackendAPI.get(
                    `scheduledEvent/${projectId}?skip=${skip}&limit=${limit}`
                );
            }

            const { data, count }: $TSFixMe = response.data;
            dispatch(fetchscheduledEventsSuccess({ data, count, skip, limit }));
        } catch (error) {
            const errorMsg: $TSFixMe =
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
};

export const fetchscheduledEventsSuccess: Function = (
    scheduledEvents: $TSFixMe
): void => {
    return {
        type: types.FETCH_SCHEDULED_EVENTS_SUCCESS,
        payload: scheduledEvents,
    };
};

export const fetchscheduledEventsRequest: Function = (): void => {
    return {
        type: types.FETCH_SCHEDULED_EVENTS_REQUEST,
    };
};

export const fetchscheduledEventsFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_SCHEDULED_EVENTS_FAILURE,
        payload: error,
    };
};

export const fetchSubProjectScheduledEventsRequest: Function = (): void => {
    return {
        type: types.FETCH_SUBPROJECT_SCHEDULED_EVENTS_REQUEST,
    };
};

export const fetchSubProjectScheduledEventsSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.FETCH_SUBPROJECT_SCHEDULED_EVENTS_SUCCESS,
        payload,
    };
};

export const fetchSubProjectScheduledEventsFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_SUBPROJECT_SCHEDULED_EVENTS_FAILURE,
        payload: error,
    };
};

export const fetchSubProjectScheduledEvents: $TSFixMe = (
    projectId: ObjectID
) => {
    return async (dispatch: Dispatch) => {
        try {
            dispatch(fetchSubProjectScheduledEventsRequest());
            const response: $TSFixMe = await BackendAPI.get(
                `scheduledEvent/${projectId}/scheduledEvents/all`
            );

            dispatch(fetchSubProjectScheduledEventsSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
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
};

export const fetchOngoingScheduledEventsRequest: Function = (): void => {
    return {
        type: types.FETCH_ONGOING_SCHEDULED_EVENTS_REQUEST,
    };
};

export const fetchOngoingScheduledEventsSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.FETCH_ONGOING_SCHEDULED_EVENTS_SUCCESS,
        payload,
    };
};

export const fetchOngoingScheduledEventsFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_ONGOING_SCHEDULED_EVENTS_FAILURE,
        payload: error,
    };
};

export const fetchOngoingScheduledEvents: $TSFixMe = (projectId: ObjectID) => {
    return async (dispatch: Dispatch) => {
        try {
            dispatch(fetchOngoingScheduledEventsRequest());

            const response: $TSFixMe = await BackendAPI.get(
                `scheduledEvent/${projectId}/ongoingEvent`
            );

            dispatch(fetchOngoingScheduledEventsSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
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
};

export const fetchSubProjectOngoingScheduledEventsRequest: Function =
    (): void => {
        return {
            type: types.FETCH_SUBPROJECT_ONGOING_SCHEDULED_EVENTS_REQUEST,
        };
    };

export const fetchSubProjectOngoingScheduledEventsSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.FETCH_SUBPROJECT_ONGOING_SCHEDULED_EVENTS_SUCCESS,
        payload,
    };
};

export const fetchSubProjectOngoingScheduledEventsFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_SUBPROJECT_ONGOING_SCHEDULED_EVENTS_FAILURE,
        payload: error,
    };
};

export const fetchSubProjectOngoingScheduledEvents: $TSFixMe = (
    projectId: ObjectID
): void => {
    return async (dispatch: Dispatch): void => {
        try {
            dispatch(fetchSubProjectOngoingScheduledEventsRequest());
            const response: $TSFixMe = await BackendAPI.get(
                `scheduledEvent/${projectId}/ongoingEvent/all`
            );

            dispatch(
                fetchSubProjectOngoingScheduledEventsSuccess(response.data)
            );
        } catch (error) {
            const errorMsg: $TSFixMe =
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
};

export const createScheduledEvent: $TSFixMe = (
    projectId: ObjectID,
    values: $TSFixMe
) => {
    return async (dispatch: Dispatch) => {
        try {
            dispatch(createScheduledEventRequest());

            const response: $TSFixMe = await BackendAPI.post(
                `scheduledEvent/${projectId}`,
                values
            );

            dispatch(createScheduledEventSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
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
};

export const createScheduledEventSuccess: Function = (
    newScheduledEvent: $TSFixMe
): void => {
    return {
        type: types.CREATE_SCHEDULED_EVENT_SUCCESS,
        payload: newScheduledEvent,
    };
};

export const createScheduledEventRequest: Function = (): void => {
    return {
        type: types.CREATE_SCHEDULED_EVENT_REQUEST,
    };
};

export const createScheduledEventFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.CREATE_SCHEDULED_EVENT_FAILURE,
        payload: error,
    };
};

export const deleteScheduledEvent: $TSFixMe = (
    projectId: ObjectID,
    scheduledEventId: $TSFixMe
): void => {
    return async (dispatch: Dispatch) => {
        try {
            dispatch(deleteScheduledEventRequest());

            const response: $TSFixMe =
                await delete `scheduledEvent/${projectId}/${scheduledEventId}`;

            dispatch(deleteScheduledEventSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
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
};

export const deleteScheduledEventSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.DELETE_SCHEDULED_EVENT_SUCCESS,
        payload,
    };
};

export const deleteScheduledEventRequest: Function = (): void => {
    return {
        type: types.DELETE_SCHEDULED_EVENT_REQUEST,
    };
};

export const deleteScheduledEventFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.DELETE_SCHEDULED_EVENT_FAILURE,
        payload: error,
    };
};

export const cancelScheduledEvent: $TSFixMe = (
    projectId: ObjectID,
    scheduledEventId: $TSFixMe,
    history: $TSFixMe,
    redirect: $TSFixMe,
    closeModal: $TSFixMe,
    modalId: $TSFixMe
) => {
    return async (dispatch: Dispatch) => {
        try {
            dispatch(cancelScheduledEventRequest());

            const response: $TSFixMe = await BackendAPI.put(
                `scheduledEvent/${projectId}/${scheduledEventId}/cancel`
            );

            dispatch(cancelScheduledEventSuccess(response.data));
            closeModal({ id: modalId });
            history.push(redirect);
        } catch (error) {
            const errorMsg: $TSFixMe =
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
};

export const cancelScheduledEventSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.CANCEL_SCHEDULED_EVENT_SUCCESS,
        payload,
    };
};

export const cancelScheduledEventRequest: Function = (): void => {
    return {
        type: types.CANCEL_SCHEDULED_EVENT_REQUEST,
    };
};

export const cancelScheduledEventFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.CANCEL_SCHEDULED_EVENT_FAILURE,
        payload: error,
    };
};

export function updateScheduledEvent(
    projectId: ObjectID,
    scheduledEventId: $TSFixMe,
    values: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `scheduledEvent/${projectId}/${scheduledEventId}`,
            values
        );
        dispatch(updateScheduledEventRequest());

        promise.then(
            (scheduledEvent: $TSFixMe): void => {
                dispatch(updateScheduledEventSuccess(scheduledEvent.data));
            },
            (error: $TSFixMe): void => {
                const errorMsg: $TSFixMe =
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

export const updateScheduledEventSuccess: Function = (
    updatedScheduledEvent: $TSFixMe
): void => {
    return {
        type: types.UPDATE_SCHEDULED_EVENT_SUCCESS,
        payload: updatedScheduledEvent,
    };
};

export const updateScheduledEventRequest: Function = (): void => {
    return {
        type: types.UPDATE_SCHEDULED_EVENT_REQUEST,
    };
};

export const updateScheduledEventFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.UPDATE_SCHEDULED_EVENT_FAILURE,
        payload: error,
    };
};

// Scheduled Event Note

export const fetchScheduledEventNotesInternalRequest: Function = (): void => {
    return {
        type: types.FETCH_SCHEDULED_EVENT_NOTES_INTERNAL_REQUEST,
    };
};

export const fetchScheduledEventNotesInternalSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.FETCH_SCHEDULED_EVENT_NOTES_INTERNAL_SUCCESS,
        payload,
    };
};

export const fetchScheduledEventNotesInternalFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_SCHEDULED_EVENT_NOTES_INTERNAL_FAILURE,
        payload: error,
    };
};

export const fetchScheduledEventNotesInternal: $TSFixMe = (
    projectId: ObjectID,
    scheduledEventId: $TSFixMe,
    limit: PositiveNumber,
    skip: PositiveNumber,
    type: $TSFixMe
) => {
    return async (dispatch: Dispatch) => {
        try {
            dispatch(fetchScheduledEventNotesInternalRequest());
            skip = Number(skip);
            limit = Number(limit);

            let response: $TSFixMe = {};
            if (skip >= 0 && limit >= 0) {
                response = await BackendAPI.get(
                    `scheduledEvent/${projectId}/${scheduledEventId}/notes?limit=${limit}&skip=${skip}&type=${type}`
                );
            } else {
                response = await BackendAPI.get(
                    `scheduledEvent/${projectId}/${scheduledEventId}/notes?`
                );
            }

            const { data, count }: $TSFixMe = response.data;
            dispatch(
                fetchScheduledEventNotesInternalSuccess({
                    data,
                    count,
                    skip,
                    limit,
                })
            );
        } catch (error) {
            const errorMsg: $TSFixMe =
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
};

export const createScheduledEventNoteRequest: Function = (): void => {
    return {
        type: types.CREATE_SCHEDULED_EVENT_NOTE_REQUEST,
    };
};

export const createScheduledEventNoteSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.CREATE_SCHEDULED_EVENT_NOTE_SUCCESS,
        payload,
    };
};

export const createScheduledEventNoteFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.CREATE_SCHEDULED_EVENT_NOTE_FAILURE,
        payload: error,
    };
};

export const createScheduledEventNote: $TSFixMe = (
    projectId: ObjectID,
    scheduledEventId: $TSFixMe,
    data: $TSFixMe
) => {
    return async (dispatch: Dispatch) => {
        try {
            dispatch(createScheduledEventNoteRequest());

            const response: $TSFixMe = await BackendAPI.post(
                `scheduledEvent/${projectId}/${scheduledEventId}/notes`,
                data
            );

            dispatch(createScheduledEventNoteSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
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
};

export const updateScheduledEventNoteInternalRequest: Function = (): void => {
    return {
        type: types.UPDATE_SCHEDULED_EVENT_NOTE_INTERNAL_REQUEST,
    };
};

export const updateScheduledEventNoteInternalSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.UPDATE_SCHEDULED_EVENT_NOTE_INTERNAL_SUCCESS,
        payload,
    };
};

export const updateScheduledEventNoteInternalFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.UPDATE_SCHEDULED_EVENT_NOTE_INTERNAL_FAILURE,
        paylod: error,
    };
};

export const updateScheduledEventNoteInternal: $TSFixMe = (
    projectId: ObjectID,
    scheduledEventId: $TSFixMe,
    scheduledEventNoteId: $TSFixMe,
    data: $TSFixMe
): void => {
    return async (dispatch: Dispatch) => {
        try {
            dispatch(updateScheduledEventNoteInternalRequest());
            const response: $TSFixMe = await BackendAPI.put(
                `scheduledEvent/${projectId}/${scheduledEventId}/notes/${scheduledEventNoteId}`,
                data
            );

            dispatch(updateScheduledEventNoteInternalSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
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
};

export const updateScheduledEventNoteInvestigationRequest: Function =
    (): void => {
        return {
            type: types.UPDATE_SCHEDULED_EVENT_NOTE_INVESTIGATION_REQUEST,
        };
    };

export const updateScheduledEventNoteInvestigationSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.UPDATE_SCHEDULED_EVENT_NOTE_INVESTIGATION_SUCCESS,
        payload,
    };
};

export const updateScheduledEventNoteInvestigationFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.UPDATE_SCHEDULED_EVENT_NOTE_INVESTIGATION_FAILURE,
        paylod: error,
    };
};

export const updateScheduledEventNoteInvestigation: $TSFixMe = (
    projectId: ObjectID,
    scheduledEventId: $TSFixMe,
    scheduledEventNoteId: $TSFixMe,
    data: $TSFixMe
): void => {
    return async (dispatch: Dispatch) => {
        try {
            dispatch(updateScheduledEventNoteInvestigationRequest());

            const response: $TSFixMe = await BackendAPI.put(
                `scheduledEvent/${projectId}/${scheduledEventId}/notes/${scheduledEventNoteId}`,
                data
            );

            dispatch(
                updateScheduledEventNoteInvestigationSuccess(response.data)
            );
        } catch (error) {
            const errorMsg: $TSFixMe =
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
};

export const deleteScheduledEventNoteRequest: Function = (): void => {
    return {
        type: types.DELETE_SCHEDULED_EVENT_NOTE_REQUEST,
    };
};

export const deleteScheduledEventNoteSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.DELETE_SCHEDULED_EVENT_NOTE_SUCCESS,
        payload,
    };
};

export const deleteScheduledEventNoteFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.DELETE_SCHEDULED_EVENT_NOTE_FAILURE,
        payload: error,
    };
};

export const deleteScheduledEventNote: $TSFixMe = (
    projectId: ObjectID,
    scheduledEventId: $TSFixMe,
    scheduledEventNoteId: $TSFixMe
): void => {
    return async (dispatch: Dispatch) => {
        try {
            dispatch(deleteScheduledEventNoteRequest());

            const response: $TSFixMe =
                await delete `scheduledEvent/${projectId}/${scheduledEventId}/notes/${scheduledEventNoteId}`;

            dispatch(deleteScheduledEventNoteSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
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
};

export const resolveScheduledEventRequest: Function = (): void => {
    return {
        type: types.RESOLVE_SCHEDULED_EVENT_REQUEST,
    };
};

export const resolveScheduledEventSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.RESOLVE_SCHEDULED_EVENT_SUCCESS,
        payload,
    };
};

export const resolveScheduledEventFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.RESOLVE_SCHEDULED_EVENT_FAILURE,
        payload: error,
    };
};

export const resolveScheduledEvent: $TSFixMe = (
    projectId: ObjectID,
    scheduledEventId: $TSFixMe
) => {
    return async (dispatch: Dispatch): void => {
        try {
            dispatch(resolveScheduledEventRequest());

            const response: $TSFixMe = await BackendAPI.put(
                `scheduledEvent/${projectId}/resolve/${scheduledEventId}`
            );

            dispatch(resolveScheduledEventSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
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
};
export const nextPage: Function = (projectId: ObjectID): void => {
    return {
        type: types.NEXT_PAGE,
        payload: projectId,
    };
};
export const prevPage: Function = (projectId: ObjectID): void => {
    return {
        type: types.PREV_PAGE,
        payload: projectId,
    };
};

export const fetchScheduledEventRequest: Function = (): void => {
    return {
        type: types.FETCH_SCHEDULED_EVENT_REQUEST_SLUG,
    };
};

export const fetchScheduledEventSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.FETCH_SCHEDULED_EVENT_SUCCESS_SLUG,
        payload,
    };
};

export const fetchScheduledEventFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_SCHEDULED_EVENT_FAILURE_SLUG,
        payload: error,
    };
};

export const fetchScheduledEvent: Function = (
    projectId: ObjectID,
    slug: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `scheduledEvent/${projectId}/slug/${slug}`
        );
        dispatch(fetchScheduledEventRequest());

        promise.then(
            (component: $TSFixMe): void => {
                dispatch(fetchScheduledEventSuccess(component.data));
            },
            (error: $TSFixMe): void => {
                const errorMsg: $TSFixMe =
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
