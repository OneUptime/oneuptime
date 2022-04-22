import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import * as types from '../constants/status';
import ErrorPayload from 'CommonUI/src/payload-types/error';
import PositiveNumber from 'Common/Types/PositiveNumber';
import { loginRequired, loginError } from './login';
import { probeRequest } from './probe';

export const statusPageSuccess: Function = (data: $TSFixMe): void => {
    return {
        type: types.STATUSPAGE_SUCCESS,
        payload: data,
    };
};

export const statusPageRequest: Function = (): void => {
    return {
        type: types.STATUSPAGE_REQUEST,
    };
};

export const statusPageFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.STATUSPAGE_FAILURE,
        payload: error,
    };
};

// Calls the API to get status
export const getStatusPage: Function = (
    statusPageSlug: $TSFixMe,
    url: URL
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `StatusPage/${statusPageSlug}?url=${url}`
        );

        dispatch(statusPageRequest());

        promise.then(
            (data: $TSFixMe) => {
                dispatch(statusPageSuccess(data.data));
            },
            (error: Error) => {
                if (
                    error &&
                    error.response &&
                    error.response.status &&
                    error.response.status === 401
                ) {
                    dispatch(loginRequired(statusPageSlug));
                }
                if (error && error.response && error.response.data) {
                    error = error.response.data;
                }
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                }
                if (error.length > 100) {
                    error = 'Network Error';
                }
                dispatch(statusPageFailure(error));
                dispatch(loginError(error));
            }
        );
        return promise;
    };
};

// Calls the API to get all status page resources
export const getAllStatusPageResource: Function = (
    statusPageSlug: $TSFixMe,
    url: URL,
    range: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promises: $TSFixMe = [];

        promises.push(
            BackendAPI.get(
                `StatusPage/resources/${statusPageSlug}/ongoing-events?url=${url}&range=${range}`
            )
        );

        promises.push(
            BackendAPI.get(
                `StatusPage/resources/${statusPageSlug}/future-events?url=${url}&range=${range}`
            )
        );

        promises.push(
            BackendAPI.get(
                `StatusPage/resources/${statusPageSlug}/past-events?url=${url}&range=${range}`
            )
        );

        promises.push(
            BackendAPI.get(
                `StatusPage/resources/${statusPageSlug}/probes?url=${url}&range=${range}`
            )
        );

        promises.push(
            BackendAPI.get(
                `StatusPage/resources/${statusPageSlug}/monitor-logs?url=${url}&range=${range}`
            )
        );

        promises.push(
            BackendAPI.get(
                `StatusPage/resources/${statusPageSlug}/announcements?url=${url}&range=${range}`
            )
        );

        promises.push(
            BackendAPI.get(
                `StatusPage/resources/${statusPageSlug}/announcement-logs?url=${url}&range=${range}`
            )
        );

        promises.push(
            BackendAPI.get(
                `StatusPage/resources/${statusPageSlug}/monitor-timelines?url=${url}&range=${range}`
            )
        );

        promises.push(
            BackendAPI.get(
                `StatusPage/resources/${statusPageSlug}/statuspage-notes?url=${url}&range=${range}`
            )
        );

        promises.push(
            BackendAPI.get(
                `StatusPage/resources/${statusPageSlug}/monitor-statuses?url=${url}&range=${range}`
            )
        );

        dispatch(statusPageRequest());
        dispatch(getAnnouncementsRequest());

        dispatch(fetchMonitorStatusesRequest());

        dispatch(fetchMonitorLogsRequest());
        dispatch(fetchLastIncidentTimelinesRequest());
        dispatch(statusPageNoteRequest());
        dispatch(fetchAnnouncementLogsRequest());

        dispatch(probeRequest());
        dispatch(ongoingEventRequest());
        dispatch(futureEventsRequest());
        dispatch(pastEventsRequest());

        return Promise.all(promises).then(
            ([
                ongoingEvents,
                futureEvents,
                pastEvents,
                probes,
                monitorLogs,
                announcement,
                announcementLogs,
                timelines,
                statusPageNote,
                monitorStatuses,
            ]: $TSFixMe) => {
                const data: $TSFixMe = {
                    ongoingEvents: ongoingEvents.data,

                    futureEvents: futureEvents.data,

                    pastEvents: pastEvents.data,

                    probes: probes.data,

                    monitorLogs: monitorLogs.data,

                    announcement: announcement.data,

                    announcementLogs: announcementLogs.data,

                    timelines: timelines.data,

                    statusPageNote: statusPageNote.data,

                    ...monitorStatuses.data,
                };
                dispatch(getAllStatusPageSuccess(data));
            },
            (error: Error) => {
                if (
                    error &&
                    error.response &&
                    error.response.status &&
                    error.response.status === 401
                ) {
                    dispatch(loginRequired(statusPageSlug));
                }

                if (error && error.response && error.response.data) {
                    error = error.response.data;
                }

                if (error && error.data) {
                    error = error.data;
                }

                if (error && error.message) {
                    error = error.message;
                }

                if (error.length > 100) {
                    error = 'Network Error';
                }

                dispatch(statusPageFailure(error));
                dispatch(loginError(error));
            }
        );
    };
};

export const getAllStatusPageSuccess: Function = (data: $TSFixMe): void => {
    return {
        type: types.FETCH_ALL_RESOURCES_SUCCESS,
        payload: data,
    };
};
export const statusPageNoteSuccess: Function = (data: $TSFixMe): void => {
    return {
        type: types.STATUSPAGE_NOTES_SUCCESS,
        payload: data,
    };
};

export const newThemeIncidentNote: Function = (data: $TSFixMe): void => {
    return {
        type: types.NEW_THEME_NOTES_SUCCESS,
        payload: data,
    };
};

export const statusPageNoteRequest: Function = (): void => {
    return {
        type: types.STATUSPAGE_NOTES_REQUEST,
    };
};

export const statusPageNoteFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.STATUSPAGE_NOTES_FAILURE,
        payload: error,
    };
};

export const statusPageNoteReset: Function = (): void => {
    return {
        type: types.STATUSPAGE_NOTES_RESET,
    };
};

export const showIncidentCard: Function = (payload: $TSFixMe): void => {
    return {
        // Payload => true or false
        type: types.SHOW_INCIDENT_CARD,

        payload,
    };
};

export const individualNoteEnable: Function = (message: $TSFixMe): void => {
    return {
        type: types.INDIVIDUAL_NOTES_ENABLE,
        payload: message,
    };
};
export const individualNoteDisable: Function = (): void => {
    return {
        type: types.INDIVIDUAL_NOTES_DISABLE,
    };
};

// Calls the API to get notes
export const getStatusPageNote: Function = (
    projectId: ObjectID,
    statusPageSlug: $TSFixMe,
    skip: PositiveNumber,
    limit: PositiveNumber = 10,
    days: PositiveNumber = 14,
    newTheme: boolean = false
) => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `StatusPage/${projectId}/${statusPageSlug}/notes?skip=${skip}&limit=${limit}&days=${days}&newTheme=${newTheme}`
        );

        dispatch(statusPageNoteRequest());

        promise.then(
            (data: $TSFixMe) => {
                dispatch(statusPageNoteSuccess(data.data));

                dispatch(newThemeIncidentNote(data.data));
                dispatch(individualNoteDisable());
            },
            (error: Error) => {
                if (error && error.response && error.response.data) {
                    error = error.response.data;
                }
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                }
                if (error.length > 100) {
                    error = 'Network Error';
                }
                dispatch(statusPageNoteFailure(error));
            }
        );
    };
};

export const getStatusPageIndividualNote: Function = (
    projectId: ObjectID,
    monitorId: $TSFixMe,
    date: $TSFixMe,
    name: $TSFixMe,
    need: $TSFixMe,
    theme: $TSFixMe
) => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `StatusPage/${projectId}/${monitorId}/individualnotes?date=${date}&need=${need}&theme=${theme}`
        );

        dispatch(statusPageNoteRequest());

        promise.then(
            (data: $TSFixMe) => {
                dispatch(statusPageNoteSuccess(data.data));
                dispatch(
                    individualNoteEnable({
                        message: data.data.message,
                        name: {
                            _id: monitorId,
                            name,
                            date,
                        },
                    })
                );
            },
            (error: Error) => {
                if (error && error.response && error.response.data) {
                    error = error.response.data;
                }
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                }
                if (error.length > 100) {
                    error = 'Network Error';
                }
                dispatch(statusPageNoteFailure(error));
            }
        );
    };
};

export const scheduledEventSuccess: Function = (data: $TSFixMe): void => {
    return {
        type: types.SCHEDULED_EVENTS_SUCCESS,
        payload: data,
    };
};

export const scheduledEventRequest: Function = (): void => {
    return {
        type: types.SCHEDULED_EVENTS_REQUEST,
    };
};

export const scheduledEventFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.SCHEDULED_EVENTS_FAILURE,
        payload: error,
    };
};

export const scheduledEventReset: Function = (): void => {
    return {
        type: types.SCHEDULED_EVENTS_RESET,
    };
};

// Calls the API to get events
export const getScheduledEvent: Function = (
    projectId: ObjectID,
    statusPageSlug: $TSFixMe,
    skip: PositiveNumber,
    theme: $TSFixMe,
    days: $TSFixMe
) => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `StatusPage/${projectId}/${statusPageSlug}/events?skip=${skip}&theme=${theme}&days=${days}`
        );

        dispatch(scheduledEventRequest());

        promise.then(
            (data: $TSFixMe) => {
                dispatch(scheduledEventSuccess(data.data));
            },
            (error: Error) => {
                if (error && error.response && error.response.data) {
                    error = error.response.data;
                }
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                }
                if (error.length > 100) {
                    error = 'Network Error';
                }
                dispatch(scheduledEventFailure(error));
            }
        );
    };
};

export const ongoingEventSuccess: Function = (data: $TSFixMe): void => {
    return {
        type: types.ONGOING_SCHEDULED_EVENTS_SUCCESS,
        payload: data,
    };
};

export const ongoingEventRequest: Function = (): void => {
    return {
        type: types.ONGOING_SCHEDULED_EVENTS_REQUEST,
    };
};

export const ongoingEventFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.ONGOING_SCHEDULED_EVENTS_FAILURE,
        payload: error,
    };
};

export const ongoingEventReset: Function = (): void => {
    return {
        type: types.ONGOING_SCHEDULED_EVENTS_RESET,
    };
};

// Calls the API to get events
export const getOngoingScheduledEvent: Function = (
    projectId: ObjectID,
    statusPageSlug: $TSFixMe,
    skip: PositiveNumber,
    theme: $TSFixMe,
    limit: PositiveNumber
) => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `StatusPage/${projectId}/${statusPageSlug}/events?skip=${skip}&theme=${theme}&limit=${limit}`
        );

        dispatch(ongoingEventRequest());

        promise.then(
            (data: $TSFixMe) => {
                dispatch(ongoingEventSuccess(data.data));
            },

            (error: Error) => {
                if (error && error.response && error.response.data) {
                    error = error.response.data;
                }
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                }
                if (error.length > 100) {
                    error = 'Network Error';
                }
                dispatch(ongoingEventFailure(error));
            }
        );
    };
};

export const individualEventsRequest: Function = (): void => {
    return {
        type: types.INDIVIDUAL_EVENTS_REQUEST,
    };
};

export const individualEventsSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.INDIVIDUAL_EVENTS_SUCCESS,
        payload,
    };
};

export const individualEventsFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.INDIVIDUAL_EVENTS_FAILURE,
        payload: error,
    };
};

export const getIndividualEvent: Function = (
    projectId: ObjectID,
    monitorId: $TSFixMe,
    date: $TSFixMe,
    name: $TSFixMe,
    theme: $TSFixMe
) => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `StatusPage/${projectId}/${monitorId}/individualevents?date=${date}&theme=${theme}`
        );

        dispatch(individualEventsRequest());

        promise.then(
            (data: $TSFixMe) => {
                dispatch(
                    individualEventsSuccess({
                        ...data.data,
                        date,
                        monitorName: name,
                    })
                );
            },
            (error: Error) => {
                if (error && error.response && error.response.data) {
                    error = error.response.data;
                }
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                }
                if (error.length > 100) {
                    error = 'Network Error';
                }
                dispatch(individualEventsFailure(error));
            }
        );
    };
};

export const futureEventsRequest: Function = (): void => {
    return {
        type: types.FUTURE_EVENTS_REQUEST,
    };
};

export const futureEventsSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.FUTURE_EVENTS_SUCCESS,
        payload,
    };
};

export const futureEventsFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.FUTURE_EVENTS_FAILURE,
        payload: error,
    };
};

export const fetchFutureEvents: $TSFixMe = (
    projectId: ObjectID,
    statusPageSlug: $TSFixMe,
    skip: PositiveNumber,
    theme: $TSFixMe,
    limit: PositiveNumber
) => {
    return async (dispatch: Dispatch) => {
        try {
            dispatch(futureEventsRequest());
            const response: $TSFixMe = await BackendAPI.get(
                `StatusPage/${projectId}/${statusPageSlug}/futureEvents?skip=${skip}&theme=${theme}&limit=${limit}`
            );

            dispatch(futureEventsSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(futureEventsFailure(errorMsg));
        }
    };
};

export const pastEventsRequest: Function = (): void => {
    return {
        type: types.PAST_EVENTS_REQUEST,
    };
};

export const pastEventsSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.PAST_EVENTS_SUCCESS,
        payload,
    };
};

export const pastEventsFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.PAST_EVENTS_FAILURE,
        payload: error,
    };
};

export const fetchPastEvents: $TSFixMe = (
    projectId: ObjectID,
    statusPageSlug: $TSFixMe,
    skip: PositiveNumber,
    theme: $TSFixMe,
    limit: PositiveNumber
) => {
    return async (dispatch: Dispatch) => {
        try {
            dispatch(pastEventsRequest());
            const response: $TSFixMe = await BackendAPI.get(
                `StatusPage/${projectId}/${statusPageSlug}/pastEvents?skip=${skip}&theme=${theme}&limit=${limit}`
            );

            dispatch(pastEventsSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(pastEventsFailure(errorMsg));
        }
    };
};

export const notmonitoredDays: Function = (
    monitorId: $TSFixMe,
    date: $TSFixMe,
    name: $TSFixMe,
    message: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        dispatch(statusPageNoteReset());
        dispatch(
            individualNoteEnable({
                message: message,
                name: {
                    _id: monitorId,
                    name,
                    date,
                },
            })
        );
    };
};

export const moreNoteSuccess: Function = (data: $TSFixMe): void => {
    return {
        type: types.MORE_NOTES_SUCCESS,
        payload: data,
    };
};

export const moreNoteRequest: Function = (): void => {
    return {
        type: types.MORE_NOTES_REQUEST,
    };
};

export const moreNoteFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.MORE_NOTES_FAILURE,
        payload: error,
    };
};

export const getMoreNote: Function = (
    projectId: ObjectID,
    statusPageSlug: $TSFixMe,
    skip: PositiveNumber
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `StatusPage/${projectId}/${statusPageSlug}/notes?skip=${skip}`
        );

        dispatch(moreNoteRequest());
        promise.then(
            (data: $TSFixMe) => {
                dispatch(moreNoteSuccess(data.data));
            },
            (error: Error) => {
                if (error && error.response && error.response.data) {
                    error = error.response.data;
                }
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                }
                if (error.length > 100) {
                    error = 'Network Error';
                }
                dispatch(moreNoteFailure(error));
            }
        );
    };
};

export const moreEventSuccess: Function = (data: $TSFixMe): void => {
    return {
        type: types.MORE_EVENTS_SUCCESS,
        payload: data,
    };
};

export const moreEventRequest: Function = (): void => {
    return {
        type: types.MORE_EVENTS_REQUEST,
    };
};

export const moreEventFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.MORE_EVENTS_FAILURE,
        payload: error,
    };
};

export const getMoreEvent: Function = (
    projectId: ObjectID,
    statusPageSlug: $TSFixMe,
    skip: PositiveNumber
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `StatusPage/${projectId}/${statusPageSlug}/events?skip=${skip}`
        );

        dispatch(moreEventRequest());
        promise.then(
            (data: $TSFixMe) => {
                dispatch(moreEventSuccess(data.data));
            },
            (error: Error) => {
                if (error && error.response && error.response.data) {
                    error = error.response.data;
                }
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                }
                if (error.length > 100) {
                    error = 'Network Error';
                }
                dispatch(moreEventFailure(error));
            }
        );
    };
};

export const moreFutureEventsRequest: Function = (): void => {
    return {
        type: types.MORE_FUTURE_EVENTS_REQUEST,
    };
};

export const moreFutureEventsSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.MORE_FUTURE_EVENTS_SUCCESS,
        payload,
    };
};

export const moreFutureEventsFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.MORE_FUTURE_EVENTS_FAILURE,
        payload: error,
    };
};

export const fetchMoreFutureEvents: $TSFixMe = (
    projectId: ObjectID,
    statusPageSlug: $TSFixMe,
    skip: PositiveNumber,
    limit: PositiveNumber
) => {
    return async (dispatch: Dispatch) => {
        try {
            dispatch(moreFutureEventsRequest());
            const response: $TSFixMe = await BackendAPI.get(
                `StatusPage/${projectId}/${statusPageSlug}/futureEvents?skip=${skip}&limit=${limit}`
            );

            dispatch(moreFutureEventsSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(moreFutureEventsFailure(errorMsg));
        }
    };
};

export const morePastEventsRequest: Function = (): void => {
    return {
        type: types.MORE_PAST_EVENTS_REQUEST,
    };
};

export const morePastEventsSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.MORE_PAST_EVENTS_SUCCESS,
        payload,
    };
};

export const morePastEventsFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.MORE_PAST_EVENTS_FAILURE,
        payload: error,
    };
};

export const fetchMorePastEvents: $TSFixMe = (
    projectId: ObjectID,
    statusPageSlug: $TSFixMe,
    skip: PositiveNumber
) => {
    return async (dispatch: Dispatch) => {
        try {
            dispatch(morePastEventsRequest());
            const response: $TSFixMe = await BackendAPI.get(
                `StatusPage/${projectId}/${statusPageSlug}/pastEvents?skip=${skip}`
            );

            dispatch(morePastEventsSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(morePastEventsFailure(errorMsg));
        }
    };
};

export const selectedProbe: Function = (val: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: types.SELECT_PROBE,
            payload: val,
        });
    };
};

// Fetch Monitor Statuses list
export function fetchMonitorStatuses(
    projectId: ObjectID,
    monitorId: $TSFixMe,
    startDate: $TSFixMe,
    endDate: $TSFixMe
) {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            `StatusPage/${projectId}/${monitorId}/monitorStatuses`,
            { startDate, endDate }
        );
        dispatch(fetchMonitorStatusesRequest(monitorId));

        promise.then(
            (monitorStatuses: $TSFixMe): void => {
                dispatch(
                    fetchMonitorStatusesSuccess({
                        projectId,
                        monitorId,

                        statuses: monitorStatuses.data,
                    })
                );
            },
            (error: $TSFixMe): void => {
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
                dispatch(fetchMonitorStatusesFailure(error));
            }
        );

        return promise;
    };
}

export const fetchMonitorStatusesRequest: Function = (id: $TSFixMe): void => {
    return {
        type: types.FETCH_MONITOR_STATUSES_REQUEST,
        payload: id,
    };
};

export const fetchMonitorStatusesSuccess: Function = (
    monitorStatuses: $TSFixMe
): void => {
    return {
        type: types.FETCH_MONITOR_STATUSES_SUCCESS,
        payload: monitorStatuses,
    };
};

export const fetchMonitorStatusesFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_MONITOR_STATUSES_FAILURE,
        payload: error,
    };
};

export function fetchMonitorLogs(
    projectId: ObjectID,
    monitorId: $TSFixMe,
    data: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            `StatusPage/${projectId}/${monitorId}/monitorLogs`,
            data
        );
        dispatch(fetchMonitorLogsRequest(monitorId));

        promise.then(
            (monitorLogs: $TSFixMe): void => {
                dispatch(
                    fetchMonitorLogsSuccess({
                        monitorId,

                        logs: monitorLogs.data,
                    })
                );
            },
            (error: $TSFixMe): void => {
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
                dispatch(fetchMonitorLogsFailure(error));
            }
        );
        return promise;
    };
}

function fetchMonitorLogsRequest(monitorId: $TSFixMe): void {
    return {
        type: types.FETCH_MONITOR_LOGS_REQUEST,
        payload: monitorId,
    };
}

function fetchMonitorLogsSuccess({ monitorId, logs }: $TSFixMe): void {
    return {
        type: types.FETCH_MONITOR_LOGS_SUCCESS,
        payload: { monitorId, logs },
    };
}

function fetchMonitorLogsFailure(error: ErrorPayload): void {
    return {
        type: types.FETCH_MONITOR_LOGS_FAILURE,
        payload: error,
    };
}

// Handle a scheduled event
export const fetchEventRequest: Function = (): void => {
    return {
        type: types.FETCH_EVENT_REQUEST,
    };
};

export const fetchEventSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.FETCH_EVENT_SUCCESS,
        payload,
    };
};

export const fetchEventFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_EVENT_FAILURE,
        payload: error,
    };
};

export const fetchEvent: Function = (
    projectId: ObjectID,
    scheduledEventId: $TSFixMe
): void => {
    return async function (dispatch: Dispatch): void {
        dispatch(fetchEventRequest());

        try {
            const response: $TSFixMe = await BackendAPI.get(
                `StatusPage/${projectId}/scheduledEvent/${scheduledEventId}`
            );

            dispatch(fetchEventSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(fetchEventFailure(errorMsg));
        }
    };
};

// Handle scheduled event note
export const fetchEventNoteRequest: Function = (): void => {
    return {
        type: types.FETCH_EVENT_NOTES_REQUEST,
    };
};

export const fetchEventNoteSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.FETCH_EVENT_NOTES_SUCCESS,
        payload,
    };
};

export const fetchEventNoteFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_EVENT_NOTES_FAILURE,
        payload: error,
    };
};

export function fetchEventNote(
    projectId: ObjectID,
    scheduledEventSlug: $TSFixMe,
    type: $TSFixMe
): void {
    return async function (dispatch: Dispatch): void {
        dispatch(fetchEventNoteRequest());

        try {
            const response: $TSFixMe = await BackendAPI.get(
                `StatusPage/${projectId}/notes/${scheduledEventSlug}?type=${type}`
            );

            dispatch(fetchEventNoteSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(fetchEventNoteFailure(errorMsg));
        }
    };
}

export const moreEventNoteRequest: Function = (): void => {
    return {
        type: types.MORE_EVENT_NOTE_REQUEST,
    };
};

export const moreEventNoteSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.MORE_EVENT_NOTE_SUCCESS,
        payload,
    };
};

export const moreEventNoteFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.MORE_EVENT_NOTE_FAILURE,
        payload: error,
    };
};

export function moreEventNote(
    projectId: ObjectID,
    scheduledEventId: $TSFixMe,
    type: $TSFixMe,
    skip: PositiveNumber
) {
    return async function (dispatch: Dispatch): void {
        try {
            dispatch(moreEventNoteRequest());

            const response: $TSFixMe = await BackendAPI.get(
                `StatusPage/${projectId}/notes/${scheduledEventId}?type=${type}&skip=${skip}`
            );

            dispatch(moreEventNoteSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(moreEventNoteFailure(errorMsg));
        }
    };
}

// Handle incident
export const fetchIncidentRequest: Function = (): void => {
    return {
        type: types.FETCH_INCIDENT_REQUEST,
    };
};

export const fetchIncidentSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.FETCH_INCIDENT_SUCCESS,
        payload,
    };
};

export const fetchIncidentFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_INCIDENT_FAILURE,
        payload: error,
    };
};

export const fetchIncident: Function = (
    projectId: ObjectID,
    incidentSlug: $TSFixMe
): void => {
    return async function (dispatch: Dispatch): void {
        try {
            dispatch(fetchIncidentRequest());
            const response: $TSFixMe = await BackendAPI.get(
                `StatusPage/${projectId}/incident/${incidentSlug}`
            );

            dispatch(fetchIncidentSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(fetchIncidentFailure(errorMsg));
        }
    };
};

export const fetchIncidentNotesRequest: Function = (): void => {
    return {
        type: types.FETCH_INCIDENT_NOTES_REQUEST,
    };
};

export const fetchIncidentNotesSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.FETCH_INCIDENT_NOTES_SUCCESS,
        payload,
    };
};

export const fetchIncidentNotesFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_INCIDENT_NOTES_FAILURE,
        payload: error,
    };
};

export function fetchIncidentNotes(
    projectId: ObjectID,
    incidentId: $TSFixMe,
    postOnStatusPage: $TSFixMe
): void {
    return async function (dispatch: Dispatch): void {
        try {
            dispatch(fetchIncidentNotesRequest());

            const response: $TSFixMe = await BackendAPI.get(
                `StatusPage/${projectId}/${incidentId}/incidentNotes?postOnStatusPage=${postOnStatusPage}`
            );

            dispatch(fetchIncidentNotesSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(fetchIncidentNotesFailure(errorMsg));
        }
    };
}

export const moreIncidentNotesRequest: Function = (): void => {
    return {
        type: types.MORE_INCIDENT_NOTES_REQUEST,
    };
};

export const moreIncidentNotesSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.MORE_INCIDENT_NOTES_SUCCESS,
        payload,
    };
};

export const moreIncidentNotesFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.MORE_INCIDENT_NOTES_FAILURE,
        payload: error,
    };
};

export function moreIncidentNotes(
    projectId: ObjectID,
    incidentSlug: $TSFixMe,
    postOnStatusPage: $TSFixMe,
    skip: PositiveNumber
) {
    return async function (dispatch: Dispatch): void {
        try {
            dispatch(moreIncidentNotesRequest());

            const response: $TSFixMe = await BackendAPI.get(
                `StatusPage/${projectId}/${incidentSlug}/incidentNotes?postOnStatusPage=${postOnStatusPage}&skip=${skip}`
            );

            dispatch(moreIncidentNotesSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(moreIncidentNotesFailure(errorMsg));
        }
    };
}

export const fetchLastIncidentTimelineRequest: Function = (): void => {
    return {
        type: types.FETCH_LAST_INCIDENT_TIMELINE_REQUEST,
    };
};

export const fetchLastIncidentTimelineSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.FETCH_LAST_INCIDENT_TIMELINE_SUCCESS,
        payload,
    };
};

export const fetchLastIncidentTimelineFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_LAST_INCIDENT_TIMELINE_FAILURE,
        payload: error,
    };
};

export function fetchLastIncidentTimeline(
    projectId: ObjectID,
    incidentSlug: $TSFixMe
): void {
    return async function (dispatch: Dispatch): void {
        try {
            dispatch(fetchLastIncidentTimelineRequest());

            const response: $TSFixMe = await BackendAPI.get(
                `StatusPage/${projectId}/timeline/${incidentSlug}`
            );

            dispatch(fetchLastIncidentTimelineSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(fetchLastIncidentTimelineFailure(errorMsg));
        }
    };
}

export const fetchLastIncidentTimelinesRequest: Function = (): void => {
    return {
        type: types.FETCH_LAST_INCIDENT_TIMELINES_REQUEST,
    };
};

export const fetchLastIncidentTimelinesSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.FETCH_LAST_INCIDENT_TIMELINES_SUCCESS,
        payload,
    };
};

export const fetchLastIncidentTimelinesFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_LAST_INCIDENT_TIMELINES_FAILURE,
        payload: error,
    };
};

export function fetchLastIncidentTimelines(
    projectId: ObjectID,
    statusPageSlug: $TSFixMe
): void {
    return async function (dispatch: Dispatch): void {
        try {
            dispatch(fetchLastIncidentTimelinesRequest());

            const response: $TSFixMe = await BackendAPI.get(
                `StatusPage/${projectId}/${statusPageSlug}/timelines`
            );

            dispatch(fetchLastIncidentTimelinesSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(fetchLastIncidentTimelinesFailure(errorMsg));
        }
    };
}

export const showEventCard: Function = (payload: $TSFixMe): void => {
    // Payload => true or false
    return {
        type: types.SHOW_EVENT_CARD,
        payload,
    };
};

export const getAnnouncementsRequest: Function = (): void => {
    return {
        type: types.FETCH_ANNOUNCEMENTS_REQUEST,
    };
};

export const getAnnouncementsSuccess: Function = (data: $TSFixMe): void => {
    return {
        type: types.FETCH_ANNOUNCEMENTS_SUCCESS,
        payload: data,
    };
};

export const getAnnouncementsFailure: Function = (data: $TSFixMe): void => {
    return {
        type: types.FETCH_ANNOUNCEMENTS_FAILURE,
        payload: data,
    };
};

export function getAnnouncements(
    projectId: ObjectID,
    statusPageId: $TSFixMe,
    skip: number = 0,
    limit: PositiveNumber
) {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `StatusPage/${projectId}/announcement/${statusPageId}?skip=${skip}&limit=${limit}&show=true`
        );
        dispatch(getAnnouncementsRequest());
        promise.then(
            (response: $TSFixMe): void => {
                dispatch(getAnnouncementsSuccess(response.data));
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
                dispatch(getAnnouncementsFailure(errorMsg));
            }
        );
        return promise;
    };
}

export const getSingleAnnouncementSuccess: Function = (
    data: $TSFixMe
): void => {
    return {
        type: types.FETCH_SINGLE_ANNOUNCEMENTS_SUCCESS,
        payload: data,
    };
};

export const getSingleAnnouncementRequest: Function = (): void => {
    return {
        type: types.FETCH_SINGLE_ANNOUNCEMENTS_REQUEST,
    };
};

export const getSingleAnnouncementFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_SINGLE_ANNOUNCEMENTS_FAILURE,
        payload: error,
    };
};

export function getSingleAnnouncement(
    projectId: ObjectID,
    statusPageSlug: $TSFixMe,
    announcementSlug: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `StatusPage/${projectId}/announcement/${statusPageSlug}/single/${announcementSlug}`
        );
        dispatch(getSingleAnnouncementRequest());
        promise.then(
            (response: $TSFixMe): void => {
                dispatch(getSingleAnnouncementSuccess(response.data));
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
                dispatch(getSingleAnnouncementFailure(errorMsg));
            }
        );
        return promise;
    };
}

export const fetchAnnouncementLogsRequest: Function = (): void => {
    return {
        type: types.FETCH_ANNOUNCEMEMTLOGS_REQUEST,
    };
};

export const fetchAnnouncementLogsSuccess: Function = (
    data: $TSFixMe
): void => {
    return {
        type: types.FETCH_ANNOUNCEMEMTLOGS_SUCCESS,
        payload: data,
    };
};

export const fetchAnnouncementLogsFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_ANNOUNCEMEMTLOGS_FAILURE,
        payload: error,
    };
};

export function fetchAnnouncementLogs(
    projectId: ObjectID,
    statusPageId: $TSFixMe,
    skip: number = 0,
    limit: PositiveNumber
) {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `StatusPage/${projectId}/announcementLogs/${statusPageId}?skip=${skip}&limit=${limit}&theme=${true}`
        );
        dispatch(fetchAnnouncementLogsRequest());
        promise.then(
            (response: $TSFixMe): void => {
                dispatch(fetchAnnouncementLogsSuccess(response.data));
            },
            (error: $TSFixMe): void => {
                dispatch(fetchAnnouncementLogsFailure(error));
            }
        );
        return promise;
    };
}

export const calculateTimeRequest: Function = (monitorId: $TSFixMe): void => {
    return {
        type: types.CALCULATE_TIME_REQUEST,
        payload: monitorId,
    };
};

export const calculateTimeSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.CALCULATE_TIME_SUCCESS,
        payload,
    };
};

export const calculateTimeFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.CALCULATE_TIME_FAILURE,
        payload: error,
    };
};

export function calculateTime(
    statuses: $TSFixMe,
    start: $TSFixMe,
    range: $TSFixMe,
    monitorId: $TSFixMe
) {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            `monitor/${monitorId}/calculate-time`,
            {
                statuses,
                start,
                range,
            }
        );
        dispatch(calculateTimeRequest(monitorId));
        promise.then(
            (response: $TSFixMe): void => {
                dispatch(calculateTimeSuccess(response.data));
            },
            (error: $TSFixMe): void => {
                dispatch(calculateTimeFailure(error));
            }
        );
        return promise;
    };
}

export const fetchTweetsRequest: Function = (monitorId: $TSFixMe): void => {
    return {
        type: types.FETCH_TWEETS_REQUEST,
        payload: monitorId,
    };
};

export const fetchTweetsSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.FETCH_TWEETS_SUCCESS,
        payload,
    };
};

export const fetchTweetsFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_TWEETS_FAILURE,
        payload: error,
    };
};

export const fetchTweets: Function = (
    handle: $TSFixMe,
    projectId: ObjectID
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            `StatusPage/${projectId}/tweets`,
            {
                handle,
            }
        );

        dispatch(fetchTweetsRequest());
        promise.then(
            (response: $TSFixMe): void => {
                dispatch(fetchTweetsSuccess(response.data));
            },
            (error: $TSFixMe): void => {
                dispatch(fetchTweetsFailure(error));
            }
        );
        return promise;
    };
};

export const fetchExternalStatusPagesRequest: Function = (): void => {
    return {
        type: types.FETCH_EXTERNAL_STATUSPAGES_REQUEST,
    };
};

export const fetchExternalStatusPagesSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.FETCH_EXTERNAL_STATUSPAGES_SUCCESS,
        payload,
    };
};

export const fetchExternalStatusPagesFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_EXTERNAL_STATUSPAGES_FAILURE,
        payload: error,
    };
};

export function fetchExternalStatusPages(
    projectId: ObjectID,
    statusPageId: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `StatusPage/${projectId}/fetchExternalStatusPages/${statusPageId}`
        );

        dispatch(fetchExternalStatusPagesRequest());
        promise.then(
            (response: $TSFixMe): void => {
                dispatch(fetchExternalStatusPagesSuccess(response.data));
            },
            (error: $TSFixMe): void => {
                dispatch(fetchExternalStatusPagesFailure(error));
            }
        );
        return promise;
    };
}
export const translateLanguage: Function = (payload: $TSFixMe): void => {
    return {
        type: types.TRANSLATE_LANGUAGE,
        payload,
    };
};
